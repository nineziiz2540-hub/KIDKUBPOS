# Stack 4: POS & Cart System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-screen POS (Point of Sale) cashier interface with a clickable product grid on the left and an interactive cart with checkout on the right, backed by `orders` and `order_items` tables in Supabase.

**Architecture:** The POS page (`/pos`) is a Server Component that loads active products and passes them to `<PosScreen>` — a Client Component that owns all cart state in `useState`. Cart mutations (add, remove, qty change) are pure React state updates. Checkout calls the `createOrder` Server Action directly via `useTransition`, which inserts a row into `orders` and all rows into `order_items` in a single Supabase session. On success the cart clears; no page redirect — the cashier stays on POS for the next order.

**Tech Stack:** Next.js 16.2.9 App Router, TypeScript strict + noUncheckedIndexedAccess, React `useTransition`, Supabase RLS, Tailwind CSS v4, Shadcn UI Button + Badge.

## Global Constraints

- Next.js 16.2.9 — `params` in dynamic routes is `Promise<{id: string}>`, must `await params`
- Build command: `npm run build -- --webpack` (not turbopack)
- Button uses `@base-ui/react/button` — no `asChild` prop; use `<Link className={cn(buttonVariants(...))}>` for link-buttons
- Shadcn Select (Radix UI) does not submit via HTML form action — use native `<select>` for form fields
- TypeScript `noUncheckedIndexedAccess` — use switch statements for role-level checks, not `Record` + index access on broad keys
- No `.env.local` in git — Supabase keys via environment variables only
- All Server Actions must call `getProfile()` first for auth + tenant_id
- **Prerequisite:** The recursive `profiles_select_own_tenant` RLS policy must be fixed to `id = auth.uid()` before Stack 4 will work. If not yet done, run this first in Supabase SQL Editor:
  ```sql
  DROP POLICY IF EXISTS "profiles_select_own_tenant" ON profiles;
  CREATE POLICY "profiles_select_own" ON profiles FOR SELECT USING (id = auth.uid());
  ```

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| *(Supabase SQL Editor)* | Run manually | Create `orders` + `order_items` tables + RLS |
| `src/types/database.ts` | Modify | Add `orders` + `order_items` table types |
| `src/app/actions/orders.ts` | Create | `createOrder` Server Action + `CartItem` type |
| `src/components/shell/sidebar.tsx` | Modify | Replace `/orders` nav item with `/pos` |
| `src/components/pos/product-grid.tsx` | Create | Clickable product card grid (Client Component) |
| `src/components/pos/cart-panel.tsx` | Create | Cart items, qty controls, payment, checkout (Client Component) |
| `src/components/pos/pos-screen.tsx` | Create | Cart state owner, assembles layout (Client Component) |
| `src/app/(shell)/pos/page.tsx` | Create | Server Component entry point, loads products |

---

### Task 1: Database Schema + RLS

**Files:**
- No code files — SQL runs in Supabase SQL Editor by the user

**Interfaces:**
- Produces:
  - `orders(id uuid PK, tenant_id uuid FK→tenants, created_by uuid FK→auth.users, status text, payment_method text, total numeric(10,2), note text, created_at timestamptz, updated_at timestamptz)`
  - `order_items(id uuid PK, order_id uuid FK→orders ON DELETE CASCADE, product_id uuid FK→products, product_name text, unit_price numeric(10,2), quantity integer, subtotal numeric(10,2), created_at timestamptz)`
  - RLS: all-roles insert into `orders`; select own-tenant; manager/owner update

- [ ] **Step 1: Run SQL in Supabase Dashboard → SQL Editor → New query**

