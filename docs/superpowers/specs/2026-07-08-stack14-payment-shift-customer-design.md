# Stack 14 — QR Payment, Shift Close & Customer History Design Spec

> **For agentic workers:** Use `superpowers:writing-plans` then `superpowers:subagent-driven-development` (or `executing-plans`) to implement.

**Goal:** Replace the deferred Print Receipt feature with a QR PromptPay payment flow (manual staff confirmation, no payment gateway), add cash-drawer Shift Close with reconciliation, and add a Customer List/History page. Loyalty/points and cross-branch CRM are explicitly out of scope — deferred to a future Stack 15.

**Architecture:** Three independent features sharing one migration pass. QR Payment gates order creation behind a confirmation modal (order is only written to the DB after staff taps "ยืนยันชำระเงินแล้ว" — consistent with how cash/card already work, since staff only creates the order once payment is certain). Shift Close introduces a new `shifts` table and a best-effort `shift_id` link on `orders`, following the existing "best-effort stock deduction" pattern — a shift is not required to sell. Customer History adds read-only aggregation on top of existing `customers`/`orders` tables — no schema change needed for it.

**Tech Stack:** Next.js 16 App Router, Supabase SSR, TypeScript 5 strict + noUncheckedIndexedAccess, new deps: `promptpay-qr` (EMV QR payload generation) + `qrcode` (render payload as image)

## Global Constraints

- Multi-tenant: every table has `tenant_id` with RLS. Every query scoped to `profile.tenant_id`, not relying on RLS alone (defense in depth, matches existing pattern in `dal.ts`/actions).
- Auth: `getProfile()` (not `getSession()`) in all Server Components/Actions.
- No `.env.local` or Supabase keys committed.
- TypeScript strict + `noUncheckedIndexedAccess` must stay clean (`npx tsc --noEmit` = zero errors).
- No `next/image` — use `<img>`.
- `Button` uses `@base-ui/react` — no `asChild` — use `<Link>` + Tailwind for navigation.
- Bangkok = UTC+7 where dates matter: `offsetMs = 7 * 60 * 60 * 1000`.
- `searchParams`/`params` in Next.js 16 are `Promise<T>` — must `await`.
- Roles are `"owner" | "manager" | "staff"` (free-form `text` column, no DB enum). Existing pattern: `profile.role === "owner" || profile.role === "manager"` for manage-level pages; `profile.role !== "owner"` guard for Settings-only pages.

---

## Section 1 — Database Schema Changes

### Alter `tenants` — add PromptPay ID

```sql
ALTER TABLE tenants ADD COLUMN promptpay_id text;
```
- Nullable. Holds a Thai mobile number (10 digits) or national ID / tax ID (13 digits), stored as digits-only string. Validated at the settings form layer, not the DB layer.

### New table `shifts`

```sql
CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  opened_by uuid NOT NULL REFERENCES profiles(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_cash numeric(10,2) NOT NULL DEFAULT 0,
  closed_by uuid REFERENCES profiles(id),
  closed_at timestamptz,
  closing_cash_counted numeric(10,2),
  expected_cash numeric(10,2),
  variance numeric(10,2),
  status text NOT NULL DEFAULT 'open',  -- 'open' | 'closed'
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON shifts
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
```

- Exactly one `status = 'open'` shift per `tenant_id` at a time. Enforced at the application layer in `openShift` (check-then-insert), not a DB constraint — matches this codebase's existing preference for app-layer invariants over exotic DB constraints.
- `expected_cash` and `variance` are computed and persisted at close time (not recomputed on every read) so historical shift reports stay stable and cheap to list.

### Alter `orders` — add shift link

```sql
ALTER TABLE orders ADD COLUMN shift_id uuid REFERENCES shifts(id);
```
- Nullable. Set best-effort at order creation time: if an open shift exists for the tenant, attach it; if not, leave null and proceed with the sale anyway (no blocking behavior — mirrors the existing best-effort stock deduction philosophy).

### Regenerate TypeScript types

After migrations, regenerate `src/types/database.ts` (same process as Stack 9 Task 6).

---

## Section 2 — QR Payment Flow

### New DAL function (`src/lib/dal.ts`)

```ts
export async function getTenantPromptPayId(tenantId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenants")
    .select("promptpay_id")
    .eq("id", tenantId)
    .single();
  return (data as { promptpay_id: string | null } | null)?.promptpay_id ?? null;
}
```

### New server action (`src/app/actions/payment.ts`)

