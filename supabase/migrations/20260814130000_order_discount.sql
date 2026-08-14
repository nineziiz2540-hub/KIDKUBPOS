alter table public.orders
  add column subtotal numeric not null default 0,
  add column discount_type text,
  add column discount_value numeric,
  add column discount_amount numeric not null default 0,
  add column discount_reason text,
  add column discount_approved_by uuid references public.profiles(id);

update public.orders set subtotal = total;

alter table public.orders
  add constraint orders_discount_type_check
    check (discount_type is null or discount_type in ('percent', 'amount'));

comment on column public.orders.subtotal is
  'Pre-discount sum of order_items.subtotal. Equals total when no discount was applied.';
comment on column public.orders.discount_type is
  '''percent'' or ''amount''. Null if no discount was applied to this order.';
comment on column public.orders.discount_value is
  'Raw value staff entered (e.g. 10 for 10%, 20 for a ฿20 discount). Null if no discount.';
comment on column public.orders.discount_amount is
  'Resolved baht amount deducted, computed server-side. 0 if no discount.';
comment on column public.orders.discount_reason is
  'Required only when the discount crossed the approval threshold (>20% or >฿100).';
comment on column public.orders.discount_approved_by is
  'Profile whose PIN matched during discount approval. Null when under threshold (no approval needed).';

-- orders_insert_own_tenant's RLS has no WITH CHECK beyond tenant_id/created_by, so any
-- authenticated tenant member could otherwise INSERT an order claiming any discount_approved_by
-- they like via the public Data API, fully bypassing the PIN check createOrder performs before
-- setting it — same class of gap as void order's cancelled_approved_by. This blocks any
-- non-service_role insert that sets discount_approved_by; createOrder uses the admin
-- (service_role) client for that specific insert once a PIN has been verified, so auth.uid() is
-- NULL there and the check never fires for the legitimate path.
create or replace function public.prevent_direct_discount_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.discount_approved_by is not null and auth.uid() is not null then
    raise exception 'Discount approval requires PIN verification via the app';
  end if;
  return new;
end;
$$;

create trigger prevent_direct_discount_approval_trigger
before insert on public.orders
for each row
execute function public.prevent_direct_discount_approval();
