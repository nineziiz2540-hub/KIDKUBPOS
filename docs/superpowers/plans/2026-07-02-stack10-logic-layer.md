# Stack 10 — Logic Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create all app types, server actions, and DAL functions needed by Stacks 11–13 — no new UI pages or components.

**Architecture:** Every server action follows the established pattern: `"use server"` → `getProfile()` auth check → role gate → Supabase query → `revalidatePath`. DAL functions are plain async functions (no `cache()` wrap since most are write-path or parameterized). TypeScript strict + `noUncheckedIndexedAccess` must stay clean throughout.

**Tech Stack:** Next.js 16 App Router, Supabase SSR client (`@/lib/supabase/server`), TypeScript strict

## Global Constraints

- Multi-tenant: every server action calls `getProfile()` first; all DB queries include `.eq("tenant_id", profile.tenant_id)`
- `getUser()` (not `getSession()`) is used inside `getProfile()` — never call `getSession()` directly
- `npx tsc --noEmit` must return zero errors after each task
- No `.env.local` or Supabase keys committed
- `revalidatePath` after every successful mutation
- `"use server"` directive at top of every actions file
- State type per file: `{ error?: string; success?: boolean } | undefined` — match existing `SettingsState` pattern
- `isManagerOrOwner(role)` helper in every actions file that requires manager/owner gate

## File Map

| File | Action |
|------|--------|
| `src/types/app.ts` | **Create** — shared app-level types |
| `src/app/actions/orders.ts` | **Rewrite** — new createOrder + fix CartItem import in POS components |
| `src/components/pos/pos-screen.tsx` | **Patch** — update CartItem type references |
| `src/components/pos/cart-panel.tsx` | **Patch** — update CartItem type references |
| `src/app/actions/inventory.ts` | **Create** — raw material CRUD + stock ops |
| `src/app/actions/modifiers.ts` | **Create** — modifier group + option CRUD |
| `src/app/actions/customers.ts` | **Create** — findOrCreateCustomer |
| `src/app/actions/products.ts` | **Extend** — add recipe/modifier/image actions |
| `src/lib/dal.ts` | **Extend** — add 7 new DAL functions |

---

### Task 1: App Types (`src/types/app.ts`)

**Files:**
- Create: `src/types/app.ts`

**Interfaces:**
- Produces: `SelectedModifier`, `CartItem`, `CreateOrderInput`, `ProductCost`, `LowStockAlert`, `ModifierWithOptions` — used by Tasks 2, 3, 7

- [ ] **Step 1: Create the file**

Create `src/types/app.ts` with this exact content:

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
  totalPrice: number; // (basePrice + sum(priceDelta)) * quantity
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

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: zero errors (output is empty)

- [ ] **Step 3: Commit**

```powershell
git add src/types/app.ts
git commit -m "feat(types): add app-level types for Stack 10 logic layer"
```

---

### Task 2: Rewrite Orders Action + Patch POS Components

**Files:**
- Rewrite: `src/app/actions/orders.ts`
- Patch: `src/components/pos/pos-screen.tsx`
- Patch: `src/components/pos/cart-panel.tsx`

**Interfaces:**
- Consumes: `CartItem`, `CreateOrderInput` from `@/types/app.ts` (Task 1)
- Produces: `createOrder(data: CreateOrderInput): Promise<{ error: string } | { orderId: string; orderNumber: string }>`

**Context:** The old `orders.ts` exported its own `CartItem` type. The POS components import it from there. This task rewrites the action AND patches the two POS components to use the new type from `@/types/app.ts`. Without this patch, `npx tsc --noEmit` will fail on `item.price` references.

- [ ] **Step 1: Rewrite `src/app/actions/orders.ts`**

