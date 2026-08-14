# Order Discount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff apply a whole-bill discount (percent or fixed ฿) in the POS cart before
checkout, gated by a Manager/Owner PIN approval (entered in-place, no identity switch) whenever the
discount crosses a hardcoded threshold (>20% or >฿100).

**Architecture:** `createOrder` (`src/app/actions/orders.ts`) gains the entire discount computation
and PIN-verification inline, mirroring how `voidOrder` verifies an approver PIN today (admin-client
lookup of Manager/Owner `pin_hash` rows, `bcrypt.compare` against each candidate). A new tiny pure
helper (`src/lib/discount.ts`) computes `{ discountAmount, requiresApproval, total }` from a
subtotal/type/value triple; it's shared between the client-side preview (`SmartCart`/`PosScreen`,
display-only, never trusted) and the server-side authority (`createOrder`, recomputes from its own
server-derived subtotal) so the threshold logic can't drift between the two. `PosScreen` lifts all
discount state (type, value, reason, captured approver PIN, attempt counter) the same way it already
owns `orderType`/`paymentMethod`/`customerId` — `SmartCart` stays a fully controlled component with
no new local business state, and renders its own approval modal (reusing `PinPad`) when
`requiresApproval && !hasApproverPin`.

**Tech Stack:** Same as the rest of the app — Next.js 16 Server Actions, Supabase (Postgres +
PostgREST + RPC), bcryptjs. No test framework in this repo — verification is manual live-browser QA.

## Global Constraints

- Exact Thai copy strings below are final — use them verbatim, do not rephrase.
- No automated tests exist in this project (`package.json` has no test script) — do not add a test
  framework. Verify by running the app and clicking through it.
- The DB migration must be applied directly to the production Supabase project via the Supabase MCP
  `apply_migration` tool first (project id `khgahdjfkzpgsvbhfrqx`, this project's established
  practice all session), *then* written to `supabase/migrations/` as a matching file, then
  regenerate `src/types/database.ts` via the MCP `generate_typescript_types` tool and overwrite the
  file wholesale (do not hand-edit it).
- Reuse the existing `PinPad` (`src/components/ui/pin-pad.tsx`), `Button`, `Label`, and `Input`
  components exactly as used elsewhere — do not create new primitives.
- The approval modal's styling must match the existing hand-rolled overlay pattern used by
  `src/components/orders/void-order-button.tsx` and `src/components/pos/qr-payment-modal.tsx`
  (`fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4` wrapping a
  `bg-white rounded-xl p-6 w-full max-w-sm` card) — this project has no dialog/modal library.
- The approval threshold (`> 20%` or `> ฿100`, whichever is crossed first) is a hardcoded constant
  in `src/lib/discount.ts` — not a per-tenant setting, no Settings UI in v1.
- Do not resolve `discount_approved_by` to a display name in v1 — same reasoning as void order's
  `cancelled_approved_by` (the order detail page never resolved that one either): `orders` already
  has multiple FKs to `profiles`, and PostgREST requires explicit `!constraint_name`
  disambiguation for embeds in that situation. Just record it for audit; don't render it.
- The client-side discount preview (`computeDiscount` called from `SmartCart`/`PosScreen`) is
  display-only. Never trust it for the actual write — `createOrder` recomputes independently from
  its own server-derived subtotal, exactly like the existing (pre-existing, out-of-scope-to-fix)
  trust boundary around cart pricing already works today.
- Whole-bill discount only — no per-line-item discount in v1.

---

### Task 1: Order discount feature (migration + helper + action + UI)

**Files:**
- Create: `supabase/migrations/20260814130000_order_discount.sql`
- Modify: `src/types/database.ts` (regenerate wholesale after migration — do not hand-edit)
- Create: `src/lib/discount.ts`
- Modify: `src/types/app.ts`
- Modify: `src/app/actions/orders.ts`
- Modify: `src/components/pos/smart-cart.tsx`
- Modify: `src/components/pos/pos-screen.tsx`
- Modify: `src/app/(shell)/orders/[id]/page.tsx`

**Interfaces:**
- Produces: `computeDiscount(subtotal: number, type: DiscountType | null, value: number): { discountAmount: number; requiresApproval: boolean; total: number }` and `type DiscountType = "percent" | "amount"` from `src/lib/discount.ts`.
- Produces: `createOrder(data: CreateOrderInput)` gains optional `discountType`, `discountValue`,
  `discountReason`, `approverPin` fields on its input — same return shape as today
  (`{ error: string } | { orderId: string; orderNumber: string }`).
- Produces: `SmartCart` gains discount-related props (see Step 6) — still a fully controlled
  component, no new callbacks beyond what's listed there.
- Consumes: existing `PinPad` (`src/components/ui/pin-pad.tsx`,
  `{ length?: number; onComplete: (pin: string) => void; disabled?: boolean }`), existing `Button`,
  `Label`, `Input` from `src/components/ui/`, existing `getProfile`/`getActiveShift` from
  `src/lib/dal.ts`, existing `createAdminClient` from `src/lib/supabase/admin.ts`.

