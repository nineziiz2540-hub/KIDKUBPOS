-- Final review (round A): deactivating a team member only sets profiles.deactivated_at and keeps
-- their role and pin_hash, so a fired manager's PIN could still approve bill adjustments. The
-- actor and approver must now be active members. CREATE OR REPLACE keeps the service-role-only
-- grants from 20261021120000. Bodies are otherwise unchanged (order_change_payment_method is the
-- 20261021130000 version that clears cash tendered on cash → transfer).

create or replace function public.order_mark_unpaid(
  p_tenant_id uuid, p_order_id uuid, p_actor_id uuid, p_approver_id uuid, p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reason_required';
  end if;
  select * into v_order from public.orders
  where id = p_order_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if not exists (select 1 from public.profiles where id = p_actor_id and tenant_id = p_tenant_id and deactivated_at is null)
     or not exists (select 1 from public.profiles
                    where id = p_approver_id and tenant_id = p_tenant_id
                      and role in ('owner', 'manager') and deactivated_at is null)
  then
    raise exception 'forbidden';
  end if;
  if v_order.status <> 'completed' or v_order.payment_method <> 'transfer' then
    raise exception 'invalid_state';
  end if;

  update public.orders
  set status = 'unpaid',
      unpaid_at = now(),
      unpaid_by = p_actor_id,
      unpaid_approved_by = p_approver_id,
      unpaid_reason = btrim(p_reason),
      transfer_verified_at = null,
      transfer_verified_by = null
  where id = p_order_id;

  insert into public.order_adjustments
    (tenant_id, order_id, kind, from_value, to_value, reason, actor_id, approver_id)
  values
    (p_tenant_id, p_order_id, 'mark_unpaid', 'completed', 'unpaid', btrim(p_reason), p_actor_id, p_approver_id);
end;
$$;

create or replace function public.order_restore_paid(
  p_tenant_id uuid, p_order_id uuid, p_actor_id uuid, p_approver_id uuid, p_reason text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reason_required';
  end if;
  select * into v_order from public.orders
  where id = p_order_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if not exists (select 1 from public.profiles where id = p_actor_id and tenant_id = p_tenant_id and deactivated_at is null)
     or not exists (select 1 from public.profiles
                    where id = p_approver_id and tenant_id = p_tenant_id
                      and role in ('owner', 'manager') and deactivated_at is null)
  then
    raise exception 'forbidden';
  end if;
  if v_order.status <> 'unpaid' then
    raise exception 'invalid_state';
  end if;

  update public.orders
  set status = 'completed',
      unpaid_at = null,
      unpaid_by = null,
      unpaid_approved_by = null,
      unpaid_reason = null,
      transfer_verified_at = null,
      transfer_verified_by = null
  where id = p_order_id;

  insert into public.order_adjustments
    (tenant_id, order_id, kind, from_value, to_value, reason, actor_id, approver_id)
  values
    (p_tenant_id, p_order_id, 'restore_paid', 'unpaid', 'completed', btrim(p_reason), p_actor_id, p_approver_id);
end;
$$;

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
  if not exists (select 1 from public.profiles where id = p_actor_id and tenant_id = p_tenant_id and deactivated_at is null)
     or not exists (select 1 from public.profiles
                    where id = p_approver_id and tenant_id = p_tenant_id
                      and role in ('owner', 'manager') and deactivated_at is null)
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

create or replace function public.order_set_transfer_verified(
  p_tenant_id uuid, p_order_id uuid, p_actor_id uuid, p_verified boolean
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders
  where id = p_order_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if not exists (select 1 from public.profiles
                 where id = p_actor_id and tenant_id = p_tenant_id
                   and role in ('owner', 'manager') and deactivated_at is null)
  then
    raise exception 'forbidden';
  end if;
  if v_order.status <> 'completed' or v_order.payment_method <> 'transfer' then
    raise exception 'invalid_state';
  end if;

  update public.orders
  set transfer_verified_at = case when p_verified then now() else null end,
      transfer_verified_by = case when p_verified then p_actor_id else null end
  where id = p_order_id;
end;
$$;