```sql
-- ===================== ORDERS =====================
CREATE TABLE public.orders (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid          NOT NULL REFERENCES public.tenants(id),
  created_by     uuid          NOT NULL REFERENCES auth.users(id),
  status         text          NOT NULL DEFAULT 'completed'
                               CHECK (status IN ('completed', 'voided')),
  payment_method text          NOT NULL DEFAULT 'cash'
                               CHECK (payment_method IN ('cash', 'transfer', 'card')),
  total          numeric(10,2) NOT NULL DEFAULT 0,
  note           text,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now()
);

-- ===================== ORDER ITEMS =====================
CREATE TABLE public.order_items (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid          NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id   uuid          NOT NULL REFERENCES public.products(id),
  product_name text          NOT NULL,
  unit_price   numeric(10,2) NOT NULL,
  quantity     integer       NOT NULL DEFAULT 1 CHECK (quantity > 0),
  subtotal     numeric(10,2) NOT NULL,
  created_at   timestamptz   NOT NULL DEFAULT now()
);

-- ===================== TRIGGER =====================
CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ===================== RLS =====================
ALTER TABLE public.orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- orders SELECT: tenant members see their own tenant's orders
CREATE POLICY "orders_select_own_tenant" ON public.orders FOR SELECT
  USING (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

-- orders INSERT: any tenant member can create an order for their tenant
CREATE POLICY "orders_insert_own_tenant" ON public.orders FOR INSERT
  WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    AND created_by = auth.uid()
  );

-- orders UPDATE: any tenant member can update (for voiding orders in later stacks)
CREATE POLICY "orders_update_own_tenant" ON public.orders FOR UPDATE
  USING (
    tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
  );

-- order_items SELECT: readable when parent order is in user's tenant
CREATE POLICY "order_items_select" ON public.order_items FOR SELECT
  USING (
    order_id IN (
      SELECT id FROM public.orders
      WHERE tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    )
  );

-- order_items INSERT: insertable when parent order is in user's tenant
CREATE POLICY "order_items_insert" ON public.order_items FOR INSERT
  WITH CHECK (
    order_id IN (
      SELECT id FROM public.orders
      WHERE tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    )
  );
```

> **Note:** If the `set_updated_at()` function does not exist (was not created in Stack 1), run this first:
> ```sql
> CREATE OR REPLACE FUNCTION public.set_updated_at()
> RETURNS TRIGGER LANGUAGE plpgsql AS $$
> BEGIN new.updated_at = now(); RETURN new; END;
> $$;
> ```

- [ ] **Step 2: Verify tables in Supabase Dashboard → Table Editor**

Confirm both `orders` and `order_items` appear under the `public` schema.

พิมพ์ `"สร้างตารางสำเร็จแล้ว"` เพื่อดำเนินการ Task ถัดไป.

---

### Task 2: TypeScript Types + Server Action + Sidebar

**Files:**
- Modify: `src/types/database.ts`
- Create: `src/app/actions/orders.ts`
- Modify: `src/components/shell/sidebar.tsx`

**Interfaces:**
- Consumes: `getProfile()` returning `ProfileWithTenant` from `@/lib/dal`, `createClient` from `@/lib/supabase/server`
- Produces:
  - `CartItem = { productId: string; name: string; price: number; quantity: number }` — exported from `@/app/actions/orders`
  - `createOrder(data: { items: CartItem[]; paymentMethod: "cash" | "transfer" | "card" }): Promise<{ error: string } | undefined>` — exported Server Action

- [ ] **Step 1: Update `src/types/database.ts` — add `order_items` and `orders` (alphabetical, before `products`)**

Find the line `      products: {` and insert the two new table definitions immediately before it:

```typescript
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string
          product_name: string
          unit_price: number
          quantity: number
          subtotal: number
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          product_id: string
          product_name: string
          unit_price: number
          quantity?: number
          subtotal: number
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string
          product_name?: string
          unit_price?: number
          quantity?: number
          subtotal?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          id: string
          tenant_id: string
          created_by: string
          status: string
          payment_method: string
          total: number
          note: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          created_by: string
          status?: string
          payment_method?: string
          total: number
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          created_by?: string
          status?: string
          payment_method?: string
          total?: number
          note?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
```

- [ ] **Step 2: Create `src/app/actions/orders.ts`**

```typescript
"use server";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";

export type CartItem = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
};

type PaymentMethod = "cash" | "transfer" | "card";

export async function createOrder(data: {
  items: CartItem[];
  paymentMethod: PaymentMethod;
}): Promise<{ error: string } | undefined> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (data.items.length === 0) return { error: "ไม่มีสินค้าในตะกร้า" };

  const total = data.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  const supabase = await createClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      tenant_id: profile.tenant_id,
      created_by: profile.id,
      payment_method: data.paymentMethod,
      total,
    })
    .select("id")
    .single();

  if (orderError || !order) return { error: "บันทึกออเดอร์ไม่สำเร็จ" };

  const orderItems = data.items.map((item) => ({
    order_id: order.id,
    product_id: item.productId,
    product_name: item.name,
    unit_price: item.price,
    quantity: item.quantity,
    subtotal: item.price * item.quantity,
  }));

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(orderItems);

  if (itemsError) return { error: "บันทึกรายการสินค้าไม่สำเร็จ" };

  return undefined;
}
```