- [ ] **Step 1: Apply the migration directly to the production Supabase project**

Use the Supabase MCP `apply_migration` tool (project id `khgahdjfkzpgsvbhfrqx`), name
`order_discount`, with this exact SQL:

```sql
alter table public.orders
  add column subtotal numeric not null default 0,
  add column discount_type text,
  add column discount_value numeric,
  add column discount_amount numeric not null default 0,
  add column discount_reason text,
  add column discount_approved_by uuid references public.profiles(id);

update public.orders set subtotal = total;

alter table public.orders
  add constraint orders_discount_type_check
    check (discount_type is null or discount_type in ('percent', 'amount'));

comment on column public.orders.subtotal is
  'Pre-discount sum of order_items.subtotal. Equals total when no discount was applied.';
comment on column public.orders.discount_type is
  '''percent'' or ''amount''. Null if no discount was applied to this order.';
comment on column public.orders.discount_value is
  'Raw value staff entered (e.g. 10 for 10%, 20 for a ฿20 discount). Null if no discount.';
comment on column public.orders.discount_amount is
  'Resolved baht amount deducted, computed server-side. 0 if no discount.';
comment on column public.orders.discount_reason is
  'Required only when the discount crossed the approval threshold (>20% or >฿100).';
comment on column public.orders.discount_approved_by is
  'Profile whose PIN matched during discount approval. Null when under threshold (no approval needed).';

-- orders_insert_own_tenant's RLS has no WITH CHECK beyond tenant_id/created_by, so any
-- authenticated tenant member could otherwise INSERT an order claiming any discount_approved_by
-- they like via the public Data API, fully bypassing the PIN check createOrder performs before
-- setting it — same class of gap as void order's cancelled_approved_by. This blocks any
-- non-service_role insert that sets discount_approved_by; createOrder uses the admin
-- (service_role) client for that specific insert once a PIN has been verified, so auth.uid() is
-- NULL there and the check never fires for the legitimate path.
create or replace function public.prevent_direct_discount_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.discount_approved_by is not null and auth.uid() is not null then
    raise exception 'Discount approval requires PIN verification via the app';
  end if;
  return new;
end;
$$;

create trigger prevent_direct_discount_approval_trigger
before insert on public.orders
for each row
execute function public.prevent_direct_discount_approval();
```

- [ ] **Step 2: Write the same SQL to a migration file in the repo**

Create `supabase/migrations/20260814130000_order_discount.sql` with the exact SQL from Step 1
(including the comments).

- [ ] **Step 3: Regenerate `src/types/database.ts`**

Call the Supabase MCP `generate_typescript_types` tool for project `khgahdjfkzpgsvbhfrqx` and
overwrite `src/types/database.ts` with the returned content in full. Verify afterward that
`Database["public"]["Tables"]["orders"]["Row"]` includes `subtotal`, `discount_type`,
`discount_value`, `discount_amount`, `discount_reason`, `discount_approved_by`.

- [ ] **Step 4: Create `src/lib/discount.ts`**

```ts
export const DISCOUNT_APPROVAL_THRESHOLD_PERCENT = 20;
export const DISCOUNT_APPROVAL_THRESHOLD_AMOUNT = 100;

export type DiscountType = "percent" | "amount";

export function computeDiscount(
  subtotal: number,
  type: DiscountType | null,
  value: number
): { discountAmount: number; requiresApproval: boolean; total: number } {
  if (type === null || !Number.isFinite(value) || value <= 0) {
    return { discountAmount: 0, requiresApproval: false, total: subtotal };
  }
  const discountAmount =
    type === "percent" ? subtotal * (value / 100) : Math.min(value, subtotal);
  const requiresApproval =
    discountAmount > DISCOUNT_APPROVAL_THRESHOLD_AMOUNT ||
    (subtotal > 0 &&
      discountAmount / subtotal > DISCOUNT_APPROVAL_THRESHOLD_PERCENT / 100);
  return { discountAmount, requiresApproval, total: subtotal - discountAmount };
}
```

- [ ] **Step 5: Extend `src/types/app.ts`**

Add this import at the top of the file:

```ts
import type { DiscountType } from "@/lib/discount";
```

Replace the existing `CreateOrderInput` type with:

```ts
export type CreateOrderInput = {
  items: CartItem[];
  paymentMethod: "cash" | "transfer" | "card";
  orderType: "dine_in" | "take_away";
  tableNumber?: string;
  customerId?: string;
  note?: string;
  discountType?: DiscountType;
  discountValue?: number;
  discountReason?: string;
  approverPin?: string;
};
```

Leave every other type in the file unchanged.

- [ ] **Step 6: Extend `createOrder` in `src/app/actions/orders.ts`**

Replace the file's content from the top through the end of the `createOrder` function (everything
before `export type VoidOrderState`) with:

