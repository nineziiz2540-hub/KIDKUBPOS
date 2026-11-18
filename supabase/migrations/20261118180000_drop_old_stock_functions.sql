-- Round D1, phase two. APPLY ONLY AFTER THE D1 DEPLOY IS READY: until then the deployed app
-- still calls deduct_stock_for_order and restock_for_voided_order.
-- Apply together with 20261118160000_stock_lockdown.sql (also phase two), lockdown first.
-- Signatures read from the live database in Task 0 (docs/superpowers/plans/2026-11-18-stock-round-d1-live-db.md).
drop function public.deduct_stock_for_order(uuid);
drop function public.restock_for_voided_order(uuid);