```typescript
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";
import type { CreateOrderInput } from "@/types/app";

export async function createOrder(
  data: CreateOrderInput
): Promise<{ error: string } | { orderId: string; orderNumber: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (data.items.length === 0) return { error: "ไม่มีสินค้าในตะกร้า" };

  const supabase = await createClient();

  // 1. Generate order number atomically
  const { data: orderNumber, error: seqError } = await supabase.rpc(
    "generate_order_number",
    { p_tenant_id: profile.tenant_id }
  );
  if (seqError || !orderNumber) return { error: "สร้างเลขออเดอร์ไม่สำเร็จ" };

  // 2. Fetch category names for snapshot (one query for all products in cart)
  const productIds = [...new Set(data.items.map((i) => i.productId))];
  const { data: productRows } = await supabase
    .from("products")
    .select("id, categories(name)")
    .in("id", productIds)
    .eq("tenant_id", profile.tenant_id);

  const categoryMap = new Map<string, string>();
  for (const p of productRows ?? []) {
    const cat = p.categories as { name: string } | null;
    if (cat) categoryMap.set(p.id, cat.name);
  }

  // 3. Calculate total from CartItem.totalPrice
  const total = data.items.reduce((sum, item) => sum + item.totalPrice, 0);

  // 4. Insert order row
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      tenant_id: profile.tenant_id,
      created_by: profile.id,
      payment_method: data.paymentMethod,
      total,
      order_number: orderNumber,
      order_type: data.orderType,
      table_number: data.tableNumber ?? null,
      customer_id: data.customerId ?? null,
      note: data.note ?? null,
    })
    .select("id")
    .single();

  if (orderError || !order) return { error: "บันทึกออเดอร์ไม่สำเร็จ" };

  // 5. Build order_items with snapshots
  const orderItems = data.items.map((item) => ({
    order_id: order.id,
    product_id: item.productId,
    product_name: item.name,
    unit_price: item.totalPrice / item.quantity,
    quantity: item.quantity,
    subtotal: item.totalPrice,
    category_name: categoryMap.get(item.productId) ?? null,
    modifiers_snapshot:
      item.selectedModifiers.length > 0
        ? item.selectedModifiers.map((m) => ({
            group: m.modifierName,
            option: m.optionName,
            priceDelta: m.priceDelta,
          }))
        : null,
  }));

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(orderItems);
  if (itemsError) return { error: "บันทึกรายการสินค้าไม่สำเร็จ" };

  // 6. Deduct stock (best-effort — don't block on failure)
  await supabase.rpc("deduct_stock_for_order", { p_order_id: order.id });

  revalidatePath("/orders");
  return { orderId: order.id, orderNumber };
}
```

- [ ] **Step 2: Patch `src/components/pos/pos-screen.tsx`**

Replace the entire file:

```typescript
"use client";
import { useState, useTransition } from "react";
import { createOrder } from "@/app/actions/orders";
import type { CartItem } from "@/types/app";
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
  const [lastOrderNumber, setLastOrderNumber] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addToCart(product: Product) {
    setCartItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        const newQty = existing.quantity + 1;
        return prev.map((i) =>
          i.productId === product.id
            ? {
                ...i,
                quantity: newQty,
                totalPrice:
                  (existing.basePrice +
                    existing.selectedModifiers.reduce(
                      (s, m) => s + m.priceDelta,
                      0
                    )) *
                  newQty,
              }
            : i
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          basePrice: Number(product.price),
          quantity: 1,
          selectedModifiers: [],
          totalPrice: Number(product.price),
        },
      ];
    });
  }

  function updateQty(productId: string, qty: number) {
    if (qty <= 0) {
      setCartItems((prev) => prev.filter((i) => i.productId !== productId));
    } else {
      setCartItems((prev) =>
        prev.map((i) => {
          if (i.productId !== productId) return i;
          const unitPrice =
            i.basePrice +
            i.selectedModifiers.reduce((s, m) => s + m.priceDelta, 0);
          return { ...i, quantity: qty, totalPrice: unitPrice * qty };
        })
      );
    }
  }

  function removeItem(productId: string) {
    setCartItems((prev) => prev.filter((i) => i.productId !== productId));
  }

  function clearCart() {
    setCartItems([]);
    setError(null);
    setLastOrderNumber(null);
  }

  function handleCheckout() {
    setError(null);
    setLastOrderNumber(null);
    startTransition(async () => {
      const result = await createOrder({
        items: cartItems,
        paymentMethod,
        orderType: "dine_in",
      });
      if ("error" in result) {
        setError(result.error);
      } else {
        setLastOrderNumber(result.orderNumber);
        setCartItems([]);
      }
    });
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
      <div className="flex-1 overflow-y-auto">
        <ProductGrid products={products} onAddToCart={addToCart} />
      </div>
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
          lastOrderNumber={lastOrderNumber}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Patch `src/components/pos/cart-panel.tsx`**

Replace the entire file:

```typescript
"use client";
import type { CartItem } from "@/types/app";
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
  lastOrderNumber: string | null;
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
  lastOrderNumber,
}: Props) {
  const total = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);

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
          <div className="py-12 text-center">
            {lastOrderNumber && (
              <p className="text-sm font-semibold text-sidebar mb-1">
                ออเดอร์ {lastOrderNumber} สำเร็จ
              </p>
            )}
            <p className="text-center text-muted-foreground text-sm">
              คลิกสินค้าเพื่อเพิ่ม
            </p>
          </div>
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
                  ฿{(item.totalPrice / item.quantity).toFixed(2)}
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
                ฿{item.totalPrice.toFixed(2)}
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

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 5: Commit**