```ts
"use server";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile, getActiveShift } from "@/lib/dal";
import { computeDiscount } from "@/lib/discount";
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

  // 3. Calculate subtotal from CartItem.totalPrice
  const subtotal = data.items.reduce((sum, item) => sum + item.totalPrice, 0);

  // 3.5. Resolve and validate the discount, if any
  let discountType: "percent" | "amount" | null = null;
  let discountValue: number | null = null;
  let discountReason: string | null = null;
  let discountAmount = 0;
  let requiresApproval = false;

  if (data.discountType !== undefined) {
    const value = data.discountValue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return { error: "ส่วนลดไม่ถูกต้อง" };
    }
    if (data.discountType === "percent" && value > 100) {
      return { error: "ส่วนลดไม่ถูกต้อง" };
    }
    if (data.discountType === "amount" && value > subtotal) {
      return { error: "ส่วนลดมากกว่ายอดรวม" };
    }

    const computed = computeDiscount(subtotal, data.discountType, value);
    discountType = data.discountType;
    discountValue = value;
    discountAmount = computed.discountAmount;
    requiresApproval = computed.requiresApproval;

    const reason = (data.discountReason ?? "").trim();
    if (requiresApproval && reason === "") {
      return { error: "กรุณาระบุเหตุผลสำหรับส่วนลดนี้" };
    }
    discountReason = reason !== "" ? reason : null;
  }

  const total = subtotal - discountAmount;

  // 3.6. PIN-verify a Manager/Owner approver when the discount crosses the threshold
  let approverId: string | null = null;
  if (requiresApproval) {
    const pin = data.approverPin;
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
      return { error: "PIN ไม่ถูกต้อง" };
    }

    const admin = createAdminClient();
    const { data: approvers } = await admin
      .from("profiles")
      .select("id, pin_hash")
      .eq("tenant_id", profile.tenant_id)
      .in("role", ["owner", "manager"])
      .not("pin_hash", "is", null);

    for (const approver of approvers ?? []) {
      if (approver.pin_hash && (await bcrypt.compare(pin, approver.pin_hash))) {
        approverId = approver.id;
        break;
      }
    }
    if (!approverId) return { error: "PIN ไม่ถูกต้อง" };
  }

  // 3.7. Best-effort: attach the currently open shift (does not block the sale if none is open)
  const activeShift = await getActiveShift(profile.tenant_id);

  // 4. Insert order row. Written via the admin client only when an approval was just verified
  // above (discount_approved_by non-null) — prevent_direct_discount_approval rejects that exact
  // write from any caller except service_role, so the trigger and this client choice must be
  // changed together.
  const insertClient = approverId !== null ? createAdminClient() : supabase;
  const { data: order, error: orderError } = await insertClient
    .from("orders")
    .insert({
      tenant_id: profile.tenant_id,
      created_by: profile.id,
      payment_method: data.paymentMethod,
      subtotal,
      total,
      discount_type: discountType,
      discount_value: discountValue,
      discount_amount: discountAmount,
      discount_reason: discountReason,
      discount_approved_by: approverId,
      order_number: orderNumber,
      order_type: data.orderType,
      table_number: data.tableNumber ?? null,
      customer_id: data.customerId ?? null,
      note: data.note ?? null,
      shift_id: activeShift?.id ?? null,
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
  const { error: deductError } = await supabase.rpc("deduct_stock_for_order", {
    p_order_id: order.id,
  });
  if (deductError) {
    console.error(
      "[createOrder] deduct_stock_for_order failed:",
      deductError.message
    );
  }

  revalidatePath("/orders");
  return { orderId: order.id, orderNumber };
}
```

Leave `voidOrder` (everything from `export type VoidOrderState` to the end of the file) exactly as
it is today — this task does not touch it.

- [ ] **Step 7: Add discount UI to `src/components/pos/smart-cart.tsx`**

Replace the entire file with:

```tsx
"use client";
import { useState, useTransition } from "react";
import type { CartItem } from "@/types/app";
import type { DiscountType } from "@/lib/discount";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PinPad } from "@/components/ui/pin-pad";
import { findOrCreateCustomer } from "@/app/actions/customers";

type PaymentMethod = "cash" | "transfer" | "card";
type OrderType = "dine_in" | "take_away";

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "เงินสด",
  transfer: "โอน",
  card: "บัตร",
};
const PAYMENT_METHODS: PaymentMethod[] = ["cash", "transfer", "card"];

type Props = {
  cartItems: CartItem[];
  onUpdateQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  orderType: OrderType;
  onOrderTypeChange: (type: OrderType) => void;
  tableNumber: string;
  onTableNumberChange: (value: string) => void;
  paymentMethod: PaymentMethod;
  onPaymentChange: (method: PaymentMethod) => void;
  customerId: string | null;
  onCustomerIdChange: (id: string | null) => void;
  discountType: DiscountType | null;
  onDiscountTypeChange: (type: DiscountType | null) => void;
  discountValue: string;
  onDiscountValueChange: (value: string) => void;
  discountReason: string;
  onDiscountReasonChange: (value: string) => void;
  subtotal: number;
  discountAmount: number;
  requiresApproval: boolean;
  total: number;
  hasApproverPin: boolean;
  onApproverPinComplete: (pin: string) => void;
  onCancelDiscount: () => void;
  pending: boolean;
  error: string | null;
  lastOrderNumber: string | null;
  onCheckout: () => void;
};

export function SmartCart({
  cartItems,
  onUpdateQty,
  onRemove,
  onClear,
  orderType,
  onOrderTypeChange,
  tableNumber,
  onTableNumberChange,
  paymentMethod,
  onPaymentChange,
  customerId,
  onCustomerIdChange,
  discountType,
  onDiscountTypeChange,
  discountValue,
  onDiscountValueChange,
  discountReason,
  onDiscountReasonChange,
  subtotal,
  discountAmount,
  requiresApproval,
  total,
  hasApproverPin,
  onApproverPinComplete,
  onCancelDiscount,
  pending,
  error,
  lastOrderNumber,
  onCheckout,
}: Props) {
  const [phone, setPhone] = useState("");
  const [linkedPhone, setLinkedPhone] = useState<string | null>(null);
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null);
  const [searchPending, startSearch] = useTransition();

  function handleLinkCustomer() {
    const trimmed = phone.trim();
    if (!trimmed) return;
    setCustomerSearchError(null);
    startSearch(async () => {
      // Use phone as fallback name so findOrCreateCustomer always has a non-empty name
      const result = await findOrCreateCustomer({ phone: trimmed, name: trimmed });
      if ("error" in result) {
        setCustomerSearchError(result.error);
      } else {
        onCustomerIdChange(result.customerId);
        setLinkedPhone(trimmed);
      }
    });
  }

  function handleClearCustomer() {
    setPhone("");
    setLinkedPhone(null);
    setCustomerSearchError(null);
    onCustomerIdChange(null);
  }

  function orderTypeCls(active: boolean) {
    return (
      "flex-1 rounded-md border py-1.5 text-xs font-medium transition-colors " +
      (active
        ? "border-accent bg-accent text-white"
        : "border-input text-muted-foreground hover:border-accent hover:text-accent")
    );
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border">
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

      {/* Cart items */}
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {cartItems.length === 0 ? (
          <div className="py-10 text-center">
            {lastOrderNumber && (
              <p className="text-sm font-semibold text-sidebar mb-1">
                ออเดอร์ {lastOrderNumber} สำเร็จ ✓
              </p>
            )}
            <p className="text-muted-foreground text-sm">คลิกสินค้าเพื่อเพิ่ม</p>
          </div>
        ) : (
          cartItems.map((item) => (
            <div
              key={item.cartItemKey}
              className="flex items-start gap-2 px-3 py-2.5"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar truncate">
                  {item.name}
                </p>
                {item.selectedModifiers.length > 0 && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {item.selectedModifiers.map((m) => m.optionName).join(", ")}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  ฿{(item.totalPrice / item.quantity).toFixed(0)} / ชิ้น
                </p>
              </div>
              {/* Qty controls */}
              <div className="flex items-center gap-1 mt-0.5">
                <button
                  type="button"
                  onClick={() => onUpdateQty(item.cartItemKey, item.quantity - 1)}
                  className="w-6 h-6 rounded border text-sm flex items-center justify-center hover:bg-muted transition-colors"
                  aria-label="ลดจำนวน"
                >
                  −
                </button>
                <span className="w-5 text-center text-sm tabular-nums">
                  {item.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => onUpdateQty(item.cartItemKey, item.quantity + 1)}
                  className="w-6 h-6 rounded border text-sm flex items-center justify-center hover:bg-muted transition-colors"
                  aria-label="เพิ่มจำนวน"
                >
                  +
                </button>
              </div>
              <p className="text-sm font-medium w-12 text-right text-sidebar tabular-nums mt-0.5">
                ฿{item.totalPrice.toFixed(0)}
              </p>
              <button
                type="button"
                onClick={() => onRemove(item.cartItemKey)}
                className="text-muted-foreground hover:text-destructive transition-colors text-xs w-4 mt-0.5"
                aria-label="ลบสินค้า"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-4 py-3 space-y-3 shrink-0">
        {/* Customer */}
        {customerId && linkedPhone ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-sidebar font-medium truncate">
              ลูกค้า: {linkedPhone}
            </span>
            <button
              type="button"
              onClick={handleClearCustomer}
              className="text-xs text-muted-foreground hover:text-destructive shrink-0 ml-2"
            >
              ล้าง
            </button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <Input
              type="tel"
              placeholder="เบอร์ลูกค้า (ไม่บังคับ)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLinkCustomer();
              }}
              className="h-7 text-xs"
            />
            <button
              type="button"
              onClick={handleLinkCustomer}
              disabled={!phone.trim() || searchPending}
              className="px-2.5 py-1 text-xs rounded-lg border border-border hover:bg-muted disabled:opacity-40 shrink-0 transition-colors"
            >
              {searchPending ? "…" : "บันทึก"}
            </button>
          </div>
        )}
        {customerSearchError && (
          <p className="text-xs text-destructive">{customerSearchError}</p>
        )}

        {/* Order type */}
        <div className="flex gap-2">
          {(["dine_in", "take_away"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onOrderTypeChange(type)}
              className={orderTypeCls(orderType === type)}
            >
              {type === "dine_in" ? "ทานที่ร้าน" : "Take Away"}
            </button>
          ))}
        </div>

        {/* Table number */}
        {orderType === "dine_in" && (
          <Input
            type="text"
            placeholder="หมายเลขโต๊ะ (ไม่บังคับ)"
            value={tableNumber}
            onChange={(e) => onTableNumberChange(e.target.value)}
            className="h-7 text-xs"
          />
        )}

        {/* Discount */}
        {discountType === null ? (
          cartItems.length > 0 && (
            <button
              type="button"
              onClick={() => onDiscountTypeChange("percent")}
              className="text-xs text-accent font-medium hover:underline"
            >
              + เพิ่มส่วนลด
            </button>
          )
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">ส่วนลด</span>
              <button
                type="button"
                onClick={onCancelDiscount}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                ลบส่วนลด
              </button>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => onDiscountTypeChange("percent")}
                className={orderTypeCls(discountType === "percent")}
              >
                %
              </button>
              <button
                type="button"
                onClick={() => onDiscountTypeChange("amount")}
                className={orderTypeCls(discountType === "amount")}
              >
                ฿
              </button>
              <Input
                type="number"
                inputMode="decimal"
                min="0"
                value={discountValue}
                onChange={(e) => onDiscountValueChange(e.target.value)}
                placeholder={discountType === "percent" ? "% ส่วนลด" : "บาท"}
                className="h-7 text-xs flex-1"
              />
            </div>
          </div>
        )}

        {/* Total */}
        <div className="space-y-1">
          {discountType !== null && discountAmount > 0 && (
            <>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>ยอดก่อนลด</span>
                <span className="tabular-nums">฿{subtotal.toFixed(0)}</span>
              </div>
              <div className="flex justify-between text-xs text-destructive">
                <span>ส่วนลด</span>
                <span className="tabular-nums">-฿{discountAmount.toFixed(0)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between font-semibold text-sidebar text-base">
            <span>รวม</span>
            <span className="tabular-nums">฿{total.toFixed(0)}</span>
          </div>
        </div>

        {/* Payment method */}
        <div className="flex gap-2">
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => onPaymentChange(method)}
              className={orderTypeCls(paymentMethod === method)}
            >
              {PAYMENT_LABELS[method]}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-sm text-destructive font-medium">{error}</p>
        )}

        <Button
          type="button"
          onClick={onCheckout}
          disabled={
            cartItems.length === 0 || pending || (requiresApproval && !hasApproverPin)
          }
          className="w-full bg-accent hover:bg-accent/90 text-white"
        >
          {pending ? "กำลังบันทึก…" : `ชำระ ฿${total.toFixed(0)}`}
        </Button>
      </div>

      {/* Discount approval modal */}
      {requiresApproval && !hasApproverPin && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4">
            <h2 className="text-lg font-bold text-sidebar text-center">
              ขออนุมัติส่วนลด
            </h2>
            <p className="text-sm text-muted-foreground text-center">
              ส่วนลดนี้เกินเพดาน ต้องได้รับอนุมัติจาก Manager หรือ Owner
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="discount-reason">เหตุผลที่ให้ส่วนลด</Label>
              <textarea
                id="discount-reason"
                value={discountReason}
                onChange={(e) => onDiscountReasonChange(e.target.value)}
                required
                rows={2}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
                placeholder="เช่น ลูกค้าประจำ, โปรโมชั่นพิเศษ"
              />
            </div>

            <div className="space-y-1.5">
              <Label>PIN ของ Manager/Owner เพื่ออนุมัติ</Label>
              <PinPad
                disabled={discountReason.trim() === ""}
                onComplete={onApproverPinComplete}
              />
              {discountReason.trim() === "" && (
                <p className="text-xs text-muted-foreground text-center">
                  กรอกเหตุผลก่อนกดตัวเลข
                </p>
              )}
            </div>

            {error && (
              <p className="text-sm text-destructive font-medium text-center">
                {error}
              </p>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={onCancelDiscount}
              className="w-full"
            >
              ยกเลิกส่วนลด
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Wire discount state into `src/components/pos/pos-screen.tsx`**

Replace the entire file with:

```tsx
"use client";
import { useState, useTransition, useMemo } from "react";
import { createOrder } from "@/app/actions/orders";
import { computeDiscount, type DiscountType } from "@/lib/discount";
import type {
  CartItem,
  ModifierWithOptions,
  PosCategory,
  PosProduct,
} from "@/types/app";
import { PosHeader } from "./pos-header";
import { ProductGrid } from "./product-grid";
import { ModifierModal } from "./modifier-modal";
import { SmartCart } from "./smart-cart";
import { QrPaymentModal } from "./qr-payment-modal";