- [ ] **Step 3: Update `src/components/shell/sidebar.tsx` — replace `/orders` with `/pos`**

Change the lucide-react import: remove `ShoppingCart`, add `CreditCard`:

```typescript
import {
  LayoutDashboard,
  CreditCard,
  Package,
  Tag,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";
```

Replace the `allNavItems` array:

```typescript
const allNavItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, minRole: "staff" },
  { href: "/pos", label: "POS", icon: CreditCard, minRole: "staff" },
  { href: "/products", label: "Products", icon: Package, minRole: "staff" },
  { href: "/categories", label: "Categories", icon: Tag, minRole: "manager" },
  { href: "/reports", label: "Reports", icon: BarChart3, minRole: "manager" },
  { href: "/settings", label: "Settings", icon: Settings, minRole: "owner" },
];
```

- [ ] **Step 4: Build check**

```powershell
cd E:\KIDKUBPOS
npm run build -- --webpack 2>&1 | Select-Object -Last 20
```

Expected: compiled successfully, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/database.ts src/app/actions/orders.ts src/components/shell/sidebar.tsx
git commit -m "feat: add orders/order_items DB types, createOrder action, POS sidebar nav"
```

---

### Task 3: POS Client Components

**Files:**
- Create: `src/components/pos/product-grid.tsx`
- Create: `src/components/pos/cart-panel.tsx`
- Create: `src/components/pos/pos-screen.tsx`

**Interfaces:**
- Consumes:
  - `CartItem` from `@/app/actions/orders`
  - `createOrder` from `@/app/actions/orders`
  - `Button` from `@/components/ui/button`
- Produces:
  - `ProductGrid({ products: Product[], onAddToCart: (p: Product) => void })` — exported named
  - `CartPanel({ cartItems, onUpdateQty, onRemove, onClear, paymentMethod, onPaymentChange, onCheckout, pending, error })` — exported named
  - `PosScreen({ products: Product[] })` — exported named, this is what the page imports

- [ ] **Step 1: Create `src/components/pos/product-grid.tsx`**

```tsx
"use client";

type Product = {
  id: string;
  name: string;
  price: number;
  categories: { name: string } | null;
};

type Props = {
  products: Product[];
  onAddToCart: (product: Product) => void;
};