```powershell
git add src/app/actions/orders.ts src/components/pos/pos-screen.tsx src/components/pos/cart-panel.tsx
git commit -m "feat(orders): rewrite createOrder with order_number, snapshots, stock deduction"
```

---

### Task 3: Inventory Actions (`src/app/actions/inventory.ts`)

**Files:**
- Create: `src/app/actions/inventory.ts`

**Interfaces:**
- Produces: `InventoryState`, `createRawMaterial`, `updateRawMaterial`, `deleteRawMaterial`, `receiveStock`, `adjustStock`

- [ ] **Step 1: Create `src/app/actions/inventory.ts`**

```typescript
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";

export type InventoryState = { error?: string; success?: boolean } | undefined;

function isManagerOrOwner(role: string): boolean {
  return role === "owner" || role === "manager";
}

export async function createRawMaterial(
  prevState: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const name = formData.get("name");
  const unit = formData.get("unit");
  const costRaw = formData.get("cost_per_unit");
  const minRaw = formData.get("min_stock_alert");

  if (typeof name !== "string" || name.trim() === "") {
    return { error: "กรุณากรอกชื่อวัตถุดิบ" };
  }
  if (typeof unit !== "string" || unit.trim() === "") {
    return { error: "กรุณากรอกหน่วย" };
  }
  const costPerUnit = typeof costRaw === "string" ? parseFloat(costRaw) : NaN;
  if (isNaN(costPerUnit) || costPerUnit < 0) {
    return { error: "กรุณากรอกต้นทุนที่ถูกต้อง" };
  }
  const minStock =
    typeof minRaw === "string" && minRaw !== "" ? parseFloat(minRaw) : 0;

  const supabase = await createClient();
  const { error } = await supabase.from("raw_materials").insert({
    tenant_id: profile.tenant_id,
    name: name.trim(),
    unit: unit.trim(),
    cost_per_unit: costPerUnit,
    min_stock_alert: isNaN(minStock) ? 0 : minStock,
  });

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/inventory");
  return { success: true };
}

export async function updateRawMaterial(
  prevState: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const id = formData.get("id");
  const name = formData.get("name");
  const unit = formData.get("unit");
  const costRaw = formData.get("cost_per_unit");
  const minRaw = formData.get("min_stock_alert");

  if (typeof id !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  if (typeof name !== "string" || name.trim() === "") {
    return { error: "กรุณากรอกชื่อวัตถุดิบ" };
  }
  if (typeof unit !== "string" || unit.trim() === "") {
    return { error: "กรุณากรอกหน่วย" };
  }
  const costPerUnit = typeof costRaw === "string" ? parseFloat(costRaw) : NaN;
  if (isNaN(costPerUnit) || costPerUnit < 0) {
    return { error: "กรุณากรอกต้นทุนที่ถูกต้อง" };
  }
  const minStock =
    typeof minRaw === "string" && minRaw !== "" ? parseFloat(minRaw) : 0;

  const supabase = await createClient();
  const { error } = await supabase
    .from("raw_materials")
    .update({
      name: name.trim(),
      unit: unit.trim(),
      cost_per_unit: costPerUnit,
      min_stock_alert: isNaN(minStock) ? 0 : minStock,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/inventory");
  return { success: true };
}

export async function deleteRawMaterial(formData: FormData): Promise<void> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return;

  const id = formData.get("id");
  if (typeof id !== "string") return;

  const supabase = await createClient();
  await supabase
    .from("raw_materials")
    .delete()
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);

  revalidatePath("/inventory");
}

export async function receiveStock(
  prevState: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const rawMaterialId = formData.get("raw_material_id");
  const qtyRaw = formData.get("quantity");
  const note = formData.get("note");

  if (typeof rawMaterialId !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  const quantity = typeof qtyRaw === "string" ? parseFloat(qtyRaw) : NaN;
  if (isNaN(quantity) || quantity <= 0) {
    return { error: "กรุณากรอกจำนวนที่ถูกต้อง (> 0)" };
  }

  const supabase = await createClient();

  // Fetch current stock (tenant-scoped)
  const { data: mat } = await supabase
    .from("raw_materials")
    .select("current_stock")
    .eq("id", rawMaterialId)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (!mat) return { error: "ไม่พบวัตถุดิบ" };

  const newStock = Number(mat.current_stock) + quantity;

  const { error: updateErr } = await supabase
    .from("raw_materials")
    .update({ current_stock: newStock, updated_at: new Date().toISOString() })
    .eq("id", rawMaterialId)
    .eq("tenant_id", profile.tenant_id);

  if (updateErr) return { error: "อัปเดตสต็อกไม่สำเร็จ" };

  const { error: txErr } = await supabase.from("inventory_transactions").insert({
    tenant_id: profile.tenant_id,
    raw_material_id: rawMaterialId,
    type: "receive",
    quantity,
    note: typeof note === "string" && note.trim() !== "" ? note.trim() : null,
    created_by: profile.id,
  });

  if (txErr) return { error: "บันทึกประวัติไม่สำเร็จ" };

  revalidatePath("/inventory");
  return { success: true };
}

export async function adjustStock(
  prevState: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const rawMaterialId = formData.get("raw_material_id");
  const newStockRaw = formData.get("new_stock");
  const note = formData.get("note");

  if (typeof rawMaterialId !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  const newStock = typeof newStockRaw === "string" ? parseFloat(newStockRaw) : NaN;
  if (isNaN(newStock) || newStock < 0) {
    return { error: "กรุณากรอกจำนวนสต็อกที่ถูกต้อง (>= 0)" };
  }

  const supabase = await createClient();

  const { data: mat } = await supabase
    .from("raw_materials")
    .select("current_stock")
    .eq("id", rawMaterialId)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (!mat) return { error: "ไม่พบวัตถุดิบ" };

  const delta = newStock - Number(mat.current_stock);

  const { error: updateErr } = await supabase
    .from("raw_materials")
    .update({ current_stock: newStock, updated_at: new Date().toISOString() })
    .eq("id", rawMaterialId)
    .eq("tenant_id", profile.tenant_id);

  if (updateErr) return { error: "อัปเดตสต็อกไม่สำเร็จ" };

  const { error: txErr } = await supabase.from("inventory_transactions").insert({
    tenant_id: profile.tenant_id,
    raw_material_id: rawMaterialId,
    type: "adjust",
    quantity: delta,
    note: typeof note === "string" && note.trim() !== "" ? note.trim() : null,
    created_by: profile.id,
  });

  if (txErr) return { error: "บันทึกประวัติไม่สำเร็จ" };

  revalidatePath("/inventory");
  return { success: true };
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 3: Commit**

```powershell
git add src/app/actions/inventory.ts
git commit -m "feat(inventory): add raw material CRUD and stock actions"
```

---

### Task 4: Modifier Actions (`src/app/actions/modifiers.ts`)

**Files:**
- Create: `src/app/actions/modifiers.ts`

**Interfaces:**
- Produces: `ModifierState`, `createModifier`, `updateModifier`, `deleteModifier`, `createModifierOption`, `deleteModifierOption`

**Note on modifier_options:** This table has no `tenant_id`. For create, verify the parent modifier belongs to the tenant. For delete, verify via a JOIN to modifiers.

- [ ] **Step 1: Create `src/app/actions/modifiers.ts`**

```typescript
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";

