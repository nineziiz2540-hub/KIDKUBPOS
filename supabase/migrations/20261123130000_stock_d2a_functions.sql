-- Round D2a, Task 2: functions for "ปิดขายชั่วคราว / เปิดขาย", the packaging-set editor, the waste
-- "ย้อนกลับ", and the owner's "ยอดน่าจะผิด" flags (spec §6.7, §7.4, §7.6, §8, §10; plan D2-5, D2-7).
-- New functions only: no overloads, no existing function changed, no table or constraint changed.
--
-- Service-role functions. Server actions call them through createAdminClient() after getProfile().
-- Each re-checks the actor in profiles: same shop and not deactivated (deactivated_at is null), as
-- stock_waste / stock_receive_undo do. A deactivated member is also banned in GoTrue, but the check
-- here does not rely on that.
--   * set_menu_paused            any role pauses or resumes a menu (writes products.paused_at / paused_by;
--                                 Task 1's trigger lets only a service-role write touch them)
--   * stock_waste_undo           undoes a waste record (the rows of one ref_id): 10 minutes, once only,
--                                 by the recorder or an owner/manager. Positive 'waste' rows bring the
--                                 net waste of the ref back to 0.
--   * stock_flag_sold_while_out  "ยังมีของ ขายต่อ": one flag per material per business day; never blocks a sale
--   * stock_flag_resolve         an owner/manager marks a flag as handled
-- SECURITY INVOKER functions for the user client (owner/manager), like save_option_effects. Task 1's RLS
-- and the config_refs_ok check still apply on top:
--   * save_packaging_set         creates or edits a set, then replaces all its items, in one transaction
--   * archive_packaging_set      "เก็บเข้าคลัง", refused while a menu that is not archived uses the set
--
-- Errors are raised as the exception message; the server actions map them to Thai.
--   set_menu_paused:            forbidden, invalid_paused, product_not_found
--   save_packaging_set:         forbidden, name_required, name_too_long, items_required, too_many_items,
--                               material_not_found, invalid_qty, duplicate_material, set_not_found, name_taken
--   archive_packaging_set:      forbidden, set_not_found, set_in_use
--   stock_waste_undo:           forbidden, not_found, too_late, already_undone
--   stock_flag_sold_while_out:  forbidden
--   stock_flag_resolve:         forbidden, not_found
--
-- A 'waste' row may carry a positive quantity: inventory_transactions_type_check only checks the type
-- (read 2026-11-20), so no constraint changes.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- set_menu_paused: "ปิดขายชั่วคราว" (p_paused true) / "เปิดขาย" (false). Returns the new paused_at
-- (null after a resume). Pausing an already paused menu records the new time and actor.
-- ---------------------------------------------------------------------------
create or replace function public.set_menu_paused(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_product_id uuid,
  p_paused boolean
)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_at timestamptz;
begin
  if not exists (select 1 from public.profiles p
                  where p.id = p_actor_id and p.tenant_id = p_tenant_id and p.deactivated_at is null) then
    raise exception 'forbidden';
  end if;
  if p_paused is null then
    raise exception 'invalid_paused';
  end if;

  -- Service role: auth.uid() is null, so prevent_direct_menu_pause lets the pause columns through.
  update public.products
     set paused_at = case when p_paused then now() end,
         paused_by = case when p_paused then p_actor_id end
   where id = p_product_id and tenant_id = p_tenant_id and archived_at is null
  returning paused_at into v_at;
  if not found then
    raise exception 'product_not_found';
  end if;

  return v_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_packaging_set: "ชุดภาชนะ" create (p_id null) or edit (p_id = a set of the caller's shop that is not
-- archived), then ALL its items are replaced by p_items. Everything is checked before anything is written,
-- and any raise rolls the whole call back, so a bad item leaves the old set and items untouched.
-- p_items: [{ "material_id": uuid, "qty": number }], 1-20 items, each a material of the caller's shop that
-- is not archived, qty > 0 and <= 1000 with up to 3 decimals, each material once.
-- ---------------------------------------------------------------------------
create or replace function public.save_packaging_set(p_id uuid, p_name text, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid := public.auth_tenant_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
  v_e jsonb;
  v_mat uuid;
  v_qty numeric;
  v_seen uuid[] := '{}';
begin
  if public.auth_role() is null or public.auth_role() not in ('owner', 'manager') then
    raise exception 'forbidden';
  end if;

  if v_name = '' then
    raise exception 'name_required';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'name_too_long';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'items_required';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'items_required';
  end if;
  if jsonb_array_length(p_items) > 20 then
    raise exception 'too_many_items';
  end if;

  for v_e in select * from jsonb_array_elements(p_items) loop
    -- CASE keeps each cast from running on a value of the wrong type.
    v_mat := case when jsonb_typeof(v_e) = 'object' and jsonb_typeof(v_e -> 'material_id') = 'string'
                   and (v_e ->> 'material_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then (v_e ->> 'material_id')::uuid end;
    if v_mat is null or not exists (
      select 1 from public.raw_materials rm
       where rm.id = v_mat and rm.tenant_id = v_tenant and rm.archived_at is null
    ) then
      raise exception 'material_not_found';
    end if;
    v_qty := case when jsonb_typeof(v_e -> 'qty') = 'number' then (v_e ->> 'qty')::numeric end;
    if v_qty is null or not (v_qty > 0 and v_qty <= 1000) or v_qty <> round(v_qty, 3) then
      raise exception 'invalid_qty';
    end if;
    if v_mat = any(v_seen) then
      raise exception 'duplicate_material';
    end if;
    v_seen := v_seen || v_mat;
  end loop;

  if p_id is not null then
    perform 1 from public.packaging_sets s
     where s.id = p_id and s.tenant_id = v_tenant and s.archived_at is null
       for update;
    if not found then
      raise exception 'set_not_found';
    end if;
  end if;

  -- Same rule as packaging_sets_name_per_tenant: one live set per name, ignoring case and outer spaces.
  if exists (select 1 from public.packaging_sets s
              where s.tenant_id = v_tenant and s.archived_at is null
                and lower(btrim(s.name)) = lower(v_name) and s.id is distinct from p_id) then
    raise exception 'name_taken';
  end if;

  begin
    if p_id is null then
      insert into public.packaging_sets (tenant_id, name) values (v_tenant, v_name) returning id into v_id;
    else
      update public.packaging_sets set name = v_name where id = p_id and tenant_id = v_tenant returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'name_taken';  -- a concurrent save took the name after the check above
  end;

  delete from public.packaging_set_items where set_id = v_id and tenant_id = v_tenant;
  insert into public.packaging_set_items (tenant_id, set_id, raw_material_id, qty)
  select v_tenant, v_id, (e.value ->> 'material_id')::uuid, (e.value ->> 'qty')::numeric
    from jsonb_array_elements(p_items) as e(value);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- archive_packaging_set: "เก็บเข้าคลัง". Archiving an archived set does nothing. The set's name is free
-- again afterwards (the unique name index skips archived sets).
-- ---------------------------------------------------------------------------
create or replace function public.archive_packaging_set(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid := public.auth_tenant_id();
  v_archived timestamptz;
begin
  if public.auth_role() is null or public.auth_role() not in ('owner', 'manager') then
    raise exception 'forbidden';
  end if;

  -- FOR UPDATE, not the weaker lock a plain UPDATE takes: a menu being pointed at this set holds a key-share
  -- lock on the set row (its foreign key) until it commits, so the two serialise and the check below sees it.
  select s.archived_at into v_archived
    from public.packaging_sets s
   where s.id = p_id and s.tenant_id = v_tenant
     for update;
  if not found then
    raise exception 'set_not_found';
  end if;
  if v_archived is not null then
    return;
  end if;

  if exists (select 1 from public.products pr
              where pr.packaging_set_id = p_id and pr.tenant_id = v_tenant and pr.archived_at is null) then
    raise exception 'set_in_use';
  end if;

  update public.packaging_sets set archived_at = now() where id = p_id and tenant_id = v_tenant;
end;
$$;

-- ---------------------------------------------------------------------------
-- stock_waste_undo: "ย้อนกลับ" of one waste record (every 'waste' row stock_waste wrote with p_ref_id).
-- One positive 'waste' row per original row: same material, unit_cost and ref_id, reason
-- 'ย้อนกลับ · ' || the original reason. Returns the number of rows reversed.
-- A held bill's cancel also records waste, with the held bill's id as ref_id. That waste belongs to an
-- approved cancel, not to the waste button, so it is never undone here ('not_found').
-- ---------------------------------------------------------------------------
create or replace function public.stock_waste_undo(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_ref_id uuid
)
returns int
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role text;
  v_count int;
  v_first timestamptz;
  v_all_mine boolean;
  v_row record;
  v_n int := 0;
begin
  select p.role into v_role from public.profiles p
   where p.id = p_actor_id and p.tenant_id = p_tenant_id and p.deactivated_at is null;
  if v_role is null then
    raise exception 'forbidden';
  end if;

  -- The original rows: stock_waste writes them negative. A missing created_at counts as too old.
  select count(*), min(coalesce(t.created_at, '-infinity'::timestamptz)),
         bool_and(t.created_by is not distinct from p_actor_id)
    into v_count, v_first, v_all_mine
    from public.inventory_transactions t
    join public.raw_materials rm on rm.id = t.raw_material_id and rm.tenant_id = p_tenant_id
   where t.tenant_id = p_tenant_id and t.ref_id = p_ref_id and t.type = 'waste'
     and t.quantity < 0 and not t.legacy;
  if v_count = 0 or exists (select 1 from public.held_bills h where h.id = p_ref_id) then
    raise exception 'not_found';
  end if;

  if not v_all_mine and v_role not in ('owner', 'manager') then
    raise exception 'forbidden';
  end if;
  if v_first < now() - interval '10 minutes' then
    raise exception 'too_late';
  end if;

  -- Lock the materials in id order (the D1 order), then check "once": a second undo waits here and then
  -- sees the first one's rows.
  perform 1 from public.raw_materials rm
   where rm.tenant_id = p_tenant_id
     and rm.id in (select t.raw_material_id from public.inventory_transactions t
                    where t.tenant_id = p_tenant_id and t.ref_id = p_ref_id and t.type = 'waste'
                      and not t.legacy)
   order by rm.id
     for update;
  if exists (select 1 from public.inventory_transactions t
              where t.tenant_id = p_tenant_id and t.ref_id = p_ref_id and t.type = 'waste'
                and t.quantity > 0 and not t.legacy) then
    raise exception 'already_undone';
  end if;

  -- A material archived since the waste is restocked too (the waste deducted it).
  for v_row in
    select t.raw_material_id, t.quantity, t.unit_cost, t.reason
      from public.inventory_transactions t
      join public.raw_materials rm on rm.id = t.raw_material_id and rm.tenant_id = p_tenant_id
     where t.tenant_id = p_tenant_id and t.ref_id = p_ref_id and t.type = 'waste'
       and t.quantity < 0 and not t.legacy
     order by t.raw_material_id, t.id
  loop
    insert into public.inventory_transactions
      (tenant_id, raw_material_id, type, quantity, unit_cost, reason, ref_id, occurred_at, created_by)
    values (p_tenant_id, v_row.raw_material_id, 'waste', -v_row.quantity, v_row.unit_cost,
            'ย้อนกลับ · ' || coalesce(v_row.reason, ''), p_ref_id, now(), p_actor_id);
    update public.raw_materials
       set current_stock = current_stock - v_row.quantity, updated_at = now()
     where id = v_row.raw_material_id;
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- stock_flag_sold_while_out: the cashier sold although the system thought a material was out.
-- One flag per material per business day (the Bangkok date, as next_queue_number counts the day), via the
-- partial unique index stock_flags_one_sold_while_out_per_day. Ids of another shop are ignored: a foreign
-- material gets no flag, and a foreign menu is left off the flag. Returns the number of flags inserted.
-- ---------------------------------------------------------------------------
create or replace function public.stock_flag_sold_while_out(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_material_ids uuid[],
  p_product_id uuid
)
returns int
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_product uuid;
  v_n int;
begin
  if not exists (select 1 from public.profiles p
                  where p.id = p_actor_id and p.tenant_id = p_tenant_id and p.deactivated_at is null) then
    raise exception 'forbidden';
  end if;

  select pr.id into v_product from public.products pr
   where pr.id = p_product_id and pr.tenant_id = p_tenant_id;

  insert into public.stock_flags (tenant_id, kind, raw_material_id, product_id, business_date, created_by)
  select p_tenant_id, 'sold_while_out', rm.id, v_product, (now() at time zone 'Asia/Bangkok')::date, p_actor_id
    from public.raw_materials rm
   where rm.tenant_id = p_tenant_id and rm.id = any(coalesce(p_material_ids, '{}'::uuid[]))
   order by rm.id
  on conflict (tenant_id, raw_material_id, business_date) where kind = 'sold_while_out' do nothing;
  get diagnostics v_n = row_count;

  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- stock_flag_resolve: an owner/manager marks a flag as handled. A flag already resolved keeps its first
-- resolution.
-- ---------------------------------------------------------------------------
create or replace function public.stock_flag_resolve(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_flag_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role text;
begin
  select p.role into v_role from public.profiles p
   where p.id = p_actor_id and p.tenant_id = p_tenant_id and p.deactivated_at is null;
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'forbidden';
  end if;

  update public.stock_flags
     set resolved_at = now(), resolved_by = p_actor_id
   where id = p_flag_id and tenant_id = p_tenant_id and resolved_at is null;
  if not found and not exists (select 1 from public.stock_flags f
                                where f.id = p_flag_id and f.tenant_id = p_tenant_id) then
    raise exception 'not_found';
  end if;
end;
$$;

-- ── grants ─────────────────────────────────────────────────────────────────
-- service role only
revoke all on function public.set_menu_paused(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.stock_waste_undo(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.stock_flag_sold_while_out(uuid, uuid, uuid[], uuid) from public, anon, authenticated;
revoke all on function public.stock_flag_resolve(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_menu_paused(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.stock_waste_undo(uuid, uuid, uuid) to service_role;
grant execute on function public.stock_flag_sold_while_out(uuid, uuid, uuid[], uuid) to service_role;
grant execute on function public.stock_flag_resolve(uuid, uuid, uuid) to service_role;
-- the user client (owner/manager, checked inside); anon never
revoke execute on function public.save_packaging_set(uuid, text, jsonb) from public, anon;
grant execute on function public.save_packaging_set(uuid, text, jsonb) to authenticated;
revoke execute on function public.archive_packaging_set(uuid) from public, anon;
grant execute on function public.archive_packaging_set(uuid) to authenticated;
