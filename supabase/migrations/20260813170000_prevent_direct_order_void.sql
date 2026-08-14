-- orders_update_own_tenant has no WITH CHECK, so any authenticated tenant member can PATCH
-- ANY order's status/cancelled_* columns directly via the public Data API, completely bypassing
-- the PIN-approval modal voidOrder() enforces at the application layer. Confirmed live-exploitable
-- (same class of gap as the profiles_update_own fix from 2026-08-12/13). This blocks any
-- non-service_role write that changes status into 'cancelled' or touches any cancelled_* column;
-- voidOrder is being switched to use the admin (service_role) client for this exact write, so
-- auth.uid() is NULL there and the check never fires for the legitimate path.
create or replace function public.prevent_direct_order_void()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
       (new.status is distinct from old.status and new.status = 'cancelled')
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

create trigger prevent_direct_order_void_trigger
before update on public.orders
for each row
execute function public.prevent_direct_order_void();
