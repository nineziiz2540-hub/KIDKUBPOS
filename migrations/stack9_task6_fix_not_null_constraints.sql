-- Stack 9 Task 6 fix: add NOT NULL to columns that were missing it
-- Applied: 2026-07-02

-- UP
ALTER TABLE tenants ALTER COLUMN order_sequence SET NOT NULL;
ALTER TABLE tenants ALTER COLUMN order_prefix SET NOT NULL;
ALTER TABLE tenants ALTER COLUMN fixed_cost_monthly SET NOT NULL;
ALTER TABLE tenants ALTER COLUMN delivery_gp_percent SET NOT NULL;
ALTER TABLE modifiers ALTER COLUMN is_required SET NOT NULL;
ALTER TABLE modifiers ALTER COLUMN is_multi_select SET NOT NULL;

-- DOWN (rollback)
-- ALTER TABLE tenants ALTER COLUMN order_sequence DROP NOT NULL;
-- ALTER TABLE tenants ALTER COLUMN order_prefix DROP NOT NULL;
-- ALTER TABLE tenants ALTER COLUMN fixed_cost_monthly DROP NOT NULL;
-- ALTER TABLE tenants ALTER COLUMN delivery_gp_percent DROP NOT NULL;
-- ALTER TABLE modifiers ALTER COLUMN is_required DROP NOT NULL;
-- ALTER TABLE modifiers ALTER COLUMN is_multi_select DROP NOT NULL;