export type ModifierState = { error?: string; success?: boolean } | undefined;

function isManagerOrOwner(role: string): boolean {
  return role === "owner" || role === "manager";
}

export async function createModifier(
  prevState: ModifierState,
  formData: FormData
): Promise<ModifierState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const name = formData.get("name");
  const isRequired = formData.get("is_required") === "on";
  const isMultiSelect = formData.get("is_multi_select") === "on";
  const sortRaw = formData.get("sort_order");
  const sortOrder =
    typeof sortRaw === "string" && sortRaw !== "" ? parseInt(sortRaw, 10) : 0;

  if (typeof name !== "string" || name.trim() === "") {
    return { error: "กรุณากรอกชื่อตัวเลือก" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("modifiers").insert({
    tenant_id: profile.tenant_id,
    name: name.trim(),
    is_required: isRequired,
    is_multi_select: isMultiSelect,
    sort_order: isNaN(sortOrder) ? 0 : sortOrder,
  });

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/modifiers");
  return { success: true };
}

export async function updateModifier(
  prevState: ModifierState,
  formData: FormData
): Promise<ModifierState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const id = formData.get("id");
  const name = formData.get("name");
  const isRequired = formData.get("is_required") === "on";
  const isMultiSelect = formData.get("is_multi_select") === "on";
  const sortRaw = formData.get("sort_order");
  const sortOrder =
    typeof sortRaw === "string" && sortRaw !== "" ? parseInt(sortRaw, 10) : 0;

  if (typeof id !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  if (typeof name !== "string" || name.trim() === "") {
    return { error: "กรุณากรอกชื่อตัวเลือก" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("modifiers")
    .update({
      name: name.trim(),
      is_required: isRequired,
      is_multi_select: isMultiSelect,
      sort_order: isNaN(sortOrder) ? 0 : sortOrder,
    })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/modifiers");
  return { success: true };
}

export async function deleteModifier(formData: FormData): Promise<void> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return;

  const id = formData.get("id");
  if (typeof id !== "string") return;

  const supabase = await createClient();
  // ON DELETE CASCADE on modifier_options, product_modifiers — DB handles cleanup
  await supabase
    .from("modifiers")
    .delete()
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);

  revalidatePath("/modifiers");
}

export async function createModifierOption(
  prevState: ModifierState,
  formData: FormData
): Promise<ModifierState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const modifierId = formData.get("modifier_id");
  const name = formData.get("name");
  const priceDeltaRaw = formData.get("price_delta");
  const sortRaw = formData.get("sort_order");

  if (typeof modifierId !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  if (typeof name !== "string" || name.trim() === "") {
    return { error: "กรุณากรอกชื่อตัวเลือกย่อย" };
  }
  const priceDelta =
    typeof priceDeltaRaw === "string" && priceDeltaRaw !== ""
      ? parseFloat(priceDeltaRaw)
      : 0;
  const sortOrder =
    typeof sortRaw === "string" && sortRaw !== "" ? parseInt(sortRaw, 10) : 0;

  const supabase = await createClient();

  // Verify modifier belongs to this tenant before inserting option
  const { data: mod } = await supabase
    .from("modifiers")
    .select("id")
    .eq("id", modifierId)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (!mod) return { error: "ไม่พบกลุ่มตัวเลือก" };

  const { error } = await supabase.from("modifier_options").insert({
    modifier_id: modifierId,
    name: name.trim(),
    price_delta: isNaN(priceDelta) ? 0 : priceDelta,
    sort_order: isNaN(sortOrder) ? 0 : sortOrder,
  });

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/modifiers");
  return { success: true };
}

export async function deleteModifierOption(formData: FormData): Promise<void> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return;

  const id = formData.get("id");
  if (typeof id !== "string") return;

  const supabase = await createClient();

  // Verify option belongs to this tenant via modifier join
  const { data: opt } = await supabase
    .from("modifier_options")
    .select("id, modifiers(tenant_id)")
    .eq("id", id)
    .single();

  const mod = opt?.modifiers as { tenant_id: string } | null;
  if (!opt || mod?.tenant_id !== profile.tenant_id) return;

  await supabase.from("modifier_options").delete().eq("id", id);

  revalidatePath("/modifiers");
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 3: Commit**

```powershell
git add src/app/actions/modifiers.ts
git commit -m "feat(modifiers): add modifier group and option CRUD actions"
```

---

### Task 5: Customer Actions (`src/app/actions/customers.ts`)

**Files:**
- Create: `src/app/actions/customers.ts`

**Interfaces:**
- Produces: `findOrCreateCustomer(data: { phone?: string; name: string }): Promise<{ customerId: string } | { error: string }>`

- [ ] **Step 1: Create `src/app/actions/customers.ts`**

```typescript
"use server";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";

export async function findOrCreateCustomer(data: {
  phone?: string;
  name: string;
}): Promise<{ customerId: string } | { error: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };

  if (!data.name.trim()) return { error: "กรุณากรอกชื่อลูกค้า" };

  const supabase = await createClient();

  // If phone provided, try to find existing customer
  if (data.phone && data.phone.trim() !== "") {
    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .eq("tenant_id", profile.tenant_id)
      .eq("phone", data.phone.trim())
      .single();

    if (existing) return { customerId: existing.id };
  }

  // Create new customer
  const { data: customer, error } = await supabase
    .from("customers")
    .insert({
      tenant_id: profile.tenant_id,
      name: data.name.trim(),
      phone: data.phone?.trim() ?? null,
    })
    .select("id")
    .single();

  if (error || !customer) return { error: "บันทึกข้อมูลลูกค้าไม่สำเร็จ" };

  return { customerId: customer.id };
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 3: Commit**

```powershell
git add src/app/actions/customers.ts
git commit -m "feat(customers): add findOrCreateCustomer action for CRM foundation"
```

---

### Task 6: Products Actions Extensions (`src/app/actions/products.ts`)

**Files:**
- Modify: `src/app/actions/products.ts`

**Interfaces:**
- Produces: `updateProductRecipes(formData)`, `updateProductModifiers(formData)`, `uploadProductImage(formData)`

**FormData convention for recipe arrays:** Multiple rows use repeated keys — `formData.getAll("raw_material_id")` and `formData.getAll("quantity_used")` return parallel arrays indexed by position.

- [ ] **Step 1: Add three functions to the bottom of `src/app/actions/products.ts`**

Append after the last existing function (`deleteProduct`):

```typescript
export async function updateProductRecipes(
  formData: FormData
): Promise<void> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return;

  const productId = formData.get("product_id");
  if (typeof productId !== "string") return;

  const supabase = await createClient();

  // Delete all existing recipes for this product
  await supabase
    .from("product_recipes")
    .delete()
    .eq("product_id", productId)
    .eq("tenant_id", profile.tenant_id);

  // Build new recipes from parallel arrays
  const rawIds = formData.getAll("raw_material_id");
  const qtys = formData.getAll("quantity_used");

  const recipes: {
    tenant_id: string;
    product_id: string;
    raw_material_id: string;
    quantity_used: number;
  }[] = [];

  for (let i = 0; i < rawIds.length; i++) {
    const idVal = rawIds[i];
    const qtyVal = qtys[i];
    if (typeof idVal !== "string" || typeof qtyVal !== "string") continue;
    const qty = parseFloat(qtyVal);
    if (isNaN(qty) || qty <= 0) continue;
    recipes.push({
      tenant_id: profile.tenant_id,
      product_id: productId,
      raw_material_id: idVal,
      quantity_used: qty,
    });
  }

  if (recipes.length > 0) {
    await supabase.from("product_recipes").insert(recipes);
  }

  revalidatePath(`/products/${productId}/edit`);
}

