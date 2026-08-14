-- prevent_direct_discount_approval (BEFORE INSERT) only protects order creation.
-- orders_update_own_tenant's RLS has no WITH CHECK either, so any authenticated tenant member
-- could PATCH an existing order's discount_* columns directly via the Data API -- either forging
-- discount_approved_by on an order that was never approved, or silently altering
-- discount_amount/discount_reason after the fact -- with no PIN check at all. createOrder never
-- updates these columns after insert (discount is set once, at order creation), so blocking every
-- non-service_role write to them is safe and closes the same class of gap
-- prevent_direct_order_void already closes for the cancel_* columns.
create or replace function public.prevent_direct_discount_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
       new.discount_type is distinct from old.discount_type
    or new.discount_value is distinct from old.discount_value
    or new.discount_amount is distinct from old.discount_amount
    or new.discount_reason is distinct from old.discount_reason
    or new.discount_approved_by is distinct from old.discount_approved_by
     )
     and auth.uid() is not null
  then
    raise exception 'Discount approval requires PIN verification via the app';
  end if;
  return new;
end;
$$;

create trigger prevent_direct_discount_update_trigger
before update on public.orders
for each row
execute function public.prevent_direct_discount_update();
