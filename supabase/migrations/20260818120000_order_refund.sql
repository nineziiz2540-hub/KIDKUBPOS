alter table public.orders
  add column refunded_at timestamptz,
  add column refunded_by uuid references public.profiles(id),
  add column refunded_approved_by uuid references public.profiles(id),
  add column refund_reason text,
  add column refund_method text,
  add column refund_shift_id uuid references public.shifts(id);

alter table public.orders drop constraint orders_status_check;
alter table public.orders
  add constraint orders_status_check
    check (status = any (array['completed', 'voided', 'cancelled', 'refunded']));

alter table public.orders
  add constraint orders_refund_method_check
    check (refund_method is null or refund_method in ('cash', 'transfer', 'card'));

comment on column public.orders.refunded_at is
  'Timestamp the order was refunded. Null unless status = ''refunded''.';
comment on column public.orders.refunded_by is
  'Profile that tapped "คืนเงิน" — the acting staff member (whoever getProfile() resolved to).';
comment on column public.orders.refunded_approved_by is
  'Profile whose PIN matched during the refund approval modal. Always role owner or manager.';
comment on column public.orders.refund_reason is
  'Required free-text reason entered in the refund modal.';
comment on column public.orders.refund_method is
  '''cash'' | ''transfer'' | ''card'' — independently selectable, not necessarily the same as
   the order''s original payment_method.';
comment on column public.orders.refund_shift_id is
  'The shift open at the moment of refund (NOT the original sale''s shift_id) — used to subtract
   cash refunds from the correct till in getShiftSummary.';

-- orders_insert_own_tenant's RLS has no WITH CHECK beyond tenant_id/created_by, and
-- orders_update_own_tenant has no WITH CHECK at all, so any authenticated tenant member could
-- otherwise fabricate a refund two ways: (a) INSERT a brand-new fake order with
-- status='refunded' and a forged refunded_approved_by, never having been a real sale at all, or
-- (b) UPDATE an existing order to set the same columns directly. Both both Void Order and
-- Discount needed a post-hoc Critical fix for exactly this class of gap on their own approval
-- columns — this trigger closes both write paths from the very first migration.
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

create trigger prevent_direct_order_refund_trigger
before insert or update on public.orders
for each row
execute function public.prevent_direct_order_refund();
