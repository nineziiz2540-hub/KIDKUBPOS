# KIDKUBPOS — Cafe & Analytics Edition Design Spec

> **For agentic workers:** Use `superpowers:writing-plans` then `superpowers:executing-plans` per stack.
> Implement stacks in order: 9 → 10 → 11 & 12 (parallel) → 13.

**Goal:** Upgrade KIDKUBPOS into a full cafe POS with ingredient inventory, modifier system, CRM foundation, revamped POS UI, and advanced analytics dashboard.

**Architecture:** Next.js 16 App Router + Supabase (PostgreSQL + Storage). All business logic in Server Actions. DB is the source of truth — Postgres functions handle atomic operations (order number generation, stock deduction). Client state (cart) lives in React only.

**Tech Stack:** Next.js 16, Supabase SSR, TypeScript strict, shadcn/ui, Recharts (new), Supabase Storage (new)

## Global Constraints

- Multi-tenant: every table has `tenant_id` with RLS. Every query scoped to `profile.tenant_id`.
- `getUser()` (not `getSession()`) in all auth checks.
- Server Actions use `getProfile()` → role check → then query.
- No `.env.local` committed. Supabase keys in Vercel dashboard only.
- TypeScript strict + noUncheckedIndexedAccess must stay clean (`npx tsc --noEmit` = zero errors).
- Commit after each stack. Push after each stack completes.

---

## Section 1 — Complete Database Schema

### New Tables

#### `customers`
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
  UNIQUE (tenant_id, phone)  -- phone unique per tenant, nullable
);
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON customers
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
```

#### `raw_materials`
```sql
CREATE TABLE raw_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  unit text NOT NULL,               -- "กรัม", "มล.", "ชิ้น"
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

#### `inventory_transactions`
```sql
CREATE TABLE inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  raw_material_id uuid NOT NULL REFERENCES raw_materials(id),
  type text NOT NULL CHECK (type IN ('receive', 'deduct', 'adjust')),
  quantity numeric(10,3) NOT NULL,  -- positive=in, negative=out
  note text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON inventory_transactions
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
```

#### `product_recipes`
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

#### `modifiers`
```sql
CREATE TABLE modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,               -- "ความหวาน", "ท็อปปิ้ง"
  is_required boolean DEFAULT false,
  is_multi_select boolean DEFAULT false,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE modifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON modifiers
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
```

#### `modifier_options`
```sql
CREATE TABLE modifier_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modifier_id uuid NOT NULL REFERENCES modifiers(id) ON DELETE CASCADE,
  name text NOT NULL,               -- "50%", "ไข่มุก"
  price_delta numeric(8,2) DEFAULT 0,
  sort_order int DEFAULT 0
);
-- No RLS needed (no tenant_id); access controlled via modifier_id → modifiers (RLS)
```

#### `product_modifiers` (junction)
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

---

### Alterations to Existing Tables

#### `products`
```sql
ALTER TABLE products ADD COLUMN image_url text;
ALTER TABLE products ADD COLUMN drink_type text
  CHECK (drink_type IN ('hot', 'iced', 'blended', 'special'));
-- drink_type nullable — non-drink products (Bakery) leave it null
```

#### `orders`
```sql
ALTER TABLE orders ADD COLUMN order_number text;  -- set by trigger/function
ALTER TABLE orders ADD COLUMN order_type text NOT NULL DEFAULT 'dine_in'
  CHECK (order_type IN ('dine_in', 'take_away'));
ALTER TABLE orders ADD COLUMN table_number text;
ALTER TABLE orders ADD COLUMN customer_id uuid REFERENCES customers(id);
```

#### `order_items`
```sql
ALTER TABLE order_items ADD COLUMN category_name text;
-- snapshot of category at order time for dashboard charts
ALTER TABLE order_items ADD COLUMN modifiers_snapshot jsonb;
-- [{ "group": "ความหวาน", "option": "50%", "priceDelta": 0 }]
```

#### `tenants`
```sql
ALTER TABLE tenants ADD COLUMN fixed_cost_monthly numeric(12,2) DEFAULT 0;
ALTER TABLE tenants ADD COLUMN delivery_gp_percent numeric(5,2) DEFAULT 0;
ALTER TABLE tenants ADD COLUMN order_sequence int DEFAULT 0;
ALTER TABLE tenants ADD COLUMN order_prefix text DEFAULT 'KK';
```

---

### Postgres Functions