export async function updateProductModifiers(
  formData: FormData
): Promise<void> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return;

  const productId = formData.get("product_id");
  if (typeof productId !== "string") return;

  const supabase = await createClient();

  // Delete all existing modifier links for this product
  await supabase
    .from("product_modifiers")
    .delete()
    .eq("product_id", productId)
    .eq("tenant_id", profile.tenant_id);

  const modifierIds = formData.getAll("modifier_id");
  const links: {
    tenant_id: string;
    product_id: string;
    modifier_id: string;
  }[] = [];

  for (const mid of modifierIds) {
    if (typeof mid !== "string") continue;
    links.push({
      tenant_id: profile.tenant_id,
      product_id: productId,
      modifier_id: mid,
    });
  }

  if (links.length > 0) {
    await supabase.from("product_modifiers").insert(links);
  }

  revalidatePath(`/products/${productId}/edit`);
}

export async function uploadProductImage(
  formData: FormData
): Promise<{ url: string } | { error: string }> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const file = formData.get("image");
  if (!(file instanceof File)) return { error: "ไม่พบไฟล์" };
  if (file.size === 0) return { error: "ไฟล์ว่างเปล่า" };
  if (file.size > 5 * 1024 * 1024) return { error: "ไฟล์ขนาดใหญ่เกิน 5MB" };

  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${profile.tenant_id}/${Date.now()}.${ext}`;

  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(path, file, { upsert: false });

  if (uploadError) return { error: "อัปโหลดรูปภาพไม่สำเร็จ" };

  const { data: urlData } = supabase.storage
    .from("product-images")
    .getPublicUrl(path);

  return { url: urlData.publicUrl };
}
```

