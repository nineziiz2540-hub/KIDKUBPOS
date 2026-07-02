# Stack 9 — Database Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run all SQL migrations in Supabase to create the schema for Stacks 10–13, set up Storage bucket for product images, and regenerate TypeScript types — zero application code written in this stack.

**Architecture:** All changes are pure SQL executed via Supabase MCP (`execute_sql`). Each task is a self-contained migration with its own verification query and rollback SQL. TypeScript types are regenerated at the end via MCP `generate_typescript_types`.

**Tech Stack:** Supabase PostgreSQL, Supabase Storage, Supabase MCP tools, TypeScript

## Global Constraints

- Multi-tenant: every new table has `tenant_id` with RLS policy `USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()))`
- Never commit `.env.local` or Supabase keys
- `npx tsc --noEmit` must pass with zero errors after Task 6
- All migrations must include rollback SQL at the bottom of each task
- Do NOT write any Next.js / React / TypeScript application code in this stack

---

## Pre-Flight: Load MCP Tools and Get Project ID

Before starting any task, load the Supabase MCP tools and find the project ID.

- [ ] **Load MCP tools via ToolSearch**

```
ToolSearch query: "select:mcp__16e06c41-6788-424e-9c6c-24e26391a284__execute_sql,mcp__16e06c41-6788-424e-9c6c-24e26391a284__list_projects,mcp__16e06c41-6788-424e-9c6c-24e26391a284__list_tables,mcp__16e06c41-6788-424e-9c6c-24e26391a284__generate_typescript_types"
```

- [ ] **Get project ID**

Call `list_projects`. Find the KIDKUBPOS project. Note the `id` field — this is `PROJECT_REF` used in all subsequent `execute_sql` calls.

Expected: one project entry with name matching your Supabase project. The `id` is a short alphanumeric string like `abcdefghijkl`.

---

## Task 1: Create Foundation Tables

**Files:** No code files. SQL only via Supabase MCP.

**Produces:**
- `customers` table with RLS
- `raw_materials` table with RLS
- `modifiers` table with RLS
- `modifier_options` table (no RLS — access controlled via parent `modifiers`)

**Creation order matters:** `customers` and `raw_materials` and `modifiers` have no new dependencies. `modifier_options` depends on `modifiers`, so it runs last.

- [ ] **Step 1: Create `customers` table**

Call `execute_sql` with `project_id = PROJECT_REF` and:

```sql
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
```

- [ ] **Step 2: Verify `customers`**

Call `execute_sql`:
```sql
SELECT
  t.table_name,
  p.rowsecurity,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'customers') AS policy_count
FROM information_schema.tables t
JOIN pg_tables p ON p.tablename = t.table_name AND p.schemaname = 'public'
WHERE t.table_schema = 'public' AND t.table_name = 'customers';
```

Expected: 1 row with `table_name = customers`, `rowsecurity = true`, `policy_count = 1`

- [ ] **Step 3: Create `raw_materials` table**

Call `execute_sql`:
```sql
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
```

- [ ] **Step 4: Create `modifiers` table**

Call `execute_sql`:
```sql
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
```

- [ ] **Step 5: Create `modifier_options` table**

Call `execute_sql`:
```sql
CREATE TABLE modifier_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modifier_id uuid NOT NULL REFERENCES modifiers(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_delta numeric(8,2) DEFAULT 0,
  sort_order int DEFAULT 0
);
```

Note: No RLS on this table intentionally. `modifier_options` contain no sensitive data (just names and price deltas). Access is always through a JOIN with `modifiers` which has RLS. Direct queries by ID are acceptable since UUIDs are hard to guess.

- [ ] **Step 6: Verify all 4 tables exist**

Call `execute_sql`:
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('customers', 'raw_materials', 'modifiers', 'modifier_options')
ORDER BY table_name;
```

Expected: 4 rows — `customers`, `modifier_options`, `modifiers`, `raw_materials`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "db: create foundation tables (customers, raw_materials, modifiers, modifier_options)"
```

**Rollback SQL (keep for reference, do not run unless reverting):**
```sql
DROP TABLE IF EXISTS modifier_options CASCADE;
DROP TABLE IF EXISTS modifiers CASCADE;
DROP TABLE IF EXISTS raw_materials CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
```

---

## Task 2: Create Transaction & Junction Tables

**Files:** No code files. SQL only.

**Depends on:** Task 1 (`raw_materials`, `modifiers` must exist), existing `products` and `profiles` tables.

**Produces:**
- `inventory_transactions` table with RLS
- `product_recipes` table with RLS
- `product_modifiers` junction table with RLS

- [ ] **Step 1: Create `inventory_transactions` table**

Call `execute_sql`:
```sql
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
```

