-- prevent_direct_discount_update guarded discount_type/value/amount/reason/approved_by against
-- direct non-service_role UPDATEs, but not subtotal -- so a tenant member could still directly
-- PATCH an approved order's subtotal via the Data API, partially forging the audit record after
-- the fact (subtotal feeds discount_amount/total consistency). createOrder never updates subtotal
-- after insert, so guarding it here is free and closes the same class of gap.
create or replace function public.prevent_direct_discount_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
       new.subtotal is distinct from old.subtotal
    or new.discount_type is distinct from old.discount_type
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
