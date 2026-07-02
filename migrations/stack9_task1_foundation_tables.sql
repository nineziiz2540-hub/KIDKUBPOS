-- Stack 9 Task 1: Create foundation tables
-- Applied: 2026-07-02
-- Execute via Supabase MCP execute_sql

-- ============================================================
-- UP
-- ============================================================

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  phone text,
  email text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, phone)
);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON customers
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE TABLE raw_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  unit text NOT NULL,
  cost_per_unit numeric(10,4) NOT NULL DEFAULT 0,
  current_stock numeric(10,3) NOT NULL DEFAULT 0,
  min_stock_alert numeric(10,3) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE raw_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON raw_materials
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE TABLE modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  is_required boolean DEFAULT false,
  is_multi_select boolean DEFAULT false,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE modifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modifiers
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- No RLS on modifier_options: access controlled via JOIN with modifiers (which has RLS)
CREATE TABLE modifier_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modifier_id uuid NOT NULL REFERENCES modifiers(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_delta numeric(8,2) DEFAULT 0,
  sort_order int DEFAULT 0
);

-- ============================================================
-- DOWN (rollback)
-- ============================================================
-- DROP TABLE IF EXISTS modifier_options CASCADE;
-- DROP TABLE IF EXISTS modifiers CASCADE;
-- DROP TABLE IF EXISTS raw_materials CASCADE;
-- DROP TABLE IF EXISTS customers CASCADE;