```ts
"use server";
import { getProfile, getTenantPromptPayId } from "@/lib/dal";
import generatePayload from "promptpay-qr";

export async function generatePaymentQr(
  total: number
): Promise<{ qrPayload: string } | { error: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };

  const promptpayId = await getTenantPromptPayId(profile.tenant_id);
  if (!promptpayId) {
    return { error: "ร้านยังไม่ได้ตั้งค่า PromptPay ID กรุณาไปที่หน้าตั้งค่า" };
  }

  const qrPayload = generatePayload(promptpayId, { amount: total });
  return { qrPayload };
}
```

### New client component (`src/components/pos/qr-payment-modal.tsx`)

- `"use client"`. Props: `{ total: number; onConfirm: () => void; onCancel: () => void }`.
- On mount, calls `generatePaymentQr(total)` via `useTransition`; renders a loading state while pending.
- On success, renders the QR by passing the payload string through `qrcode`'s `toDataURL` and displaying it in a plain `<img>`.
- On error (e.g. no PromptPay ID configured), shows the error message with a "ปิด" button — no confirm button available.
- Two actions: "ยืนยันชำระเงินแล้ว" (calls `onConfirm`) and "ยกเลิก" (calls `onCancel`) — modal itself never calls `createOrder`; that stays the caller's responsibility.

### Checkout flow change (`src/components/pos/pos-screen.tsx`, `smart-cart.tsx`)

- Current behavior: clicking "ชำระ" always calls `createOrder` immediately regardless of `paymentMethod`.
- New behavior:
  - `paymentMethod === "cash" | "card"` → unchanged, calls `createOrder` immediately.
  - `paymentMethod === "transfer"` → clicking "ชำระ" opens `QrPaymentModal` instead. `createOrder` is only invoked from the modal's `onConfirm` callback. `onCancel` closes the modal with no side effects (cart state untouched, staff can retry or switch payment method).

---

## Section 3 — Shift Close Flow

### New types (`src/lib/dal.ts`)

```ts
export type Shift = {
  id: string;
  openedAt: string;
  openingCash: number;
  status: "open" | "closed";
};

export type ShiftSummary = {
  totalCash: number;
  totalTransfer: number;
  totalCard: number;
  orderCount: number;
  expectedCash: number; // openingCash + totalCash
};
```

### New DAL functions

```ts
export async function getActiveShift(tenantId: string): Promise<Shift | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shifts")
    .select("id, opened_at, opening_cash, status")
    .eq("tenant_id", tenantId)
    .eq("status", "open")
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    openedAt: data.opened_at,
    openingCash: Number(data.opening_cash),
    status: "open",
  };
}

export async function getShiftSummary(
  tenantId: string,
  shiftId: string
): Promise<ShiftSummary> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("total, payment_method")
    .eq("tenant_id", tenantId)
    .eq("shift_id", shiftId)
    .neq("status", "cancelled");

  const rows = (data ?? []) as { total: number; payment_method: string }[];
  const totalCash = rows.filter((r) => r.payment_method === "cash").reduce((s, r) => s + Number(r.total), 0);
  const totalTransfer = rows.filter((r) => r.payment_method === "transfer").reduce((s, r) => s + Number(r.total), 0);
  const totalCard = rows.filter((r) => r.payment_method === "card").reduce((s, r) => s + Number(r.total), 0);

  const { data: shiftRow } = await supabase
    .from("shifts")
    .select("opening_cash")
    .eq("id", shiftId)
    .eq("tenant_id", tenantId)
    .single();
  const openingCash = Number((shiftRow as { opening_cash: number } | null)?.opening_cash ?? 0);

  return {
    totalCash,
    totalTransfer,
    totalCard,
    orderCount: rows.length,
    expectedCash: openingCash + totalCash,
  };
}
```

### New server actions (`src/app/actions/shifts.ts`)

```ts
"use server";

export async function openShift(
  openingCash: number
): Promise<{ shiftId: string } | { error: string }>
// 1. getProfile() guard
// 2. Check no existing open shift for tenant (getActiveShift) — if found, return error "มีกะที่เปิดอยู่แล้ว"
// 3. Insert shifts row (tenant_id, opened_by: profile.id, opening_cash)
// 4. revalidatePath("/shifts")

export async function closeShift(
  shiftId: string,
  closingCashCounted: number
): Promise<{ variance: number } | { error: string }>
// 1. getProfile() guard
// 2. getShiftSummary(profile.tenant_id, shiftId) to compute expectedCash
// 3. variance = closingCashCounted - expectedCash
// 4. Update shifts row: closed_by, closed_at, closing_cash_counted, expected_cash, variance, status = 'closed'
//    scoped with .eq("id", shiftId).eq("tenant_id", profile.tenant_id)
// 5. revalidatePath("/shifts")
```