#### `generate_order_number(p_tenant_id uuid)` → text
Atomically increments `tenants.order_sequence` and returns formatted order number (e.g. `KK.001`).
```sql
CREATE OR REPLACE FUNCTION generate_order_number(p_tenant_id uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  seq int;
  prefix text;
BEGIN
  UPDATE tenants
  SET order_sequence = order_sequence + 1
  WHERE id = p_tenant_id
  RETURNING order_sequence, order_prefix INTO seq, prefix;
  RETURN prefix || '.' || LPAD(seq::text, 3, '0');
END;
$$;
```

#### `deduct_stock_for_order(p_order_id uuid)` → void
Reads all order_items for the order, looks up product_recipes, deducts raw_materials.current_stock atomically, inserts inventory_transactions rows.
```sql
CREATE OR REPLACE FUNCTION deduct_stock_for_order(p_order_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r record;
  tenant uuid;
BEGIN
  SELECT tenant_id INTO tenant FROM orders WHERE id = p_order_id;

  FOR r IN
    SELECT oi.product_id, oi.quantity AS order_qty,
           pr.raw_material_id, pr.quantity_used
    FROM order_items oi
    JOIN product_recipes pr ON pr.product_id = oi.product_id
    WHERE oi.order_id = p_order_id
      AND pr.tenant_id = tenant
  LOOP
    UPDATE raw_materials
    SET current_stock = GREATEST(0, current_stock - (r.quantity_used * r.order_qty)),
        updated_at = now()
    WHERE id = r.raw_material_id;

    INSERT INTO inventory_transactions
      (tenant_id, raw_material_id, type, quantity, note)
    VALUES
      (tenant, r.raw_material_id, 'deduct',
       -(r.quantity_used * r.order_qty),
       'Auto-deduct from order ' || p_order_id);
  END LOOP;
END;
$$;
```

### Supabase Storage
- Bucket: `product-images` — public read, authenticated write
- RLS policy: authenticated users in same tenant can upload

---

## Section 2 — Implementation Stacks

### Dependency Chain
```
Stack 9 (DB + Storage)
  └─► Stack 10 (Logic Layer)
        ├─► Stack 11 (Back-Office UI)  ← parallel after Stack 10
        └─► Stack 12 (POS Revamp)      ← parallel after Stack 10
              └─► Stack 13 (Dashboard)
```

### Stack 9 — Database Foundation
**Scope:** All SQL migrations + Supabase Storage setup + regenerate types

Steps:
1. Run all CREATE TABLE statements (customers, raw_materials, inventory_transactions, product_recipes, modifiers, modifier_options, product_modifiers)
2. Run all ALTER TABLE statements (products, orders, order_items, tenants)
3. Create Postgres functions (generate_order_number, deduct_stock_for_order)
4. Create Storage bucket `product-images`
5. Regenerate `src/types/database.ts` via Supabase CLI or MCP

### Stack 10 — Logic Layer
**Scope:** Types + Server Actions + DAL (no UI)

Files touched:
- Create: `src/types/app.ts`
- Modify: `src/app/actions/orders.ts` — full rewrite with new CreateOrderInput
- Create: `src/app/actions/inventory.ts`
- Create: `src/app/actions/modifiers.ts`
- Create: `src/app/actions/customers.ts`
- Modify: `src/app/actions/products.ts` — add updateProductRecipes, updateProductModifiers
- Modify: `src/lib/dal.ts` — add 7 new functions

### Stack 11 — Back-Office UI
**Scope:** Owner-facing management screens

Routes:
- `/inventory` — CRUD raw materials + receive stock + stock level view
- `/products/[id]/edit` — add Recipe tab + Modifiers tab + image upload
- `/modifiers` — manage modifier groups + options
- `/settings` — add fixed cost, GP%, order prefix fields

### Stack 12 — POS Revamp
**Scope:** Complete POS screen redesign

Components (all new):
- `PosHeader` — date, total orders counter, user info
- `CategoryTabs` — Coffee/Matcha/Non-Coffee/Bakery + drink_type sub-tabs
- `ProductGrid` — image cards with + button
- `ModifierModal` — per-product modifier selection, validates required groups
- `SmartCart` — customer search, dine-in/take-away, table number, modifier display
- `CheckoutButton` — calls createOrder, shows order number on success

### Stack 13 — Advanced Dashboard
**Scope:** Analytics upgrade + mobile responsive

Features:
- Recharts: hourly sales line chart + category breakdown (Coffee/Tea/Snack)
- Pricing Calculator Widget
- Low Stock Alert cards
- Bottom Navigation for mobile (/pos, /orders, /dashboard)

