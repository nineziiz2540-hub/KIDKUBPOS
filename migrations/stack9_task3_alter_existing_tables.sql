-- Stack 9 Task 3: Alter Existing Tables
-- Executed: 2026-07-02
-- Project: khgahdjfkzpgsvbhfrqx
-- Description: Add new columns to tenants, products, orders, order_items

-- ─── Step 1: Alter tenants ───────────────────────────────────────────────────
ALTER TABLE tenants
  ADD COLUMN fixed_cost_monthly numeric(12,2) DEFAULT 0,
  ADD COLUMN delivery_gp_percent numeric(5,2) DEFAULT 0,
  ADD COLUMN order_sequence int DEFAULT 0,
  ADD COLUMN order_prefix text DEFAULT 'KK';

-- ─── Step 2: Alter products ──────────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN image_url text,
  ADD COLUMN drink_type text CHECK (drink_type IN ('hot', 'iced', 'blended', 'special'));

-- Note: drink_type is nullable — Bakery/food products leave it NULL.

-- ─── Step 3: Alter orders ────────────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN order_number text,
  ADD COLUMN order_type text NOT NULL DEFAULT 'dine_in'
    CHECK (order_type IN ('dine_in', 'take_away')),
  ADD COLUMN table_number text,
  ADD COLUMN customer_id uuid REFERENCES customers(id);

-- Note: order_number is NULL for pre-migration rows; set via generate_order_number() in Stack 10.

-- ─── Step 4: Alter order_items ───────────────────────────────────────────────
ALTER TABLE order_items
  ADD COLUMN category_name text,
  ADD COLUMN modifiers_snapshot jsonb;

-- Note: modifiers_snapshot format: [{"group": "ความหวาน", "option": "50%", "priceDelta": 0}]

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK SQL (run in reverse order)
-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE order_items DROP COLUMN IF EXISTS category_name, DROP COLUMN IF EXISTS modifiers_snapshot;
-- ALTER TABLE orders DROP COLUMN IF EXISTS order_number, DROP COLUMN IF EXISTS order_type, DROP COLUMN IF EXISTS table_number, DROP COLUMN IF EXISTS customer_id;
-- ALTER TABLE products DROP COLUMN IF EXISTS image_url, DROP COLUMN IF EXISTS drink_type;
-- ALTER TABLE tenants DROP COLUMN IF EXISTS fixed_cost_monthly, DROP COLUMN IF EXISTS delivery_gp_percent, DROP COLUMN IF EXISTS order_sequence, DROP COLUMN IF EXISTS order_prefix;
