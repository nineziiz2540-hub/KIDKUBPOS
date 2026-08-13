-- Discovered while implementing the void-order feature (task-1-brief.md Step 8 live QA):
-- the pre-existing inventory_transactions_type_check constraint only allowed
-- type IN ('receive', 'deduct', 'adjust'), but the void-order migration's own
-- restock_for_voided_order() function inserts type = 'void_restock' (and the brief's own
-- QA plan explicitly checks for an inventory_transactions row with type = 'void_restock').
-- Without this fix, every restock_for_voided_order() call fails silently (the error is
-- caught and logged in voidOrder(), not surfaced to the user) and raw_materials.current_stock
-- is never restored. This is a safe, additive fix — no existing row uses 'void_restock'.
alter table public.inventory_transactions drop constraint inventory_transactions_type_check;
alter table public.inventory_transactions add constraint inventory_transactions_type_check
  check (type = any (array['receive'::text, 'deduct'::text, 'adjust'::text, 'void_restock'::text]));