- [ ] **Step 2: Create `product_recipes` table**

Call `execute_sql`:
```sql
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
```

- [ ] **Step 3: Create `product_modifiers` junction table**

Call `execute_sql`:
```sql
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
```

- [ ] **Step 4: Verify all 3 tables with RLS**

Call `execute_sql`:
```sql
SELECT t.table_name, p.rowsecurity,
  (SELECT count(*) FROM pg_policies WHERE tablename = t.table_name) AS policy_count
FROM information_schema.tables t
JOIN pg_tables p ON p.tablename = t.table_name AND p.schemaname = 'public'
WHERE t.table_schema = 'public'
  AND t.table_name IN ('inventory_transactions', 'product_recipes', 'product_modifiers')
ORDER BY t.table_name;
```

Expected: 3 rows, each with `rowsecurity = true`, `policy_count = 1`

- [ ] **Step 5: Verify FK constraints exist**

Call `execute_sql`:
```sql
SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('inventory_transactions', 'product_recipes', 'product_modifiers')
ORDER BY tc.table_name, kcu.column_name;
```

Expected: Multiple FK rows. Key ones to check:
- `inventory_transactions.raw_material_id` → `raw_materials`
- `product_recipes.product_id` → `products`
- `product_recipes.raw_material_id` → `raw_materials`
- `product_modifiers.product_id` → `products`
- `product_modifiers.modifier_id` → `modifiers`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "db: create transaction and junction tables (inventory_transactions, product_recipes, product_modifiers)"
```

**Rollback SQL:**
```sql
DROP TABLE IF EXISTS product_modifiers CASCADE;
DROP TABLE IF EXISTS product_recipes CASCADE;
DROP TABLE IF EXISTS inventory_transactions CASCADE;
```

---

## Task 3: Alter Existing Tables

**Files:** No code files. SQL only.

**Depends on:** Task 1 (`customers` must exist for `orders.customer_id` FK)

**Produces:** New columns on `tenants`, `products`, `orders`, `order_items`

**Order matters:** `tenants` must be altered before Postgres functions in Task 4 (they use `order_sequence` and `order_prefix`). `customers` must exist before `orders.customer_id` FK.

- [ ] **Step 1: Alter `tenants`**

Call `execute_sql`:
```sql
ALTER TABLE tenants
  ADD COLUMN fixed_cost_monthly numeric(12,2) DEFAULT 0,
  ADD COLUMN delivery_gp_percent numeric(5,2) DEFAULT 0,
  ADD COLUMN order_sequence int DEFAULT 0,
  ADD COLUMN order_prefix text DEFAULT 'KK';
```

- [ ] **Step 2: Alter `products`**

Call `execute_sql`:
```sql
ALTER TABLE products
  ADD COLUMN image_url text,
  ADD COLUMN drink_type text CHECK (drink_type IN ('hot', 'iced', 'blended', 'special'));
```

Note: `drink_type` is nullable — Bakery/food products leave it NULL. Only drink products set it.

- [ ] **Step 3: Alter `orders`**

Call `execute_sql`:
```sql
ALTER TABLE orders
  ADD COLUMN order_number text,
  ADD COLUMN order_type text NOT NULL DEFAULT 'dine_in'
    CHECK (order_type IN ('dine_in', 'take_away')),
  ADD COLUMN table_number text,
  ADD COLUMN customer_id uuid REFERENCES customers(id);
```

Note: `order_number` is NULL for existing orders (pre-migration). New orders set it via `generate_order_number()` in Stack 10.

- [ ] **Step 4: Alter `order_items`**

Call `execute_sql`:
```sql
ALTER TABLE order_items
  ADD COLUMN category_name text,
  ADD COLUMN modifiers_snapshot jsonb;
```

Note: `category_name` is a snapshot of the category at order time (for Dashboard charts). `modifiers_snapshot` format: `[{"group": "ความหวาน", "option": "50%", "priceDelta": 0}]`

- [ ] **Step 5: Verify all new columns exist**

Call `execute_sql`:
```sql
SELECT table_name, column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'tenants'     AND column_name IN ('fixed_cost_monthly', 'delivery_gp_percent', 'order_sequence', 'order_prefix'))
    OR (table_name = 'products'    AND column_name IN ('image_url', 'drink_type'))
    OR (table_name = 'orders'      AND column_name IN ('order_number', 'order_type', 'table_number', 'customer_id'))
    OR (table_name = 'order_items' AND column_name IN ('category_name', 'modifiers_snapshot'))
  )
ORDER BY table_name, column_name;
```

Expected: 12 rows total (4 on tenants, 2 on products, 4 on orders, 2 on order_items)

- [ ] **Step 6: Verify `orders.order_type` CHECK constraint exists**

Call `execute_sql`:
```sql
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_schema = 'public'
  AND check_clause LIKE '%dine_in%';
