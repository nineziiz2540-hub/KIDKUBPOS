-- Round D1, migration C: atomic receive (moving average) and adjust with a reason, plus a 10-minute
-- undo of a receive. Service-role functions: the server action resolves the caller, the function
-- re-checks the actor against profiles.
--
-- Also widens raw_materials.cost_per_unit from numeric(10,4) to numeric(14,6): a moving average
-- would otherwise be truncated to 4 places on every receive. Widening never loses data and no
-- view depends on the column; the deployed app reads it as a plain number.

set lock_timeout = '5s';

alter table public.raw_materials alter column cost_per_unit type numeric(14,6);

-- One undo per receive: the undo row (an 'adjust' with this reason) points at the receive row.
create unique index inventory_transactions_one_undo_per_receive
  on public.inventory_transactions (ref_id)
  where type = 'adjust' and reason = 'ย้อนกลับการรับของ' and not legacy;

create or replace function public.stock_receive(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_material_id uuid,
  p_qty numeric,
  p_total_price numeric,
  p_note text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role text;
  v_mat record;
  v_qty numeric;
  v_unit numeric;
  v_new_cost numeric;
  v_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select p.role into v_role from public.profiles p
   where p.id = p_actor_id and p.tenant_id = p_tenant_id and p.deactivated_at is null;
  if v_role is null then
    raise exception 'forbidden';
  end if;

  -- NaN sorts above everything in numeric, so the range test rejects NaN and Infinity together.
  if p_qty is null or not (p_qty > 0 and p_qty < 10000000) then
    raise exception 'invalid_qty';
  end if;
  v_qty := round(p_qty, 3);
  if v_qty <= 0 then
    raise exception 'invalid_qty';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'invalid_note';
  end if;
  if p_total_price is not null then
    if v_role not in ('owner', 'manager') then
      raise exception 'forbidden_price';
    end if;
    if not (p_total_price >= 0 and p_total_price < 10000000)
       or p_total_price / v_qty >= 100000000 then
      raise exception 'invalid_price';
    end if;
  end if;

  select rm.id, rm.current_stock, rm.cost_per_unit into v_mat
    from public.raw_materials rm
   where rm.id = p_material_id and rm.tenant_id = p_tenant_id and rm.archived_at is null
     for update;
  if not found then
    raise exception 'material_not_found';
  end if;

  if p_total_price is null then
    -- No price: the average stays; the row records the cost in force.
    v_unit := v_mat.cost_per_unit;
    v_new_cost := v_mat.cost_per_unit;
  else
    -- Same as movingAverage() in src/lib/stock/units.ts: balance <= 0 -> the new lot's unit cost;
    -- otherwise (balance * avg + lot total) / (balance + qty). A price of 0 is a free lot.
    v_unit := round(p_total_price / v_qty, 6);
    if v_mat.current_stock <= 0 then
      v_new_cost := v_unit;
    else
      v_new_cost := round((v_mat.current_stock * v_mat.cost_per_unit + p_total_price)
                          / (v_mat.current_stock + v_qty), 6);
    end if;
  end if;

  insert into public.inventory_transactions
    (tenant_id, raw_material_id, type, quantity, unit_cost, note, occurred_at, created_by)
  values (p_tenant_id, p_material_id, 'receive', v_qty, v_unit, v_note, now(), p_actor_id)
  returning id into v_id;

  update public.raw_materials
     set current_stock = current_stock + v_qty, cost_per_unit = v_new_cost, updated_at = now()
   where id = p_material_id;

  return v_id;
end;
$$;

create or replace function public.stock_receive_undo(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_ledger_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role text;
  v_rec record;
begin
  select p.role into v_role from public.profiles p
   where p.id = p_actor_id and p.tenant_id = p_tenant_id and p.deactivated_at is null;
  if v_role is null then
    raise exception 'forbidden';
  end if;

  select t.id, t.raw_material_id, t.quantity, t.unit_cost, t.created_by, t.created_at into v_rec
    from public.inventory_transactions t
   where t.id = p_ledger_id and t.tenant_id = p_tenant_id and t.type = 'receive' and not t.legacy;
  if not found then
    raise exception 'not_a_receive';
  end if;

  if v_rec.created_by is distinct from p_actor_id and v_role not in ('owner', 'manager') then
    raise exception 'undo_forbidden';
  end if;
  if v_rec.created_at is null or now() - v_rec.created_at > interval '10 minutes' then
    raise exception 'undo_expired';
  end if;

  -- Serialise on the material, then check "once" (the partial unique index is the backstop).
  perform 1 from public.raw_materials rm
   where rm.id = v_rec.raw_material_id and rm.tenant_id = p_tenant_id for update;
  if exists (select 1 from public.inventory_transactions t
              where t.ref_id = p_ledger_id and t.type = 'adjust'
                and t.reason = 'ย้อนกลับการรับของ' and not t.legacy) then
    raise exception 'already_undone';
  end if;

  insert into public.inventory_transactions
    (tenant_id, raw_material_id, type, quantity, unit_cost, reason, ref_id, occurred_at, created_by)
  values (p_tenant_id, v_rec.raw_material_id, 'adjust', -v_rec.quantity, v_rec.unit_cost,
          'ย้อนกลับการรับของ', p_ledger_id, now(), p_actor_id);

  -- The average cost is deliberately NOT recomputed: the previous average is not stored, and a
  -- mistaken receive is caught within minutes; the next priced receive re-blends the cost.
  update public.raw_materials
     set current_stock = current_stock - v_rec.quantity, updated_at = now()
   where id = v_rec.raw_material_id;
end;
$$;

create or replace function public.stock_adjust(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_material_id uuid,
  p_new_balance numeric,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_role text;
  v_mat record;
  v_new numeric;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  select p.role into v_role from public.profiles p
   where p.id = p_actor_id and p.tenant_id = p_tenant_id and p.deactivated_at is null;
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'forbidden';
  end if;
  if v_reason = '' or char_length(v_reason) > 500 then
    raise exception 'reason_required';
  end if;
  if p_new_balance is null or not (p_new_balance >= 0 and p_new_balance < 10000000) then
    raise exception 'invalid_qty';
  end if;
  v_new := round(p_new_balance, 3);

  select rm.id, rm.current_stock, rm.cost_per_unit into v_mat
    from public.raw_materials rm
   where rm.id = p_material_id and rm.tenant_id = p_tenant_id and rm.archived_at is null
     for update;
  if not found then
    raise exception 'material_not_found';
  end if;

  insert into public.inventory_transactions
    (tenant_id, raw_material_id, type, quantity, unit_cost, reason, occurred_at, created_by)
  values (p_tenant_id, p_material_id, 'adjust', v_new - v_mat.current_stock, v_mat.cost_per_unit,
          v_reason, now(), p_actor_id);

  update public.raw_materials set current_stock = v_new, updated_at = now() where id = p_material_id;
end;
$$;

revoke all on function public.stock_receive(uuid, uuid, uuid, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.stock_receive_undo(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.stock_adjust(uuid, uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.stock_receive(uuid, uuid, uuid, numeric, numeric, text) to service_role;
grant execute on function public.stock_receive_undo(uuid, uuid, uuid) to service_role;
grant execute on function public.stock_adjust(uuid, uuid, uuid, numeric, text) to service_role;
