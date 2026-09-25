-- Cash tendered + change given, recorded at checkout for cash orders so the receipt can show
-- "รับเงิน ฿100 ทอน ฿15" and a drawer shortfall at shift close can be traced back to the bill
-- where too much change was handed out. Both are NULL for transfer orders and for every order
-- created before this migration.
alter table public.orders
  add column cash_received numeric(10,2),
  add column change_amount numeric(10,2);

-- The Data API accepts direct INSERTs from any tenant member, so the arithmetic is enforced here
-- rather than trusted from createOrder alone: either both columns are absent, or the order is
-- cash, the customer paid at least the total, and the change is exactly the difference.
alter table public.orders
  add constraint orders_cash_tendered_check check (
    (cash_received is null and change_amount is null)
    or (
      payment_method = 'cash'
      and cash_received is not null
      and change_amount is not null
      and cash_received >= total
      and cash_received <= 1000000
      and change_amount = cash_received - total
    )
  );

-- Same threat as total/shift_id/payment_method (see 20260818130000): orders_update_own_tenant has
-- no WITH CHECK, so without this a member could later PATCH a bill's cash_received/change_amount
-- (keeping them consistent with each other) to hide who handed out too much change. No app path
-- updates these after insert, so blocking every non-service_role write to them is safe.
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
    or new.cash_received is distinct from old.cash_received
    or new.change_amount is distinct from old.change_amount
     )
     and auth.uid() is not null
  then
    raise exception 'Modifying an order''s total, shift, payment method, or cash tendered requires a service-role write';
  end if;
  return new;
end;
$$;
