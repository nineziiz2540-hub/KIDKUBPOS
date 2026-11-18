# Round D1 — live database findings (Task 0)

Read 2026-11-18 from project `khgahdjfkzpgsvbhfrqx` (ACTIVE_HEALTHY, Postgres 17.6.1, after the restore). Read-only queries only.

## Matches the plan
- `raw_materials(id, tenant_id, name, unit, cost_per_unit, current_stock, min_stock_alert, created_at, updated_at)` — as assumed (Task 3).
- `inventory_transactions(id, tenant_id, raw_material_id, type, quantity, note, created_by, created_at)` — as assumed (Task 3).
- `product_recipes(id, tenant_id, product_id, raw_material_id NOT NULL, quantity_used)` — as assumed (Task 3).
- `order_record` body is byte-identical to `supabase/migrations/20261106120000_order_record_override_held.sql` (Task 4 assumption holds). It is not executable by `anon`/`authenticated` (service role only).
- `replace_product_recipes`, `save_menu`, `replace_product_modifiers`, `restock_for_voided_order`, `auth_role`, `auth_tenant_id` equal their latest migration files (the first two differ only by the comment lines, which were not applied).
- `authenticated` can insert/update/delete `raw_materials` and `inventory_transactions` through the policy `tenant_isolation` (ALL, roles public, USING tenant = caller's tenant, no WITH CHECK) — the hole Task 9 assumes.
- Old function signatures for Task 14: `deduct_stock_for_order(p_order_id uuid)`, `restock_for_voided_order(p_order_id uuid)`.

## Differences and extra facts (each with the task it affects)
1. **Task 3 — `inventory_transactions_type_check`** exists: `type in ('receive','deduct','adjust','void_restock')`. The new types `opening`, `sale`, `waste` would be rejected. Task 3 must drop this constraint and add the plan's `legacy or type in (...)` check.
2. **Task 3 — `product_recipes` constraints:** `UNIQUE (product_id, raw_material_id)` and `CHECK (quantity_used > 0 and quantity_used <= 100000)`. NULL material ids are distinct, so slot lines are not blocked by the unique key. There is no rule yet for one slot line per group (R20).
3. **Task 3 — indexes:** `inventory_transactions` has only its primary key (no index on tenant, material, order or order item).
4. **Task 3 — data:** one tenant only ("The Connect Brew&Bar", the real shop) with 0 materials, 0 recipes, 0 transactions and 15 orders. So the migration makes no opening rows, no legacy rows, and every frozen `cost_total` is null. It must still be written for the general case. There is no QA tenant; live checks must create one and delete it afterwards.
5. **Task 9 — grants:** `anon` and `authenticated` both have full table privileges (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, …) on `raw_materials`, `inventory_transactions`, `product_recipes`, `order_items`, `modifier_options`. RLS blocks `anon` today, but the grants are there.
6. **Task 9 — `order_items_insert` policy** (roles public): any member of a tenant may insert items into any order of that tenant through the Data API. There is no UPDATE/DELETE policy. App code never inserts `order_items` with the user client (orders go through `order_record` as service role). After D1 this policy would let a Staff forge `cost_total` / `choices` rows.
7. **Task 7 — `orders` triggers:** `prevent_direct_order_void`, `prevent_direct_order_refund`, `prevent_direct_order_adjustment`, `prevent_direct_order_financial_tamper`, `guard_order_drawer`, `prevent_direct_held_bill_link`, `prevent_direct_discount_*`, `set_updated_at`. The atomic `order_void` must pass the same guard the current void path uses.
8. **Task 14 (interim) — `deduct_stock_for_order`** is SECURITY INVOKER and executable by PUBLIC, `anon` and `authenticated`. Any tenant member can re-run the deduction on an order of their own tenant. The live impact is nil (0 materials). The deployed app still calls it with the user client, so it stays until Task 14 drops it after the D1 deploy.
9. No triggers on `raw_materials`, `product_recipes`, `inventory_transactions`, `order_items`, `modifier_options`.
10. `modifier_options` has no `tenant_id` (the tenant comes through `modifiers`). This is consistent with the plan, where `modifier_option_effects` carries its own `tenant_id`.

Controller rulings on these findings: R22–R25 in `.superpowers/sdd/2026-11-18-stock-round-d1/progress.md`.