```

Expected: 1 row with clause containing `dine_in` and `take_away`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "db: alter existing tables (tenants, products, orders, order_items) with new columns"
```

**Rollback SQL:**
```sql
ALTER TABLE order_items DROP COLUMN IF EXISTS category_name, DROP COLUMN IF EXISTS modifiers_snapshot;
ALTER TABLE orders DROP COLUMN IF EXISTS order_number, DROP COLUMN IF EXISTS order_type, DROP COLUMN IF EXISTS table_number, DROP COLUMN IF EXISTS customer_id;
ALTER TABLE products DROP COLUMN IF EXISTS image_url, DROP COLUMN IF EXISTS drink_type;
ALTER TABLE tenants DROP COLUMN IF EXISTS fixed_cost_monthly, DROP COLUMN IF EXISTS delivery_gp_percent, DROP COLUMN IF EXISTS order_sequence, DROP COLUMN IF EXISTS order_prefix;
```

---

## Task 4: Create Postgres Functions

**Files:** No code files. SQL only.

**Depends on:** Task 3 (`tenants.order_sequence` and `tenants.order_prefix` must exist; `raw_materials.current_stock` must exist)

**Produces:**
- `generate_order_number(p_tenant_id uuid)` → `text`
- `deduct_stock_for_order(p_order_id uuid)` → `void`

- [ ] **Step 1: Create `generate_order_number` function**

Call `execute_sql`:
```sql
CREATE OR REPLACE FUNCTION generate_order_number(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  seq int;
  prefix text;
BEGIN
  UPDATE tenants
  SET order_sequence = order_sequence + 1
  WHERE id = p_tenant_id
  RETURNING order_sequence, order_prefix INTO seq, prefix;

  IF seq IS NULL THEN
    RAISE EXCEPTION 'Tenant not found: %', p_tenant_id;
  END IF;

  RETURN prefix || '.' || LPAD(seq::text, 3, '0');
END;
$$;
```

- [ ] **Step 2: Verify `generate_order_number` exists**

Call `execute_sql`:
```sql
SELECT routine_name, routine_type, data_type AS return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'generate_order_number';
```

Expected: 1 row with `routine_name = generate_order_number`, `return_type = text`

- [ ] **Step 3: Test `generate_order_number` with a real tenant**

Call `execute_sql`:
```sql
-- Get a real tenant ID from the database
SELECT id FROM tenants LIMIT 1;
```

Note the returned UUID. Then call `execute_sql` again:
```sql
-- Replace <TENANT_UUID> with the UUID from above
SELECT generate_order_number('<TENANT_UUID>') AS order_number;
```

Expected: Returns `KK.001` (first call — sequence was 0, now 1)

Call again:
```sql
SELECT generate_order_number('<TENANT_UUID>') AS order_number;
```

Expected: Returns `KK.002`

- [ ] **Step 4: Reset test sequence**

Call `execute_sql` to reset the counter back to 0 (so real orders start from KK.001):
```sql
UPDATE tenants SET order_sequence = 0 WHERE order_sequence > 0;
```

- [ ] **Step 5: Create `deduct_stock_for_order` function**

Call `execute_sql`:
```sql
CREATE OR REPLACE FUNCTION deduct_stock_for_order(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  r record;
  tenant uuid;
BEGIN
  SELECT tenant_id INTO tenant FROM orders WHERE id = p_order_id;

  IF tenant IS NULL THEN
    RAISE EXCEPTION 'Order not found: %', p_order_id;
  END IF;

  FOR r IN
    SELECT
      oi.product_id,
      oi.quantity        AS order_qty,
      pr.raw_material_id,
      pr.quantity_used
    FROM order_items oi
    JOIN product_recipes pr
      ON pr.product_id = oi.product_id
     AND pr.tenant_id  = tenant
    WHERE oi.order_id = p_order_id
  LOOP
    UPDATE raw_materials
    SET
      current_stock = GREATEST(0, current_stock - (r.quantity_used * r.order_qty)),
      updated_at    = now()
    WHERE id = r.raw_material_id;

    INSERT INTO inventory_transactions
      (tenant_id, raw_material_id, type, quantity, note)
    VALUES
      (tenant,
       r.raw_material_id,
       'deduct',
       -(r.quantity_used * r.order_qty),
       'Auto-deduct from order ' || p_order_id::text);
  END LOOP;
END;
$$;
```

- [ ] **Step 6: Verify both functions exist**

Call `execute_sql`:
```sql
SELECT routine_name, data_type AS return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('generate_order_number', 'deduct_stock_for_order')
ORDER BY routine_name;
```