export function ProductGrid({ products, onAddToCart }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 p-1">
      {products.map((product) => (
        <button
          key={product.id}
          type="button"
          onClick={() => onAddToCart(product)}
          className="text-left rounded-lg border bg-white p-3 hover:border-accent hover:shadow-sm transition-all active:scale-95 cursor-pointer"
        >
          <p className="font-medium text-sidebar text-sm leading-tight line-clamp-2 min-h-[2.5rem]">
            {product.name}
          </p>
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {product.categories?.name ?? "ไม่ระบุหมวดหมู่"}
          </p>
          <p className="text-accent font-semibold text-sm mt-2">
            ฿{Number(product.price).toFixed(2)}
          </p>
        </button>
      ))}
      {products.length === 0 && (
        <p className="col-span-full text-center py-16 text-muted-foreground">
          ยังไม่มีสินค้า
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/pos/cart-panel.tsx`**

```tsx
"use client";
import type { CartItem } from "@/app/actions/orders";
import { Button } from "@/components/ui/button";

type PaymentMethod = "cash" | "transfer" | "card";

type Props = {
  cartItems: CartItem[];
  onUpdateQty: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
  onClear: () => void;
  paymentMethod: PaymentMethod;
  onPaymentChange: (method: PaymentMethod) => void;
  onCheckout: () => void;
  pending: boolean;
  error: string | null;
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "เงินสด",
  transfer: "โอน",
  card: "บัตร",
};

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "transfer", "card"];

export function CartPanel({
  cartItems,
  onUpdateQty,
  onRemove,
  onClear,
  paymentMethod,
  onPaymentChange,
  onCheckout,
  pending,
  error,
}: Props) {
  const total = cartItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h2 className="font-semibold text-sidebar">ตะกร้า</h2>
        {cartItems.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-destructive transition-colors"
          >
            ล้างทั้งหมด
          </button>
        )}
      </div>

      {/* Cart items — scrollable */}
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {cartItems.length === 0 ? (
          <p className="text-center text-muted-foreground py-12 text-sm">
            คลิกสินค้าเพื่อเพิ่ม
          </p>
        ) : (
          cartItems.map((item) => (
            <div
              key={item.productId}
              className="flex items-center gap-2 px-3 py-2.5"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar truncate">
                  {item.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  ฿{item.price.toFixed(2)}
                </p>
              </div>
              {/* Qty controls */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onUpdateQty(item.productId, item.quantity - 1)}
                  className="w-6 h-6 rounded border text-sm leading-none hover:bg-surface transition-colors flex items-center justify-center"
                  aria-label="ลดจำนวน"
                >
                  −
                </button>
                <span className="w-6 text-center text-sm tabular-nums">
                  {item.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => onUpdateQty(item.productId, item.quantity + 1)}
                  className="w-6 h-6 rounded border text-sm leading-none hover:bg-surface transition-colors flex items-center justify-center"
                  aria-label="เพิ่มจำนวน"
                >
                  +
                </button>
              </div>
              <p className="text-sm font-medium w-16 text-right text-sidebar tabular-nums">
                ฿{(item.price * item.quantity).toFixed(2)}
              </p>
              <button
                type="button"
                onClick={() => onRemove(item.productId)}
                className="text-muted-foreground hover:text-destructive transition-colors text-xs w-4 text-center"
                aria-label="ลบสินค้า"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer: total + payment + checkout */}
      <div className="border-t px-4 py-4 space-y-3 shrink-0">
        <div className="flex justify-between font-semibold text-sidebar text-base">
          <span>รวมทั้งหมด</span>
          <span className="tabular-nums">฿{total.toFixed(2)}</span>
        </div>

        {/* Payment method selector */}
        <div className="flex gap-2">
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => onPaymentChange(method)}
              className={`flex-1 rounded-md border py-1.5 text-xs font-medium transition-colors ${
                paymentMethod === method
                  ? "border-accent bg-accent text-white"
                  : "border-input text-muted-foreground hover:border-accent hover:text-accent"
              }`}
            >
              {PAYMENT_LABELS[method]}
            </button>
          ))}
        </div>

        {error !== null && (
          <p className="text-sm text-destructive font-medium">{error}</p>
        )}

        <Button
          type="button"
          onClick={onCheckout}
          disabled={cartItems.length === 0 || pending}
          className="w-full bg-accent hover:bg-accent/90 text-white"
        >
          {pending ? "กำลังบันทึก…" : "ชำระเงิน"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/components/pos/pos-screen.tsx`**

```tsx
"use client";
import { useState, useTransition } from "react";
import { createOrder, type CartItem } from "@/app/actions/orders";
import { ProductGrid } from "@/components/pos/product-grid";
import { CartPanel } from "@/components/pos/cart-panel";

type Product = {
  id: string;
  name: string;
  price: number;
  categories: { name: string } | null;
};

type PaymentMethod = "cash" | "transfer" | "card";

type Props = {
  products: Product[];
};

export function PosScreen({ products }: Props) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addToCart(product: Product) {
    setCartItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        return prev.map((i) =>
          i.productId === product.id
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          price: Number(product.price),
          quantity: 1,
        },
      ];
    });
  }

  function updateQty(productId: string, qty: number) {
    if (qty <= 0) {
      setCartItems((prev) => prev.filter((i) => i.productId !== productId));
    } else {
      setCartItems((prev) =>
        prev.map((i) =>
          i.productId === productId ? { ...i, quantity: qty } : i
        )
      );
    }
  }

  function removeItem(productId: string) {
    setCartItems((prev) => prev.filter((i) => i.productId !== productId));
  }

  function clearCart() {
    setCartItems([]);
    setError(null);
  }

  function handleCheckout() {
    setError(null);
    startTransition(async () => {
      const result = await createOrder({ items: cartItems, paymentMethod });
      if (result?.error !== undefined) {
        setError(result.error);
      } else {
        setCartItems([]);
      }
    });
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
      {/* Left: product grid — scrolls independently */}
      <div className="flex-1 overflow-y-auto">
        <ProductGrid products={products} onAddToCart={addToCart} />
      </div>
      {/* Right: cart panel — fixed width, fills height */}
      <div className="w-72 shrink-0">
        <CartPanel
          cartItems={cartItems}
          onUpdateQty={updateQty}
          onRemove={removeItem}
          onClear={clearCart}
          paymentMethod={paymentMethod}
          onPaymentChange={setPaymentMethod}
          onCheckout={handleCheckout}
          pending={pending}
          error={error}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/pos/
git commit -m "feat: add POS client components (ProductGrid, CartPanel, PosScreen)"
```

---

### Task 4: POS Page (Server Component Entry Point)

**Files:**
- Create: `src/app/(shell)/pos/page.tsx`

**Interfaces:**
- Consumes: `getProfile()` from `@/lib/dal`, `createClient` from `@/lib/supabase/server`, `PosScreen` from `@/components/pos/pos-screen`
- Produces: `/pos` route — accessible to all roles (staff, manager, owner); shows only `is_active = true` products

- [ ] **Step 1: Create `src/app/(shell)/pos/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { PosScreen } from "@/components/pos/pos-screen";

type ProductRow = {
  id: string;
  name: string;
  price: number;
  categories: { name: string } | null;
};

export default async function PosPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: products } = (await supabase
    .from("products")
    .select("id, name, price, categories(name)")
    .eq("is_active", true)
    .order("name")) as { data: ProductRow[] | null };

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">POS</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          คลิกสินค้าเพื่อเพิ่มลงตะกร้า
        </p>
      </div>
      <PosScreen products={products ?? []} />
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```powershell
cd E:\KIDKUBPOS
npm run build -- --webpack 2>&1 | Select-Object -Last 20
```

