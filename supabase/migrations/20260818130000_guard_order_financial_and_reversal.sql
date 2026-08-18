-- authenticated holds a table-wide UPDATE grant on orders, orders_update_own_tenant's RLS has
-- USING (tenant_id = ...) with no WITH CHECK, and none of the three existing BEFORE UPDATE
-- triggers (prevent_direct_order_void, prevent_direct_discount_update,
-- prevent_direct_order_refund) touches total, shift_id, or payment_method. That means any
-- authenticated tenant member can PATCH any order's total directly through the Data API — no PIN,
-- no trigger. Combined with the refund feature's cash-drawer math (getShiftSummary sums total for
-- cash refunds tagged to a shift), this lets someone silently misstate how much cash should be in
-- a drawer, including for orders in an already-closed, already-reconciled shift. No legitimate
-- application code path updates these three columns after an order is inserted (createOrder only
-- INSERTs; voidOrder/refundOrder/discount's approval flow each only touch their own
-- status/approval columns), so blocking every non-service_role write to
-- total/shift_id/payment_method is unconditionally safe.
create or replace function public.prevent_direct_order_financial_tamper()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
       new.total is distinct from old.total
    or new.shift_id is distinct from old.shift_id
    or new.payment_method is distinct from old.payment_method
     )
     and auth.uid() is not null
  then
    raise exception 'Modifying an order''s total, shift, or payment method requires a service-role write';
  end if;
  return new;
end;
$$;

create trigger prevent_direct_order_financial_tamper_trigger
before update on public.orders
for each row
execute function public.prevent_direct_order_financial_tamper();

-- prevent_direct_order_void previously only guarded *entering* the 'cancelled' state, not
-- *leaving* it. A direct PATCH setting {"status":"completed"} on an already-voided order tripped
-- nothing, since the attacker doesn't need to touch cancelled_*/cancelled_by at all — just flip
-- status back. That silently un-does a Manager-approved void and re-enters the order into every
-- revenue query. This also blocks status changing away from 'cancelled' once set.
create or replace function public.prevent_direct_order_void()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
       (new.status is distinct from old.status and new.status = 'cancelled')
    or (old.status = 'cancelled' and new.status is distinct from old.status)
    or (new.cancelled_at is distinct from old.cancelled_at)
    or (new.cancelled_by is distinct from old.cancelled_by)
    or (new.cancelled_approved_by is distinct from old.cancelled_approved_by)
    or (new.cancel_reason is distinct from old.cancel_reason)
     )
     and auth.uid() is not null
  then
    raise exception 'Voiding an order requires PIN approval via the app';
  end if;
  return new;
end;
$$;

-- Same gap as prevent_direct_order_void, but for refunds: a direct PATCH setting
-- {"status":"completed"} on an already-refunded order tripped nothing, since only refund_* columns
-- (plus status *entering* 'refunded') were guarded, not status *leaving* 'refunded'. Left
-- unpatched, this would silently un-refund an order and make the shift-cash subtraction vanish
-- from getShiftSummary, since that query filters status = 'refunded'. Also blocks status changing
-- away from 'refunded' once set.
create or replace function public.prevent_direct_order_refund()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    if (
         new.status = 'refunded'
      or new.refunded_at is not null
      or new.refunded_by is not null
      or new.refunded_approved_by is not null
      or new.refund_reason is not null
      or new.refund_method is not null
      or new.refund_shift_id is not null
       )
       and auth.uid() is not null
    then
      raise exception 'Refunding an order requires PIN verification via the app';
    end if;
  elsif TG_OP = 'UPDATE' then
    if (
         (new.status is distinct from old.status and new.status = 'refunded')
      or (old.status = 'refunded' and new.status is distinct from old.status)
      or (new.refunded_at is distinct from old.refunded_at)
      or (new.refunded_by is distinct from old.refunded_by)
      or (new.refunded_approved_by is distinct from old.refunded_approved_by)
      or (new.refund_reason is distinct from old.refund_reason)
      or (new.refund_method is distinct from old.refund_method)
      or (new.refund_shift_id is distinct from old.refund_shift_id)
       )
       and auth.uid() is not null
    then
      raise exception 'Refunding an order requires PIN verification via the app';
    end if;
  end if;
  return new;
end;
$$;