Also add `import { revalidatePath } from "next/cache";` to the imports at the top of `products.ts` if it's not already there. The current file uses `redirect` but not `revalidatePath` — add it.

Current imports line 1-4:
```typescript
"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";
```

Updated imports:
```typescript
"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 3: Commit**

```powershell
git add src/app/actions/products.ts
git commit -m "feat(products): add recipe, modifier link, and image upload actions"
```

---

### Task 7: DAL Extensions (`src/lib/dal.ts`)

**Files:**
- Modify: `src/lib/dal.ts`

**Interfaces:**
- Consumes: `ModifierWithOptions`, `ProductCost`, `LowStockAlert` from `@/types/app` (Task 1)
- Produces: `Customer`, `RawMaterial` types + 7 new functions

**TypeScript notes for noUncheckedIndexedAccess:**
- Supabase FK joins: `p.categories` typed as object (many-to-one) or array (one-to-many). Cast explicitly.
- `Map.get(key)` returns `T | undefined` — use `?? 0` or `?? []` when reading.
- `data ?? []` before iterating — never trust Supabase data as non-null.

- [ ] **Step 1: Add imports and new types to `src/lib/dal.ts`**

Add at the top, after the existing imports:

```typescript
import type { ModifierWithOptions, ProductCost, LowStockAlert } from "@/types/app";
```

Add the new types after the existing `TeamMember` type (after line 146 in the current file):

```typescript
export type Customer = {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type RawMaterial = {
  id: string;
  tenant_id: string;
  name: string;
  unit: string;
  cost_per_unit: number;
  current_stock: number;
  min_stock_alert: number;
  created_at: string | null;
  updated_at: string | null;
};
```

- [ ] **Step 2: Add 7 new DAL functions at the end of `src/lib/dal.ts`**

Append after the last function:

```typescript
export async function getCustomerByPhone(
  phone: string,
  tenantId: string
): Promise<Customer | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("phone", phone)
    .single();
  return data as Customer | null;
}

