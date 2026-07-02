-- Stack 9, Task 2: Transaction & Junction Tables
-- Executed: 2026-07-02
-- Project: khgahdjfkzpgsvbhfrqx (KIDKUBPOS)
-- Depends on: tenants, profiles, products, raw_materials, modifiers (Task 1)

-- ============================================================
-- Step 1: inventory_transactions
-- ============================================================
CREATE TABLE inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  raw_material_id uuid NOT NULL REFERENCES raw_materials(id),
  type text NOT NULL CHECK (type IN ('receive', 'deduct', 'adjust')),
  quantity numeric(10,3) NOT NULL,
  note text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON inventory_transactions
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ============================================================
-- Step 2: product_recipes
-- ============================================================
CREATE TABLE product_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  raw_material_id uuid NOT NULL REFERENCES raw_materials(id),
  quantity_used numeric(10,3) NOT NULL,
  UNIQUE (product_id, raw_material_id)
);
ALTER TABLE product_recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON product_recipes
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ============================================================
-- Step 3: product_modifiers (junction table)
-- ============================================================
CREATE TABLE product_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  modifier_id uuid NOT NULL REFERENCES modifiers(id) ON DELETE CASCADE,
  UNIQUE (product_id, modifier_id)
);
ALTER TABLE product_modifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON product_modifiers
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- ============================================================
-- ROLLBACK (run in reverse order to respect FK deps)
-- ============================================================
-- DROP TABLE IF EXISTS product_modifiers CASCADE;
-- DROP TABLE IF EXISTS product_recipes CASCADE;
-- DROP TABLE IF EXISTS inventory_transactions CASCADE;