Expected: `✓ Compiled successfully` with no TypeScript errors.

- [ ] **Step 3: Start dev server and smoke-test in browser**

```powershell
npm run dev -- --webpack
```

Open `http://localhost:3000/pos` and verify:

1. **Sidebar** shows "POS" nav item (CreditCard icon) — not "Orders"
2. **Left panel** shows product grid (cards with name, category, price) in a multi-column grid
3. **Right panel** shows cart: "คลิกสินค้าเพื่อเพิ่ม" placeholder text, "รวมทั้งหมด ฿0.00", 3 payment buttons, disabled "ชำระเงิน"
4. **Add product:** Click a product card → it appears in cart with qty 1; cart total updates
5. **Add same product again** → qty becomes 2; total doubles
6. **+/− buttons** → qty increments/decrements; at 0 the item disappears from cart
7. **✕ button** → removes the item entirely
8. **Payment buttons** → clicking "โอน" highlights it; clicking "บัตร" switches highlight
9. **Checkout:** Click "ชำระเงิน" → button shows "กำลังบันทึก…" briefly → button re-enables and cart clears (items gone, total back to ฿0.00)
10. **Verify in Supabase:** Dashboard → Table Editor → `orders` — new row with correct `total`, `payment_method`; `order_items` — rows with `product_name`, `unit_price`, `quantity`, `subtotal`

- [ ] **Step 4: Commit**

```bash
git add src/app/(shell)/pos/
git commit -m "feat: add POS page — server component loading products for cashier screen"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Covered by |
|-------------|-----------|
| สร้างตาราง orders | Task 1 SQL: `CREATE TABLE public.orders` |
| สร้างตาราง order_items | Task 1 SQL: `CREATE TABLE public.order_items` |
| เก็บสถานะบิล (status) | `status text CHECK (IN 'completed','voided')` |
| ยอดรวม (total) | `total numeric(10,2)` in orders + computed in `createOrder` |
| วิธีชำระเงิน (payment_method) | `payment_method text CHECK (IN 'cash','transfer','card')` |
| หน้า UI รับออเดอร์ (POS) | Task 4: `/pos` page |
| หน้าจอซ้าย Grid สินค้า | Task 3: `ProductGrid` component |
| หน้าจอขวา ตะกร้า | Task 3: `CartPanel` component |
| บวก/ลบจำนวนสินค้า | `updateQty()` in PosScreen + +/− buttons in CartPanel |
| สรุปยอดรวม | `total = items.reduce(sum + price * qty)` in CartPanel + server action |

**Placeholder scan:** None found. All code blocks are complete.

**Type consistency:**
- `CartItem` defined once in `orders.ts`, imported in `pos-screen.tsx` and `cart-panel.tsx` ✅
- `Product` type defined locally in `product-grid.tsx` and `pos-screen.tsx` — identical shape ✅
- `PaymentMethod` defined locally in `orders.ts`, `pos-screen.tsx`, `cart-panel.tsx` — same `"cash" | "transfer" | "card"` union; TypeScript structural typing confirms compatibility when `createOrder` is called ✅
- `PAYMENT_LABELS: Record<PaymentMethod, string>` — all 3 keys explicitly present, `noUncheckedIndexedAccess` does not apply to finite `Record` with exhaustive keys ✅