export async function getRawMaterials(tenantId: string): Promise<RawMaterial[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("raw_materials")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("name");
  return (data ?? []) as RawMaterial[];
}

export async function getLowStockAlerts(
  tenantId: string
): Promise<LowStockAlert[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("raw_materials")
    .select("id, name, unit, current_stock, min_stock_alert")
    .eq("tenant_id", tenantId);

  return ((data ?? []) as Array<{
    id: string;
    name: string;
    unit: string;
    current_stock: number;
    min_stock_alert: number;
  }>)
    .filter(
      (m) =>
        Number(m.min_stock_alert) > 0 &&
        Number(m.current_stock) <= Number(m.min_stock_alert)
    )
    .map((m) => ({
      id: m.id,
      name: m.name,
      unit: m.unit,
      currentStock: Number(m.current_stock),
      minStockAlert: Number(m.min_stock_alert),
    }));
}

export async function getModifiersForProduct(
  productId: string
): Promise<ModifierWithOptions[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_modifiers")
    .select(
      `modifiers(
        id, name, is_required, is_multi_select, sort_order,
        modifier_options(id, name, price_delta, sort_order)
      )`
    )
    .eq("product_id", productId);

  if (!data) return [];

  type ModRow = {
    id: string;
    name: string;
    is_required: boolean;
    is_multi_select: boolean;
    sort_order: number | null;
    modifier_options: Array<{
      id: string;
      name: string;
      price_delta: number | null;
      sort_order: number | null;
    }>;
  };

  return (data as Array<{ modifiers: ModRow | null }>)
    .map((pm) => pm.modifiers)
    .filter((m): m is ModRow => m !== null)
    .map((m) => ({
      id: m.id,
      name: m.name,
      isRequired: m.is_required,
      isMultiSelect: m.is_multi_select,
      sortOrder: m.sort_order ?? 0,
      options: (m.modifier_options ?? [])
        .map((o) => ({
          id: o.id,
          name: o.name,
          priceDelta: Number(o.price_delta ?? 0),
          sortOrder: o.sort_order ?? 0,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getProductCost(productId: string): Promise<ProductCost> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_recipes")
    .select("quantity_used, raw_materials(name, unit, cost_per_unit)")
    .eq("product_id", productId);

  if (!data) return { productId, ingredientCost: 0, recipes: [] };

  type RecipeRow = {
    quantity_used: number;
    raw_materials: { name: string; unit: string; cost_per_unit: number } | null;
  };

  const recipes = (data as RecipeRow[])
    .filter((r) => r.raw_materials !== null)
    .map((r) => {
      const mat = r.raw_materials!;
      const quantityUsed = Number(r.quantity_used);
      const costPerUnit = Number(mat.cost_per_unit);
      return {
        materialName: mat.name,
        unit: mat.unit,
        quantityUsed,
        costPerUnit,
        lineCost: quantityUsed * costPerUnit,
      };
    });

  return {
    productId,
    ingredientCost: recipes.reduce((sum, r) => sum + r.lineCost, 0),
    recipes,
  };
}

export async function getSalesByHour(
  tenantId: string,
  date: string // "YYYY-MM-DD" in Bangkok time
): Promise<{ hour: number; total: number }[]> {
  const supabase = await createClient();
  const offsetMs = 7 * 60 * 60 * 1000; // UTC+7
  const dayStart = new Date(`${date}T00:00:00+07:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const { data } = await supabase
    .from("orders")
    .select("created_at, total")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .gte("created_at", dayStart.toISOString())
    .lt("created_at", dayEnd.toISOString());

  const byHour = new Map<number, number>();
  for (const row of (data ?? []) as { created_at: string; total: number }[]) {
    const bkkHour = new Date(
      new Date(row.created_at).getTime() + offsetMs
    ).getUTCHours();
    byHour.set(bkkHour, (byHour.get(bkkHour) ?? 0) + Number(row.total));
  }

  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    total: byHour.get(h) ?? 0,
  }));
}

export async function getSalesByCategory(
  tenantId: string,
  range: "day" | "week" | "month"
): Promise<{ category: string; total: number }[]> {
  const supabase = await createClient();
  const offsetMs = 7 * 60 * 60 * 1000;
  const now = new Date();
  const bangkokNow = new Date(now.getTime() + offsetMs);

  let rangeStart: Date;
  if (range === "day") {
    const midnight = Date.UTC(
      bangkokNow.getUTCFullYear(),
      bangkokNow.getUTCMonth(),
      bangkokNow.getUTCDate()
    );
    rangeStart = new Date(midnight - offsetMs);
  } else if (range === "week") {
    rangeStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else {
    rangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  const { data: orders } = await supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .gte("created_at", rangeStart.toISOString());

  if (!orders || orders.length === 0) return [];

  const orderIds = (orders as { id: string }[]).map((o) => o.id);

  const { data: items } = await supabase
    .from("order_items")
    .select("category_name, subtotal")
    .in("order_id", orderIds);

  const byCategory = new Map<string, number>();
  for (const item of (items ?? []) as {
    category_name: string | null;
    subtotal: number;
  }[]) {
    const cat = item.category_name ?? "ไม่มีหมวดหมู่";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + Number(item.subtotal));
  }

  return [...byCategory.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: zero errors

- [ ] **Step 4: Commit**

```powershell
git add src/lib/dal.ts
git commit -m "feat(dal): add 7 new DAL functions for inventory, modifiers, customers, analytics"
```

- [ ] **Step 5: Push all Stack 10 changes**

```powershell
git push origin main
```

---

## Self-Review

### Spec Coverage

| Spec requirement | Task |
|-----------------|------|
| `src/types/app.ts` — 6 types | Task 1 ✅ |
| `createOrder` with order_number, snapshots, stock deduction | Task 2 ✅ |
| `createRawMaterial`, `updateRawMaterial`, `deleteRawMaterial` | Task 3 ✅ |
| `receiveStock` (type='receive') | Task 3 ✅ |
| `adjustStock` (type='adjust') | Task 3 ✅ |
| Modifier group CRUD | Task 4 ✅ |
| Modifier option CRUD | Task 4 ✅ |
| `findOrCreateCustomer` | Task 5 ✅ |
| `updateProductRecipes` (replace-all) | Task 6 ✅ |
| `updateProductModifiers` (replace-all) | Task 6 ✅ |
| `uploadProductImage` → Supabase Storage | Task 6 ✅ |
| `getCustomerByPhone` | Task 7 ✅ |
| `getRawMaterials` | Task 7 ✅ |
| `getLowStockAlerts` | Task 7 ✅ |
| `getModifiersForProduct` | Task 7 ✅ |
| `getProductCost` | Task 7 ✅ |
| `getSalesByHour` | Task 7 ✅ |
| `getSalesByCategory` | Task 7 ✅ |

### Type Consistency

- `CartItem` defined in Task 1 (`src/types/app.ts`), imported by Task 2 (`orders.ts`) and POS components — ✅
- `LowStockAlert`, `ModifierWithOptions`, `ProductCost` defined in Task 1, imported by Task 7 — ✅
- `CreateOrderInput.items` uses `CartItem` from Task 1 — ✅
- `InventoryState`, `ModifierState` are per-file types (same pattern as `SettingsState`) — ✅

### Security

- Every action: `getProfile()` first, role check, `.eq("tenant_id", profile.tenant_id)` on all queries — ✅
- `modifier_options` tenant verification done via modifier FK check before insert/delete — ✅
- Storage upload: path is `${tenant_id}/${timestamp}.ext` — isolated per tenant — ✅
- No secrets, no `getSession()` — ✅