Expected: 2 rows — `deduct_stock_for_order` (returns `void`) and `generate_order_number` (returns `text`)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "db: add generate_order_number and deduct_stock_for_order Postgres functions"
```

**Rollback SQL:**
```sql
DROP FUNCTION IF EXISTS deduct_stock_for_order(uuid);
DROP FUNCTION IF EXISTS generate_order_number(uuid);
```

---

## Task 5: Setup Supabase Storage Bucket

**Files:** No code files. Done via Supabase Dashboard (no MCP tool for storage bucket creation).

**Produces:** `product-images` bucket with public read + authenticated write policy

- [ ] **Step 1: Create bucket in Supabase Dashboard**

1. Open Supabase Dashboard → Storage → New Bucket
2. Bucket name: `product-images`
3. Check ✅ "Public bucket" (allows public read without authentication)
4. Click Create

- [ ] **Step 2: Set upload policy via SQL**

Call `execute_sql`:
```sql
CREATE POLICY "authenticated_upload"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "authenticated_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'product-images');

CREATE POLICY "authenticated_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'product-images');
```

Note: Public read is already handled by the "Public bucket" setting (Supabase adds a read policy automatically for public buckets).

- [ ] **Step 3: Verify bucket exists**

Call `execute_sql`:
```sql
SELECT name, public
FROM storage.buckets
WHERE name = 'product-images';
```

Expected: 1 row with `name = product-images`, `public = true`

- [ ] **Step 4: Verify storage policies**

Call `execute_sql`:
```sql
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname LIKE 'authenticated_%'
ORDER BY policyname;
```

Expected: 3 rows — `authenticated_delete`, `authenticated_update`, `authenticated_upload`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "db: setup product-images Storage bucket with auth upload policies"
```

---

## Task 6: Regenerate TypeScript Types

**Files:**
- Modify: `src/types/database.ts` (overwrite entire file with generated output)

**Depends on:** Tasks 1–5 (all schema changes must be in place)

**Produces:** Updated `database.ts` reflecting all new tables and columns

- [ ] **Step 1: Generate types via MCP**

Call `generate_typescript_types` with `project_id = PROJECT_REF`.

The tool returns a TypeScript file content string. Copy the entire output — it will be the new content of `src/types/database.ts`.

- [ ] **Step 2: Overwrite `src/types/database.ts`**

Write the full generated content to `src/types/database.ts` (overwrite the entire file).

Verify the new file contains references to the new tables:
- Should contain `customers:` table definition
- Should contain `raw_materials:` table definition
- Should contain `modifiers:` table definition
- Should contain `modifier_options:` table definition
- Should contain `inventory_transactions:` table definition
- Should contain `product_recipes:` table definition
- Should contain `product_modifiers:` table definition
- `products` Row should include `image_url: string | null` and `drink_type: string | null`
- `orders` Row should include `order_number: string | null`, `order_type: string`, `table_number: string | null`, `customer_id: string | null`
- `order_items` Row should include `category_name: string | null`, `modifiers_snapshot: Json | null`
- `tenants` Row should include `fixed_cost_monthly: number`, `delivery_gp_percent: number`, `order_sequence: number`, `order_prefix: string`

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors

If errors appear — they will be in existing code that uses types that changed (e.g., if `orders` now has a required `order_type` field with DEFAULT, the generated type may mark it as NOT NULL in Row but nullable in Insert). Fix any type errors inline in the affected files before committing. The most likely fix is ensuring `Insert` types have the new fields marked optional (they should be since they have DEFAULT values).

- [ ] **Step 4: Commit**

```bash
git add src/types/database.ts
git commit -m "db: regenerate TypeScript types from updated Supabase schema"
```

- [ ] **Step 5: Push to GitHub**

```bash
git push origin main
```

Expected output: `main -> main` with 6 new commits from this stack.

---

## Final Verification Checklist

Run this SQL to confirm all tables are in place before marking Stack 9 complete:

Call `execute_sql`:
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'customers', 'raw_materials', 'modifiers', 'modifier_options',
    'inventory_transactions', 'product_recipes', 'product_modifiers'
  )
ORDER BY table_name;
```
Expected: 7 rows

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'products'
  AND column_name IN ('image_url', 'drink_type');
```
Expected: 2 rows

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'orders'
  AND column_name IN ('order_number', 'order_type', 'table_number', 'customer_id');
```
Expected: 4 rows

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('generate_order_number', 'deduct_stock_for_order');
```
Expected: 2 rows

```sql
SELECT name FROM storage.buckets WHERE name = 'product-images';
```
Expected: 1 row

Stack 9 complete ✅ — ready for Stack 10 (Logic Layer).