const MAX_DISCOUNT_PIN_ATTEMPTS = 5;

type Props = {
  products: PosProduct[];
  categories: PosCategory[];
  productModifierRecord: Record<string, string[]>;
  allModifiers: ModifierWithOptions[];
  userName: string;
  todayOrderCount: number;
  activeShiftId: string | null;
};

export function PosScreen({
  products,
  categories,
  productModifierRecord,
  allModifiers,
  userName,
  todayOrderCount,
  activeShiftId,
}: Props) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [pendingProduct, setPendingProduct] = useState<PosProduct | null>(null);
  const [orderType, setOrderType] = useState<"dine_in" | "take_away">("dine_in");
  const [tableNumber, setTableNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer" | "card">("cash");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [discountType, setDiscountType] = useState<DiscountType | null>(null);
  const [discountValue, setDiscountValue] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [approverPin, setApproverPin] = useState<string | null>(null);
  const [pinAttempts, setPinAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastOrderNumber, setLastOrderNumber] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showMobileCart, setShowMobileCart] = useState(false);
  const [checkoutPending, startCheckout] = useTransition();

  const productsWithModifiers = useMemo(
    () => new Set(Object.keys(productModifierRecord)),
    [productModifierRecord]
  );

  const productModifierMap = useMemo(
    () => new Map(Object.entries(productModifierRecord)),
    [productModifierRecord]
  );

  const subtotal = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const parsedDiscountValue = Number(discountValue);
  const { discountAmount, requiresApproval, total } = computeDiscount(
    subtotal,
    discountType,
    Number.isFinite(parsedDiscountValue) ? parsedDiscountValue : 0
  );

  function resetDiscount() {
    setDiscountType(null);
    setDiscountValue("");
    setDiscountReason("");
    setApproverPin(null);
    setPinAttempts(0);
  }

  function handleProductClick(product: PosProduct) {
    if (productsWithModifiers.has(product.id)) {
      setPendingProduct(product);
    } else {
      addDirectToCart(product);
    }
  }

  function addDirectToCart(product: PosProduct) {
    setCartItems((prev) => {
      const existing = prev.find((i) => i.cartItemKey === product.id);
      if (existing) {
        return prev.map((i) => {
          if (i.cartItemKey !== product.id) return i;
          const unitPrice =
            i.basePrice +
            i.selectedModifiers.reduce((s, m) => s + m.priceDelta, 0);
          return {
            ...i,
            quantity: i.quantity + 1,
            totalPrice: unitPrice * (i.quantity + 1),
          };
        });
      }
      return [
        ...prev,
        {
          cartItemKey: product.id,
          productId: product.id,
          name: product.name,
          basePrice: product.price,
          quantity: 1,
          selectedModifiers: [],
          totalPrice: product.price,
        },
      ];
    });
  }

  function handleAddFromModal(item: CartItem) {
    setCartItems((prev) => [...prev, item]);
    setPendingProduct(null);
  }

  function updateQty(key: string, qty: number) {
    if (qty <= 0) {
      setCartItems((prev) => prev.filter((i) => i.cartItemKey !== key));
    } else {
      setCartItems((prev) =>
        prev.map((i) => {
          if (i.cartItemKey !== key) return i;
          const unitPrice =
            i.basePrice +
            i.selectedModifiers.reduce((s, m) => s + m.priceDelta, 0);
          return { ...i, quantity: qty, totalPrice: unitPrice * qty };
        })
      );
    }
  }

  function removeItem(key: string) {
    setCartItems((prev) => prev.filter((i) => i.cartItemKey !== key));
  }

  function clearCart() {
    setCartItems([]);
    setError(null);
    setLastOrderNumber(null);
    setCustomerId(null);
    setTableNumber("");
    resetDiscount();
  }

  function submitOrder(onSettled?: () => void) {
    setError(null);
    setLastOrderNumber(null);
    startCheckout(async () => {
      const result = await createOrder({
        items: cartItems,
        paymentMethod,
        orderType,
        tableNumber: tableNumber.trim() !== "" ? tableNumber.trim() : undefined,
        customerId: customerId ?? undefined,
        discountType: discountType ?? undefined,
        discountValue: discountType !== null ? parsedDiscountValue : undefined,
        discountReason: discountReason.trim() !== "" ? discountReason.trim() : undefined,
        approverPin: approverPin ?? undefined,
      });
      if ("error" in result) {
        setError(result.error);
        if (result.error === "PIN ไม่ถูกต้อง" && requiresApproval) {
          const next = pinAttempts + 1;
          if (next >= MAX_DISCOUNT_PIN_ATTEMPTS) {
            resetDiscount();
          } else {
            setApproverPin(null);
            setPinAttempts(next);
          }
        }
      } else {
        setLastOrderNumber(result.orderNumber);
        setCartItems([]);
        setTableNumber("");
        setCustomerId(null);
        resetDiscount();
      }
      onSettled?.();
    });
  }

  function handleCheckout() {
    if (requiresApproval && approverPin === null) return;
    if (paymentMethod === "transfer") {
      setError(null);
      setShowMobileCart(false);
      setShowQrModal(true);
      return;
    }
    submitOrder();
  }

  function handleQrConfirm() {
    submitOrder(() => setShowQrModal(false));
  }

  const pendingProductModifiers: ModifierWithOptions[] = pendingProduct
    ? (productModifierMap.get(pendingProduct.id) ?? [])
        .map((modId) => allModifiers.find((m) => m.id === modId))
        .filter((m): m is ModifierWithOptions => m !== undefined)
    : [];

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <PosHeader
        userName={userName}
        todayOrderCount={todayOrderCount}
        hasActiveShift={activeShiftId !== null}
      />
      <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0 mt-2">
        <div className="flex-1 min-w-0 pb-20 md:pb-0">
          <ProductGrid
            products={products}
            categories={categories}
            productsWithModifiers={productsWithModifiers}
            onProductClick={handleProductClick}
          />
        </div>
        <div className="hidden md:block md:w-72 md:shrink-0">
          <SmartCart
            cartItems={cartItems}
            onUpdateQty={updateQty}
            onRemove={removeItem}
            onClear={clearCart}
            orderType={orderType}
            onOrderTypeChange={setOrderType}
            tableNumber={tableNumber}
            onTableNumberChange={setTableNumber}
            paymentMethod={paymentMethod}
            onPaymentChange={setPaymentMethod}
            customerId={customerId}
            onCustomerIdChange={setCustomerId}
            discountType={discountType}
            onDiscountTypeChange={setDiscountType}
            discountValue={discountValue}
            onDiscountValueChange={setDiscountValue}
            discountReason={discountReason}
            onDiscountReasonChange={setDiscountReason}
            subtotal={subtotal}
            discountAmount={discountAmount}
            requiresApproval={requiresApproval}
            total={total}
            hasApproverPin={approverPin !== null}
            onApproverPinComplete={setApproverPin}
            onCancelDiscount={resetDiscount}
            pending={checkoutPending}
            error={error}
            lastOrderNumber={lastOrderNumber}
            onCheckout={handleCheckout}
          />
        </div>
      </div>

      {/* Mobile sticky cart summary bar */}
      <button
        type="button"
        onClick={() => setShowMobileCart(true)}
        className="md:hidden fixed left-0 right-0 bottom-16 z-40 bg-sidebar text-white px-4 py-3 flex items-center justify-between shadow-lg"
      >
        <span className="text-sm">
          <span className="font-semibold tabular-nums">{itemCount}</span> ชิ้น ·{" "}
          <span className="font-bold tabular-nums">฿{total.toFixed(0)}</span>
        </span>
        <span className="text-sm font-semibold text-accent">ดูตะกร้า</span>
      </button>

      {/* Mobile cart bottom sheet */}
      {showMobileCart && (
        <div
          className="md:hidden fixed inset-0 z-[60] bg-black/50 flex items-end"
          onClick={() => setShowMobileCart(false)}
        >
          <div
            className="w-full max-h-[85vh] bg-white rounded-t-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <SmartCart
                cartItems={cartItems}
                onUpdateQty={updateQty}
                onRemove={removeItem}
                onClear={clearCart}
                orderType={orderType}
                onOrderTypeChange={setOrderType}
                tableNumber={tableNumber}
                onTableNumberChange={setTableNumber}
                paymentMethod={paymentMethod}
                onPaymentChange={setPaymentMethod}
                customerId={customerId}
                onCustomerIdChange={setCustomerId}
                discountType={discountType}
                onDiscountTypeChange={setDiscountType}
                discountValue={discountValue}
                onDiscountValueChange={setDiscountValue}
                discountReason={discountReason}
                onDiscountReasonChange={setDiscountReason}
                subtotal={subtotal}
                discountAmount={discountAmount}
                requiresApproval={requiresApproval}
                total={total}
                hasApproverPin={approverPin !== null}
                onApproverPinComplete={setApproverPin}
                onCancelDiscount={resetDiscount}
                pending={checkoutPending}
                error={error}
                lastOrderNumber={lastOrderNumber}
                onCheckout={handleCheckout}
              />
            </div>
          </div>
        </div>
      )}
      {pendingProduct !== null && (
        <ModifierModal
          product={pendingProduct}
          modifiers={pendingProductModifiers}
          onAddToCart={handleAddFromModal}
          onClose={() => setPendingProduct(null)}
        />
      )}
      {showQrModal && (
        <QrPaymentModal
          total={total}
          onConfirm={handleQrConfirm}
          onCancel={() => setShowQrModal(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 9: Show discount info on `src/app/(shell)/orders/[id]/page.tsx`**

Replace the `OrderDetail` type with:

```ts
type OrderDetail = {
  id: string;
  order_number: string | null;
  payment_method: string;
  status: string;
  subtotal: number;
  discount_type: string | null;
  discount_value: number | null;
  discount_amount: number;
  discount_reason: string | null;
  total: number;
  note: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  order_items: OrderItem[];
};
```

Update the `.select(...)` call to:

```ts
  const { data: order } = (await supabase
    .from("orders")
    .select(
      "id, order_number, payment_method, status, subtotal, discount_type, discount_value, discount_amount, discount_reason, total, note, cancelled_at, cancel_reason, created_at, order_items(id, product_name, unit_price, quantity, subtotal)"
    )
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .single()) as { data: OrderDetail | null };
```

In the order-summary block, insert this right after the `{order.note !== null && (...)}` block and
before the `{order.status === "cancelled" && order.cancel_reason !== null && (...)}` block:

```tsx
        {order.discount_type !== null && (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">ยอดก่อนลด</span>
              <span className="font-medium text-sidebar tabular-nums">
                ฿{Number(order.subtotal).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                ส่วนลด
                {order.discount_type === "percent"
                  ? ` (${Number(order.discount_value)}%)`
                  : ""}
              </span>
              <span className="font-medium text-destructive tabular-nums">
                -฿{Number(order.discount_amount).toFixed(2)}
              </span>
            </div>
            {order.discount_reason !== null && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">เหตุผลส่วนลด</span>
                <span className="font-medium text-sidebar text-right max-w-[60%]">
                  {order.discount_reason}
                </span>
              </div>
            )}
          </>
        )}
```

Leave everything else in the file (the `VoidOrderButton` wiring, the cancelled block, the final
total row) unchanged.

- [ ] **Step 10: Type-check, lint, build**

Run:
```bash
npx tsc --noEmit
npm run lint
npm run build
```
Expected: all three clean (0 errors). Fix any mismatch between the regenerated
`src/types/database.ts` and the code above before proceeding — do not silence type errors with
`as any`.

- [ ] **Step 11: Manual live-browser verification**

Using disposable QA data (a test tenant/owner/manager/staff, deleted immediately after — this
project's established practice all session), verify on localhost via the Browser pane at tablet
size, per [[feedback_live_preview_ipad_standard]]:

1. Add items to the cart, tap "+ เพิ่มส่วนลด", enter 10% → total updates live, no PIN prompt
   appears, checkout succeeds. Order detail page shows "ยอดก่อนลด" / "ส่วนลด (10%)" / total
   correctly. Confirm in the DB that `discount_approved_by` is null.
2. Start a new cart, enter 30% → the approval modal opens immediately (before tapping "ชำระ"). The
   PinPad is disabled until a reason is typed. Enter a Staff member's own PIN → rejected with
   "PIN ไม่ถูกต้อง" (staff excluded from the approver set). Enter the test Manager's correct PIN →
   modal closes, "ชำระ" becomes enabled, checkout succeeds. Confirm in the DB that
   `discount_approved_by` points to the Manager's profile and `discount_reason` was recorded.
3. Start a new cart, enter a fixed ฿150 discount on a cart with a subtotal under ฿750 (so ฿150 is
   under 20% but over the ฿100 leg) → confirm the approval modal still triggers.
4. Attempt a ฿ discount larger than the cart subtotal → rejected before the approval modal can even
   be reached (client-side), and separately confirm server-side rejection by calling `createOrder`
   with a forged larger `discountValue` than `subtotal` bypasses the client check (simulate via
   direct fetch to the server action, or verify by reading the validation code path — either is
   acceptable evidence for this one).
5. Enter 5 wrong PINs across separate checkout attempts on one pending discount → discount clears
   back to no-discount state, "+ เพิ่มส่วนลด" reappears.
6. Direct Data-API `POST /rest/v1/orders` with a fabricated `discount_approved_by` (real anon key +
   real authenticated session, no admin shortcut) → rejected by
   `prevent_direct_discount_approval`, same exploit-proof methodology used for Void Order's
   `prevent_direct_order_void`.
7. Reload `/orders` and the Dashboard → confirm today's-sales total reflects the **post-discount**
   `total` for the discounted orders created above (proves `total`'s meaning is genuinely
   unchanged and every existing report query keeps working with real discounted data).
8. Delete all disposable QA data (profiles, orders, order_items, inventory_transactions rows,
   tenants, auth identities/sessions/users) created for this test, confirming 0 rows remain.

- [ ] **Step 12: Commit**

```bash
git add supabase/migrations/20260814130000_order_discount.sql src/types/database.ts src/lib/discount.ts src/types/app.ts src/app/actions/orders.ts src/components/pos/smart-cart.tsx src/components/pos/pos-screen.tsx "src/app/(shell)/orders/[id]/page.tsx"
git commit -m "feat(pos): whole-bill discount with Manager/Owner PIN approval above threshold"
```
