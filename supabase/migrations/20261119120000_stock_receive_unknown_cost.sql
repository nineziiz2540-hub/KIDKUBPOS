-- Round D1 final review (ruling R43): a moving average of 0 means "cost never entered", so it is
-- UNKNOWN, not free: the first priced receive sets the average to that lot's unit cost instead of
-- diluting 0 (which left the cost at a fraction of the real price forever).
-- create or replace with the SAME 6-parameter signature as 20261118140000; only the averaging rule changed.

set local lock_timeout = '5s';

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
    -- Same as movingAverage() in src/lib/stock/units.ts: balance <= 0, or an average of 0 (a cost
    -- never entered: unknown, not free; ruling R43) -> the new lot's unit cost; otherwise
    -- (balance * avg + lot total) / (balance + qty). A price of 0 is a free lot.
    v_unit := round(p_total_price / v_qty, 6);
    if v_mat.current_stock <= 0 or v_mat.cost_per_unit = 0 then
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

revoke all on function public.stock_receive(uuid, uuid, uuid, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.stock_receive(uuid, uuid, uuid, numeric, numeric, text) to service_role;
