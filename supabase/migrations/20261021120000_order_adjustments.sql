-- Order history round A: "ไม่ได้รับเงิน" (unpaid) status, transfer check, and PIN-approved
-- payment-method changes, each recorded in an append-only history.
--
-- Every write here goes through service-role-only functions called by server actions that have
-- already verified a manager/owner PIN. A guard trigger rejects the same writes from any
-- caller whose auth.uid() is non-null, i.e. straight Data-API PATCH/INSERTs by tenant members
-- (orders_update_own_tenant has no WITH CHECK, the gap already closed for void/discount/refund).
-- Safe for the deployed code: it never writes these columns or the new status.

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table public.orders
  add column unpaid_at timestamptz,
  add column unpaid_by uuid references public.profiles (id),
  add column unpaid_approved_by uuid references public.profiles (id),
  add column unpaid_reason text,
  add column transfer_verified_at timestamptz,
  add column transfer_verified_by uuid references public.profiles (id);

comment on column public.orders.unpaid_at is
  'When the bill was marked ไม่ได้รับเงิน (transfer never arrived). Null unless status = ''unpaid''.';
comment on column public.orders.transfer_verified_at is
  'When an owner/manager ticked เจอเงินแล้ว for this transfer bill. Null = not checked yet.';

-- ── Status values ───────────────────────────────────────────────────────────
-- 'voided' was never written by any code (0 rows when this was written), so it is dropped.
alter table public.orders drop constraint orders_status_check;
alter table public.orders
  add constraint orders_status_check
    check (status = any (array['completed', 'cancelled', 'refunded', 'unpaid']));

-- ── Append-only adjustment history ──────────────────────────────────────────
create table public.order_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  order_id uuid not null references public.orders (id) on delete restrict,
  kind text not null
    check (kind in ('payment_method_change', 'mark_unpaid', 'restore_paid')),
  from_value text not null,
  to_value text not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  actor_id uuid references public.profiles (id),
  approver_id uuid references public.profiles (id),
  -- clock_timestamp, not now(): several adjustments in one transaction must keep their order.
  created_at timestamptz not null default clock_timestamp()
);

create index order_adjustments_order_idx on public.order_adjustments (order_id, created_at);
create index order_adjustments_tenant_idx on public.order_adjustments (tenant_id, created_at);

alter table public.order_adjustments enable row level security;

create policy order_adjustments_select on public.order_adjustments
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());

revoke all on public.order_adjustments from anon;
revoke insert, update, delete, truncate on public.order_adjustments from authenticated;

-- ── Guard against direct Data-API writes ────────────────────────────────────
create or replace function public.prevent_direct_order_adjustment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'unpaid'
       or new.unpaid_at is not null
       or new.unpaid_by is not null
       or new.unpaid_approved_by is not null
       or new.unpaid_reason is not null
       or new.transfer_verified_at is not null
       or new.transfer_verified_by is not null
    then
      raise exception 'Marking a bill unpaid or checking a transfer requires PIN approval via the app';
    end if;
  else
    if (new.status is distinct from old.status and (new.status = 'unpaid' or old.status = 'unpaid'))
       or new.unpaid_at is distinct from old.unpaid_at
       or new.unpaid_by is distinct from old.unpaid_by
       or new.unpaid_approved_by is distinct from old.unpaid_approved_by
       or new.unpaid_reason is distinct from old.unpaid_reason
       or new.transfer_verified_at is distinct from old.transfer_verified_at
       or new.transfer_verified_by is distinct from old.transfer_verified_by
    then
      raise exception 'Marking a bill unpaid or checking a transfer requires PIN approval via the app';
    end if;
  end if;
  return new;
end;
$$;

create trigger prevent_direct_order_adjustment_trigger
before insert or update on public.orders
for each row
execute function public.prevent_direct_order_adjustment();

revoke execute on function public.prevent_direct_order_adjustment() from public, anon, authenticated;

-- ── Service-only adjustment functions ───────────────────────────────────────
-- Shared checks: the reason is non-blank, the order belongs to the tenant (locked FOR UPDATE so
-- two managers acting at once serialize), the actor is a member of the tenant and the approver
-- an owner/manager of it.

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
  if not exists (select 1 from public.profiles where id = p_actor_id and tenant_id = p_tenant_id)
     or not exists (select 1 from public.profiles
                    where id = p_approver_id and tenant_id = p_tenant_id
                      and role in ('owner', 'manager'))
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
  if not exists (select 1 from public.profiles where id = p_actor_id and tenant_id = p_tenant_id)
     or not exists (select 1 from public.profiles
                    where id = p_approver_id and tenant_id = p_tenant_id
                      and role in ('owner', 'manager'))
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
                   and role in ('owner', 'manager'))
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

revoke execute on function public.order_mark_unpaid(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.order_restore_paid(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.order_change_payment_method(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.order_set_transfer_verified(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.order_mark_unpaid(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.order_restore_paid(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.order_change_payment_method(uuid, uuid, text, uuid, uuid, text) to service_role;
grant execute on function public.order_set_transfer_verified(uuid, uuid, uuid, boolean) to service_role;
