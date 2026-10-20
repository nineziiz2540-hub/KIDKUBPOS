-- Changing a bill from cash to transfer failed with orders_cash_tendered_check (migration
-- 20260925120000): cash_received / change_amount may only be set on cash bills. The cash that was
-- tendered at the till doesn't apply to a transfer, so clear both when moving to transfer.
-- Moving transfer → cash leaves them null, which the constraint allows. CREATE OR REPLACE keeps
-- the service-role-only grants from 20261021120000.
create or replace function public.order_change_payment_method(
  p_tenant_id uuid, p_order_id uuid, p_to_method text,
  p_actor_id uuid, p_approver_id uuid, p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_to_method is null or p_to_method not in ('cash', 'transfer') then
    raise exception 'invalid_method';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reason_required';
  end if;
  select * into v_order from public.orders
  where id = p_order_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if not exists (select 1 from public.profiles where id = p_actor_id and tenant_id = p_tenant_id)
     or not exists (select 1 from public.profiles
                    where id = p_approver_id and tenant_id = p_tenant_id
                      and role in ('owner', 'manager'))
  then
    raise exception 'forbidden';
  end if;
  if v_order.status <> 'completed' then
    raise exception 'invalid_state';
  end if;
  if v_order.payment_method = p_to_method then
    raise exception 'same_method';
  end if;
  -- A closed shift's expected cash and variance are already snapshotted; changing the method
  -- afterwards would leave that reconciliation silently wrong.
  if v_order.shift_id is not null and not exists (
    select 1 from public.shifts where id = v_order.shift_id and status = 'open'
  ) then
    raise exception 'shift_closed';
  end if;

  update public.orders
  set payment_method = p_to_method,
      cash_received = case when p_to_method = 'transfer' then null else cash_received end,
      change_amount = case when p_to_method = 'transfer' then null else change_amount end,
      transfer_verified_at = case when p_to_method = 'cash' then null else transfer_verified_at end,
      transfer_verified_by = case when p_to_method = 'cash' then null else transfer_verified_by end
  where id = p_order_id;

  insert into public.order_adjustments
    (tenant_id, order_id, kind, from_value, to_value, reason, actor_id, approver_id)
  values
    (p_tenant_id, p_order_id, 'payment_method_change', v_order.payment_method, p_to_method,
     btrim(p_reason), p_actor_id, p_approver_id);
end;
$$;
