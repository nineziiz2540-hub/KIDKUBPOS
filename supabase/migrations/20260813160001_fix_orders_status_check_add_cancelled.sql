-- Discovered while implementing the void-order feature (task-1-brief.md Step 8 live QA):
-- the pre-existing orders_status_check constraint only allowed status IN ('completed', 'voided'),
-- but public.orders.status = 'cancelled' is the convention used everywhere else in the app
-- (every dal.ts analytics query filters `.neq("status", "cancelled")`, and the void-order
-- migration's own column comments reference status = 'cancelled'). Without this fix, every
-- voidOrder() call fails the CHECK constraint. No production order has ever used 'voided' or
-- 'cancelled' (all 6 existing rows are 'completed'), so this is a safe, additive fix.
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status = any (array['completed'::text, 'voided'::text, 'cancelled'::text]));