### Order creation change (`src/app/actions/orders.ts`)

- Before inserting the order row, call `getActiveShift(profile.tenant_id)`. If found, set `shift_id` on the insert payload; if null, omit it (stays `null`). No error path — a closed/missing shift never blocks a sale.

### New page (`src/app/(shell)/shifts/page.tsx`)

- Accessible to all roles (`owner`/`manager`/`staff`) — this is a till-side task every cashier performs.
- No active shift → form: "เงินสดตั้งต้น" input + "เปิดกะ" button.
- Active shift → live summary (cash/transfer/card totals, order count, expected cash) + "เงินสดที่นับได้จริง" input + "ปิดกะ" button. After closing, show the variance result (over/short/exact).

### POS integration

- `PosHeader` gets a small shift-status indicator ("กะเปิดอยู่" / "ยังไม่เปิดกะ"), linking to `/shifts`. Read-only display — no shift actions inside the POS screen itself.

---

## Section 4 — Customer History

### New types (`src/lib/dal.ts`)

```ts
export type CustomerListItem = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  orderCount: number;
  totalSpent: number;
  lastOrderAt: string | null;
};

export type CustomerOrderHistoryItem = {
  id: string;
  orderNumber: string | null;
  createdAt: string;
  total: number;
  paymentMethod: string;
  status: string;
};
```

### New DAL functions

```ts
export async function getCustomers(tenantId: string): Promise<CustomerListItem[]>
// Fetch customers scoped by tenant_id, left-join/aggregate orders (count, sum(total), max(created_at))
// grouped client-side in JS after two scoped queries (customers + orders), consistent with
// how existing DAL functions avoid complex SQL joins in favor of two simple queries + Map aggregation
// (see getSalesByDay/getSalesByCategory pattern). Sorted by totalSpent descending.

export async function getCustomerOrders(
  tenantId: string,
  customerId: string
): Promise<CustomerOrderHistoryItem[]>
// orders where tenant_id = tenantId AND customer_id = customerId, ordered by created_at desc
```

### New pages

- `src/app/(shell)/customers/page.tsx` — table: name, phone, order count, total spent, last order date. Sorted by total spent descending. Row click → `/customers/[id]`.
- `src/app/(shell)/customers/[id]/page.tsx` — customer info header + order history table (order number, date, total, payment method, status), each row linking to the existing `/orders/[id]` detail page.
- Access: `owner`/`manager` only, matching the `/products`, `/categories` pattern (`profile.role === "owner" || profile.role === "manager"`, else `redirect("/")`).
- Nav: add a "ลูกค้า" entry to the desktop sidebar (mobile bottom nav stays at 4 items per Stack 13 — no bottom-nav change in this stack).

### Explicitly out of scope

- No loyalty points, no cross-branch/cross-tenant data sharing. `customers` remains scoped strictly to a single `tenant_id`, matching the codebase's current per-tenant isolation model. A multi-branch loyalty system is a distinct architectural project (new "organization" entity above tenants, cross-tenant RLS carve-outs) and is deferred to a future Stack 15 with its own design.

---

## Section 5 — File Structure

```
src/
  app/
    (shell)/
      shifts/
        page.tsx                    [CREATE]
      customers/
        page.tsx                    [CREATE]
        [id]/
          page.tsx                  [CREATE]
      settings/
        page.tsx                    [MODIFY — add PromptPay ID field]
    actions/
      payment.ts                    [CREATE]
      shifts.ts                     [CREATE]
      orders.ts                     [MODIFY — attach shift_id best-effort]
      settings.ts                   [MODIFY — save promptpay_id]
  components/
    pos/
      qr-payment-modal.tsx          [CREATE]
      pos-screen.tsx                [MODIFY — branch checkout on paymentMethod]
      smart-cart.tsx                [MODIFY — pass through modal state if needed]
      pos-header.tsx                [MODIFY — shift status indicator]
    settings/
      (PromptPay ID field added to existing settings form)
  lib/
    dal.ts                          [MODIFY — new types + functions for shifts, customers, promptpay]
  types/
    database.ts                     [REGENERATE after migrations]
```

---

## Testing & Verification

- No test framework is configured for this project (consistent with all prior stacks) — verification is `npx tsc --noEmit` (zero errors) plus manual walkthrough of each flow (open shift → sell via transfer → confirm QR → close shift → check variance; add customer via POS → view in `/customers` → drill into history).
- New Supabase migrations must be applied via the project's existing migration process before implementation (same as Stack 9).