---

## Section 3 — Key Interfaces

### `src/types/app.ts`

```typescript
export type SelectedModifier = {
  modifierId: string;
  modifierName: string;
  optionId: string;
  optionName: string;
  priceDelta: number;
};

export type CartItem = {
  productId: string;
  name: string;
  basePrice: number;
  quantity: number;
  selectedModifiers: SelectedModifier[];
  totalPrice: number;  // (basePrice + sum(priceDelta)) * quantity
};

export type CreateOrderInput = {
  items: CartItem[];
  paymentMethod: "cash" | "transfer" | "card";
  orderType: "dine_in" | "take_away";
  tableNumber?: string;
  customerId?: string;
  note?: string;
};

export type ProductCost = {
  productId: string;
  ingredientCost: number;
  recipes: {
    materialName: string;
    unit: string;
    quantityUsed: number;
    costPerUnit: number;
    lineCost: number;
  }[];
};

export type LowStockAlert = {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  minStockAlert: number;
};

export type ModifierWithOptions = {
  id: string;
  name: string;
  isRequired: boolean;
  isMultiSelect: boolean;
  sortOrder: number;
  options: {
    id: string;
    name: string;
    priceDelta: number;
    sortOrder: number;
  }[];
};
```

### Server Action Signatures

```typescript
// orders.ts
createOrder(data: CreateOrderInput): Promise<{ error: string } | { orderId: string; orderNumber: string }>

// inventory.ts
createRawMaterial(prevState: State, formData: FormData): Promise<State>
updateRawMaterial(prevState: State, formData: FormData): Promise<State>
deleteRawMaterial(formData: FormData): Promise<void>
receiveStock(prevState: State, formData: FormData): Promise<State>  // type='receive'
adjustStock(prevState: State, formData: FormData): Promise<State>   // type='adjust'

// modifiers.ts
createModifier(prevState: State, formData: FormData): Promise<State>
updateModifier(prevState: State, formData: FormData): Promise<State>
deleteModifier(formData: FormData): Promise<void>
createModifierOption(prevState: State, formData: FormData): Promise<State>
deleteModifierOption(formData: FormData): Promise<void>

// customers.ts
findOrCreateCustomer(data: { phone?: string; name: string }): Promise<{ customerId: string } | { error: string }>

// products.ts (additions)
updateProductRecipes(formData: FormData): Promise<void>    // replaces all recipes for product
updateProductModifiers(formData: FormData): Promise<void>  // replaces all modifier links
uploadProductImage(formData: FormData): Promise<{ url: string } | { error: string }>
```

### DAL Function Signatures

```typescript
// dal.ts additions
getCustomerByPhone(phone: string, tenantId: string): Promise<Customer | null>
getRawMaterials(tenantId: string): Promise<RawMaterial[]>
getLowStockAlerts(tenantId: string): Promise<LowStockAlert[]>
getModifiersForProduct(productId: string): Promise<ModifierWithOptions[]>
getProductCost(productId: string): Promise<ProductCost>
getSalesByHour(tenantId: string, date: string): Promise<{ hour: number; total: number }[]>
getSalesByCategory(tenantId: string, range: "day" | "week" | "month"): Promise<{ category: string; total: number }[]>
```

---

## UI Reference Notes

- **Color scheme:** Dark green (#2D5016 range) + warm orange accent — matches reference screenshots
- **POS Layout:** Left 65% product grid, Right 35% cart panel (desktop); full-screen toggle on mobile
- **Product cards:** Image top, name + price bottom, `+` button bottom-right corner
- **Category tabs:** Top-level horizontal scroll (Coffee/Matcha/Non-Coffee/Bakery); second-level sub-tabs (ทั้งหมด/ร้อน/เย็น/ปั่น/Special) appear when top-level selected
- **Modifier Modal:** Grouped by modifier name, required groups have visual indicator, "Add to Cart" disabled until all required groups selected
- **Order number:** Displayed prominently in cart header and on success screen

---

## CRM Foundation Notes

The `customers` table + `orders.customer_id` FK provides the full CRM data foundation:
- **Visit frequency:** `COUNT(orders) WHERE customer_id = X`
- **Total spend:** `SUM(orders.total) WHERE customer_id = X`
- **Favorite items:** JOIN order_items WHERE order_id IN (orders by customer)
- **Last visit:** `MAX(orders.created_at) WHERE customer_id = X`

Future CRM features (not in this spec) can be built purely as read queries on existing data — no schema changes required.
