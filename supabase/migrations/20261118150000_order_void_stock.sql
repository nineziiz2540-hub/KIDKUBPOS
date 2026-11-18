-- Round D1, migration D: voiding a paid bill asks "was the drink made?" per item, and a made drink
-- is waste. order_void replaces voidOrder's update + restock pair with one transaction; stock_waste
-- records waste lines (also used by the held-bill cancel, and later by the waste button).
-- Service-role functions: the server action resolves the caller and checks the PIN, the function
-- re-checks the actor against profiles. restock_for_voided_order stays in place (phase two drops it).

set local lock_timeout = '5s';

-- p_made: { "<order_item_id>": "all" | "none" | <integer cups made, 0..quantity> } for EVERY item.
-- The order update is the same write voidOrder made (same columns), from the service role, so the
-- orders guard triggers (auth.uid() is null) let it through exactly as before.
create or replace function public.order_void(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_approver_id uuid,
  p_order_id uuid,
  p_reason text,
  p_made jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_item record;
  v_sale record;
  v_made integer;
  v_val jsonb;
  v_restock numeric;
  v_ok boolean;
begin
  if not exists (select 1 from public.profiles p
                  where p.id = p_actor_id and p.tenant_id = p_tenant_id and p.deactivated_at is null) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.profiles p
                  where p.id = p_approver_id and p.tenant_id = p_tenant_id and p.deactivated_at is null
                    and p.role in ('owner', 'manager')) then
    raise exception 'forbidden';
  end if;
  if v_reason = '' or char_length(v_reason) > 500 then
    raise exception 'reason_required';
  end if;

  -- Same columns voidOrder wrote. Zero rows = already cancelled / refunded / unknown: nothing
  -- else happens, so a second call restocks nothing.
  update public.orders
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = p_actor_id,
         cancelled_approved_by = p_approver_id,
         cancel_reason = v_reason
   where id = p_order_id and tenant_id = p_tenant_id and status = 'completed';
  if not found then
    raise exception 'not_completed';
  end if;

  if p_made is null or jsonb_typeof(p_made) <> 'object' then
    raise exception 'invalid_made';
  end if;

  -- Every item needs an explicit answer; never default to "none". Any raise rolls the update back.
  for v_item in
    select oi.id, oi.quantity from public.order_items oi where oi.order_id = p_order_id
  loop
    v_val := p_made -> v_item.id::text;
    -- CASE keeps the numeric cast from running on a non-number.
    v_ok := case
      when v_val is null then false
      when v_val in ('"all"'::jsonb, '"none"'::jsonb) then true
      when jsonb_typeof(v_val) = 'number' then
        (v_val #>> '{}')::numeric = trunc((v_val #>> '{}')::numeric)
        and (v_val #>> '{}')::numeric between 0 and v_item.quantity
      else false
    end;
    if not v_ok then
      raise exception 'invalid_made';
    end if;
  end loop;

  -- Lock every material the order drew, in id order (same order as the other stock functions).
  perform 1 from public.raw_materials rm
   where rm.tenant_id = p_tenant_id
     and rm.id in (select t.raw_material_id from public.inventory_transactions t
                    where t.order_id = p_order_id and t.type = 'sale' and not t.legacy)
   order by rm.id
     for update;

  for v_item in
    select oi.id, oi.quantity from public.order_items oi where oi.order_id = p_order_id order by oi.id
  loop
    v_val := p_made -> v_item.id::text;
    v_made := case when v_val = '"all"'::jsonb then v_item.quantity
                   when v_val = '"none"'::jsonb then 0
                   else (v_val #>> '{}')::numeric::integer end;

    if v_made > 0 then
      update public.order_items set void_made = true where id = v_item.id;
    end if;

    if v_made >= v_item.quantity then
      continue;  -- every cup was made: nothing goes back on the shelf
    end if;

    -- A material archived since the sale is restocked too (the sale deducted it); only a material
    -- that no longer exists is skipped.
    for v_sale in
      select t.raw_material_id, t.quantity, t.unit_cost
        from public.inventory_transactions t
        join public.raw_materials rm on rm.id = t.raw_material_id and rm.tenant_id = p_tenant_id
       where t.order_item_id = v_item.id and t.type = 'sale' and not t.legacy
       order by t.raw_material_id
    loop
      v_restock := round(-v_sale.quantity * (v_item.quantity - v_made) / v_item.quantity, 3);
      if v_restock <= 0 then
        continue;
      end if;
      insert into public.inventory_transactions
        (tenant_id, raw_material_id, type, quantity, unit_cost, order_id, order_item_id,
         occurred_at, created_by)
      values (p_tenant_id, v_sale.raw_material_id, 'void_restock', v_restock, v_sale.unit_cost,
              p_order_id, v_item.id, now(), p_actor_id);
      update public.raw_materials
         set current_stock = current_stock + v_restock, updated_at = now()
       where id = v_sale.raw_material_id;
    end loop;
  end loop;
end;
$$;

-- p_lines: [{ "material_id": uuid, "qty": number }]. Lines that are foreign, archived, untracked or
-- invalid are skipped silently (the caller is a cancel that must not fail over stock data).
create or replace function public.stock_waste(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_lines jsonb,
  p_reason text,
  p_ref_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_lines jsonb;
  v_row record;
begin
  if not exists (select 1 from public.profiles p
                  where p.id = p_actor_id and p.tenant_id = p_tenant_id and p.deactivated_at is null) then
    raise exception 'forbidden';
  end if;
  if v_reason = '' or char_length(v_reason) > 500 then
    raise exception 'reason_required';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'invalid_lines';
  end if;

  -- Keep only lines with a well-formed id and a quantity in range.
  -- CASE keeps each cast from running on a value of the wrong type.
  select coalesce(jsonb_agg(jsonb_build_object('mat', x.mat, 'qty', round(x.qty, 3))), '[]')
    into v_lines
    from (
      select case when jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'material_id') = 'string'
                   and (e ->> 'material_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then e ->> 'material_id' end as mat,
             case when jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'qty') = 'number'
                  then (e ->> 'qty')::numeric end as qty
        from jsonb_array_elements(p_lines) e
    ) x
   where x.mat is not null and x.qty > 0 and x.qty < 10000000 and round(x.qty, 3) > 0;

  -- Lock the usable materials in id order.
  perform 1 from public.raw_materials rm
   where rm.tenant_id = p_tenant_id and rm.archived_at is null and rm.track_stock
     and rm.id in (select (l ->> 'mat')::uuid from jsonb_array_elements(v_lines) l)
   order by rm.id
     for update;

  for v_row in
    select rm.id, rm.cost_per_unit, sum((l ->> 'qty')::numeric) as qty
      from jsonb_array_elements(v_lines) l
      join public.raw_materials rm on rm.id = (l ->> 'mat')::uuid
     where rm.tenant_id = p_tenant_id and rm.archived_at is null and rm.track_stock
     group by rm.id, rm.cost_per_unit
     order by rm.id
  loop
    if v_row.qty <= 0 or v_row.qty >= 10000000 then
      continue;
    end if;
    insert into public.inventory_transactions
      (tenant_id, raw_material_id, type, quantity, unit_cost, reason, ref_id, occurred_at, created_by)
    values (p_tenant_id, v_row.id, 'waste', -v_row.qty, v_row.cost_per_unit, v_reason, p_ref_id,
            now(), p_actor_id);
    update public.raw_materials
       set current_stock = current_stock - v_row.qty, updated_at = now()
     where id = v_row.id;
  end loop;
end;
$$;

revoke all on function public.order_void(uuid, uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.stock_waste(uuid, uuid, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.order_void(uuid, uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.stock_waste(uuid, uuid, jsonb, text, uuid) to service_role;
