-- Shift management round B, migration B (lock-down).
--
-- APPLY ONLY AFTER the round B code is deployed: the old deployed code opens/closes shifts with
-- the user's own client and lets cash sales through with no shift, both of which this blocks.
--
-- 1. shifts: tenant members may only read. Every write goes through the service-only shift_*
--    functions (migration 20261022120000), so a Staff member can no longer change opening cash,
--    rewrite a variance, reopen or delete a shift through the Data API.
-- 2. orders: guard_order_drawer, for every caller (service role included), keeps the drawer
--    honest: a cash sale needs the tenant's open shift; nothing is inserted into a closed shift;
--    a cash void or cash refund only lands in an open shift. It takes FOR SHARE on the shift
--    row, so it waits for a concurrent shift_close (which holds FOR UPDATE) instead of slipping
--    in after the close has snapshotted the expected cash.
-- 3. order_change_payment_method: the same share lock, and a bill sold with no shift can no
--    longer become a cash bill (it would be cash outside every drawer).
--
-- The DB test supabase/tests/shift_lockdown_test.sql embeds this file's statements verbatim;
-- change both together.

-- ── 1. shifts: read-only for tenant members ────────────────────────────────
drop policy if exists tenant_isolation on public.shifts;
drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());
revoke all on public.shifts from anon;
revoke insert, update, delete, truncate on public.shifts from authenticated;

-- ── 2. orders: drawer guard ─────────────────────────────────────────────────
-- SECURITY DEFINER: FOR SHARE needs UPDATE privilege on shifts, which tenant members no longer
-- have; normal sales insert orders with the user's own client.
create or replace function public.guard_order_drawer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_tenant uuid;
begin
  if tg_op = 'INSERT' then
    if new.shift_id is not null then
      select s.status, s.tenant_id into v_status, v_tenant
      from public.shifts s where s.id = new.shift_id
      for share;
      if not found or v_tenant <> new.tenant_id or v_status <> 'open' then
        raise exception 'shift_closed';
      end if;
    elsif new.payment_method = 'cash' then
      raise exception 'no_open_shift';
    end if;
    return new;
  end if;

  -- A cash void gives cash back out of the bill's own drawer.
  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and new.payment_method = 'cash' and new.shift_id is not null then
    select s.status into v_status
    from public.shifts s where s.id = new.shift_id
    for share;
    if v_status is distinct from 'open' then
      raise exception 'shift_closed';
    end if;
  end if;

  -- A cash refund comes out of the drawer of the shift it happens in (refund_shift_id).
  if new.status = 'refunded' and old.status is distinct from 'refunded'
     and new.refund_method = 'cash' then
    if new.refund_shift_id is null then
      raise exception 'no_open_shift';
    end if;
    select s.status, s.tenant_id into v_status, v_tenant
    from public.shifts s where s.id = new.refund_shift_id
    for share;
    if not found or v_tenant <> new.tenant_id or v_status <> 'open' then
      raise exception 'shift_closed';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_order_drawer() from public, anon, authenticated;

drop trigger if exists guard_order_drawer_trigger on public.orders;
create trigger guard_order_drawer_trigger
before insert or update on public.orders
for each row execute function public.guard_order_drawer();

-- ── 3. payment-method change ────────────────────────────────────────────────
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
  v_shift_status text;
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
  if v_order.shift_id is null then
    -- Sold while no shift was open: as cash it would sit outside every drawer.
    if p_to_method = 'cash' then
      raise exception 'no_shift';
    end if;
  else
    -- A closed shift's expected cash and variance are already snapshotted; the share lock waits
    -- for a shift_close in progress instead of changing the bill under it.
    select s.status into v_shift_status
    from public.shifts s where s.id = v_order.shift_id
    for share;
    if v_shift_status is distinct from 'open' then
      raise exception 'shift_closed';
    end if;
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

revoke execute on function public.order_change_payment_method(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.order_change_payment_method(uuid, uuid, text, uuid, uuid, text) to service_role;
