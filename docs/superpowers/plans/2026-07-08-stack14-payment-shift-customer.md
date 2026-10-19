# Stack 14: QR Payment, Shift Close & Customer History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a QR PromptPay payment flow with manual staff confirmation, a cash-drawer Shift Close feature with reconciliation, and a Customer List/History page — per `docs/superpowers/specs/2026-07-08-stack14-payment-shift-customer-design.md`.

**Architecture:** Task 1 runs all schema changes via Supabase MCP (`execute_sql`) and regenerates types. Task 2 adds the read-side DAL functions all three features depend on. Tasks 3–5 build the three features independently on top of Task 2 — QR Payment (checkout gating + PromptPay settings), Shift Close (open/close actions + till page + POS header indicator), Customer History (list + detail pages). Task 4 makes a small follow-up edit to a file Task 3 creates, so Task 3 must land before Task 4.

**Tech Stack:** Next.js 16 App Router, Supabase SSR, TypeScript 5 strict + noUncheckedIndexedAccess, new deps: `promptpay-qr` (ships its own `.d.ts`), `qrcode` + `@types/qrcode`

## Global Constraints

- Multi-tenant: every table has `tenant_id` with RLS. Every query scoped to `.eq("tenant_id", profile.tenant_id)` in code, not relying on RLS alone.
- Auth: `getProfile()` (not `getSession()`) in all Server Components/Actions.
- No `.env.local` or Supabase keys committed.
- `npx tsc --noEmit` must pass with zero errors before every commit.
- No `next/image` — use `<img>`.
- `Button` uses `@base-ui/react` — no `asChild` — use `<Link>` + Tailwind for navigation; plain `className` overrides on `Button` work via `cva`/`cn` (confirmed in `src/components/ui/button.tsx`).
- Bangkok = UTC+7 where dates matter: `offsetMs = 7 * 60 * 60 * 1000`.
- `searchParams`/`params` in Next.js 16 are `Promise<T>` — must `await`.
- Roles are `"owner" | "manager" | "staff"` (the `Role` type exported from `src/lib/dal.ts`). Manage-only pages use `if (profile.role !== "owner" && profile.role !== "manager") redirect("/");`; owner-only pages use `if (profile.role !== "owner") redirect("/");`.
- Numeric columns from Supabase must be wrapped in `Number(...)` before arithmetic (existing pattern throughout `dal.ts`).
- `noUncheckedIndexedAccess`: any array/tuple index access needs `?? fallback`.

## File Structure

```
supabase (via MCP, no files):
  tenants.promptpay_id, shifts table, orders.shift_id

src/
  lib/
    dal.ts                              [MODIFY — Task 2: PromptPay/Shift/Customer types + functions]
  app/
    actions/
      settings.ts                       [MODIFY — Task 3: updatePromptPayId]
      payment.ts                        [CREATE — Task 3: generatePaymentQr]
      shifts.ts                         [CREATE — Task 4: openShift, closeShift]
      orders.ts                         [MODIFY — Task 4: attach shift_id best-effort]
    (shell)/
      settings/
        page.tsx                        [MODIFY — Task 3: PromptPay field]
      pos/
        page.tsx                        [MODIFY — Task 4: pass activeShiftId]
      shifts/
        page.tsx                        [CREATE — Task 4]
      customers/
        page.tsx                        [CREATE — Task 5]
        [id]/
          page.tsx                      [CREATE — Task 5]
  components/
    settings/
      promptpay-form.tsx                [CREATE — Task 3]
    pos/
      qr-payment-modal.tsx              [CREATE — Task 3]
      pos-screen.tsx                    [MODIFY — Task 3: checkout gating; MODIFY again — Task 4: activeShiftId prop]
      pos-header.tsx                    [MODIFY — Task 4: shift indicator]
    shifts/
      shift-panel.tsx                   [CREATE — Task 4]
    shell/
      sidebar.tsx                       [MODIFY — Task 5: nav items for Shifts + Customers]
  types/
    database.ts                        [REGENERATE — Task 1]
```

---

### Task 1: Database Migrations

**Files:** No application code files — SQL only via Supabase MCP, then overwrite `src/types/database.ts`.

**Produces:**
- `tenants.promptpay_id text` (nullable)
- `shifts` table with RLS
- `orders.shift_id uuid` (nullable, FK → `shifts`)
- Regenerated `src/types/database.ts`

---

- [ ] **Step 1: Load MCP tools and get project ID**

```
ToolSearch query: "select:mcp__16e06c41-6788-424e-9c6c-24e26391a284__execute_sql,mcp__16e06c41-6788-424e-9c6c-24e26391a284__list_projects,mcp__16e06c41-6788-424e-9c6c-24e26391a284__generate_typescript_types"
```

Call `list_projects`, find the KIDKUBPOS project, note its `id` as `PROJECT_REF` — used in every `execute_sql` call below.

- [ ] **Step 2: Add `promptpay_id` to `tenants`**

Call `execute_sql` with `project_id = PROJECT_REF`:
```sql
ALTER TABLE tenants ADD COLUMN promptpay_id text;
```

- [ ] **Step 3: Create `shifts` table**

Call `execute_sql`:
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
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON shifts
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
```

- [ ] **Step 4: Add `shift_id` to `orders`**

Call `execute_sql`:
```sql
ALTER TABLE orders ADD COLUMN shift_id uuid REFERENCES shifts(id);
```

- [ ] **Step 5: Verify all changes**

Call `execute_sql`:
```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'tenants' AND column_name = 'promptpay_id')
    OR (table_name = 'orders' AND column_name = 'shift_id')
    OR (table_name = 'shifts')
  )
ORDER BY table_name, column_name;
```
Expected: 1 row for `tenants.promptpay_id`, 1 row for `orders.shift_id`, plus 11 rows for every `shifts` column (`id`, `tenant_id`, `opened_by`, `opened_at`, `opening_cash`, `closed_by`, `closed_at`, `closing_cash_counted`, `expected_cash`, `variance`, `status`, `created_at` — 12 rows for shifts).

Call `execute_sql`:
```sql
SELECT
  p.rowsecurity,
  (SELECT count(*) FROM pg_policies WHERE tablename = 'shifts') AS policy_count
FROM pg_tables p
WHERE p.schemaname = 'public' AND p.tablename = 'shifts';
```
Expected: 1 row with `rowsecurity = true`, `policy_count = 1`.

- [ ] **Step 6: Regenerate TypeScript types**

Call `generate_typescript_types` with `project_id = PROJECT_REF`. Copy the full returned content and overwrite `src/types/database.ts` with it.

Verify the new file contains:
- `shifts:` table definition with all 12 columns
- `tenants` Row includes `promptpay_id: string | null`
- `orders` Row includes `shift_id: string | null`

- [ ] **Step 7: TypeScript check**

```powershell
npx tsc --noEmit 2>&1
```
Expected: no output (zero errors).

- [ ] **Step 8: Commit**

```powershell
git add src/types/database.ts
git commit -m "db: add promptpay_id, shifts table, and orders.shift_id"
```

- [ ] **Step 9: Push to GitHub**

```powershell
git push origin main
```

**Rollback SQL (if needed):**
```sql
ALTER TABLE orders DROP COLUMN IF EXISTS shift_id;
DROP TABLE IF EXISTS shifts CASCADE;
ALTER TABLE tenants DROP COLUMN IF EXISTS promptpay_id;
```

---

### Task 2: DAL Extensions

**Files:**
- Modify: `src/lib/dal.ts` (append new types + functions at end of file)

**Interfaces:**
- Consumes: `createClient` (already imported at top of `dal.ts`)
- Produces:
  ```ts
  export async function getTenantPromptPayId(tenantId: string): Promise<string | null>

  export type Shift = { id: string; openedAt: string; openingCash: number; status: "open" | "closed" };
  export type ShiftSummary = { totalCash: number; totalTransfer: number; totalCard: number; orderCount: number; expectedCash: number };
  export async function getActiveShift(tenantId: string): Promise<Shift | null>
  export async function getShiftSummary(tenantId: string, shiftId: string): Promise<ShiftSummary>

  export type CustomerListItem = { id: string; name: string; phone: string | null; email: string | null; orderCount: number; totalSpent: number; lastOrderAt: string | null };
  export type CustomerOrderHistoryItem = { id: string; orderNumber: string | null; createdAt: string; total: number; paymentMethod: string; status: string };
  export async function getCustomers(tenantId: string): Promise<CustomerListItem[]>
  export async function getCustomerById(tenantId: string, customerId: string): Promise<CustomerListItem | null>
  export async function getCustomerOrders(tenantId: string, customerId: string): Promise<CustomerOrderHistoryItem[]>
  ```

---

- [ ] **Step 1: Append PromptPay + Shift + Customer code to `src/lib/dal.ts`**

Read the end of `src/lib/dal.ts` (currently ends around line 630 with `getTenantDeliveryGp`), then append:

```ts
// ─── PromptPay ───────────────────────────────────────────────────────────────

export async function getTenantPromptPayId(tenantId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenants")
    .select("promptpay_id")
    .eq("id", tenantId)
    .single();
  const row = data as { promptpay_id: string | null } | null;
  return row?.promptpay_id ?? null;
}

// ─── Shifts ──────────────────────────────────────────────────────────────────

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
  expectedCash: number;
};

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
  const { data: orderRows } = await supabase
    .from("orders")
    .select("total, payment_method")
    .eq("tenant_id", tenantId)
    .eq("shift_id", shiftId)
    .neq("status", "cancelled");

  const rows = (orderRows ?? []) as { total: number; payment_method: string }[];
  const totalCash = rows
    .filter((r) => r.payment_method === "cash")
    .reduce((sum, r) => sum + Number(r.total), 0);
  const totalTransfer = rows
    .filter((r) => r.payment_method === "transfer")
    .reduce((sum, r) => sum + Number(r.total), 0);
  const totalCard = rows
    .filter((r) => r.payment_method === "card")
    .reduce((sum, r) => sum + Number(r.total), 0);

  const { data: shiftRow } = await supabase
    .from("shifts")
    .select("opening_cash")
    .eq("id", shiftId)
    .eq("tenant_id", tenantId)
    .single();
  const openingCash = Number(
    (shiftRow as { opening_cash: number } | null)?.opening_cash ?? 0
  );

  return {
    totalCash,
    totalTransfer,
    totalCard,
    orderCount: rows.length,
    expectedCash: openingCash + totalCash,
  };
}

// ─── Customer History ────────────────────────────────────────────────────────

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

export async function getCustomers(tenantId: string): Promise<CustomerListItem[]> {
  const supabase = await createClient();

  const { data: customerRows } = await supabase
    .from("customers")
    .select("id, name, phone, email")
    .eq("tenant_id", tenantId);

  const { data: orderRows } = await supabase
    .from("orders")
    .select("customer_id, total, created_at")
    .eq("tenant_id", tenantId)
    .not("customer_id", "is", null)
    .neq("status", "cancelled");

  type OrderAggRow = { customer_id: string | null; total: number; created_at: string };
  const byCustomer = new Map<string, { count: number; spent: number; last: string }>();
  for (const row of (orderRows ?? []) as OrderAggRow[]) {
    if (!row.customer_id) continue;
    const existing = byCustomer.get(row.customer_id);
    if (existing) {
      existing.count += 1;
      existing.spent += Number(row.total);
      if (row.created_at > existing.last) existing.last = row.created_at;
    } else {
      byCustomer.set(row.customer_id, {
        count: 1,
        spent: Number(row.total),
        last: row.created_at,
      });
    }
  }

  type CustomerRow = { id: string; name: string; phone: string | null; email: string | null };
  const result: CustomerListItem[] = ((customerRows ?? []) as CustomerRow[]).map((c) => {
    const agg = byCustomer.get(c.id);
    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      orderCount: agg?.count ?? 0,
      totalSpent: agg?.spent ?? 0,
      lastOrderAt: agg?.last ?? null,
    };
  });

  return result.sort((a, b) => b.totalSpent - a.totalSpent);
}

export async function getCustomerById(
  tenantId: string,
  customerId: string
): Promise<CustomerListItem | null> {
  const supabase = await createClient();

  const { data: customer } = await supabase
    .from("customers")
    .select("id, name, phone, email")
    .eq("tenant_id", tenantId)
    .eq("id", customerId)
    .single();
  if (!customer) return null;

  const { data: orderRows } = await supabase
    .from("orders")
    .select("total, created_at")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .neq("status", "cancelled");

  const rows = (orderRows ?? []) as { total: number; created_at: string }[];
  const totalSpent = rows.reduce((sum, r) => sum + Number(r.total), 0);
  let lastOrderAt: string | null = null;
  for (const row of rows) {
    if (lastOrderAt === null || row.created_at > lastOrderAt) {
      lastOrderAt = row.created_at;
    }
  }

  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    orderCount: rows.length,
    totalSpent,
    lastOrderAt,
  };
}

export async function getCustomerOrders(
  tenantId: string,
  customerId: string
): Promise<CustomerOrderHistoryItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("id, order_number, created_at, total, payment_method, status")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  type Row = {
    id: string;
    order_number: string | null;
    created_at: string;
    total: number;
    payment_method: string;
    status: string;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    orderNumber: r.order_number,
    createdAt: r.created_at,
    total: Number(r.total),
    paymentMethod: r.payment_method,
    status: r.status,
  }));
}
```

- [ ] **Step 2: TypeScript check**

```powershell
npx tsc --noEmit 2>&1
```
Expected: no output.

- [ ] **Step 3: Commit**

```powershell
git add src/lib/dal.ts
git commit -m "feat(dal): add PromptPay, Shift, and Customer History read functions"
```

---

### Task 3: QR Payment Flow

**Files:**
- Create: `src/app/actions/payment.ts`
- Create: `src/components/pos/qr-payment-modal.tsx`
- Create: `src/components/settings/promptpay-form.tsx`
- Modify: `src/app/actions/settings.ts` (add `updatePromptPayId`)
- Modify: `src/app/(shell)/settings/page.tsx` (add PromptPay field)
- Modify: `src/components/pos/pos-screen.tsx` (gate checkout on `paymentMethod === "transfer"`)

**Interfaces:**
- Consumes: `getTenantPromptPayId` (Task 2), `getProfile` (existing)
- Produces: `generatePaymentQr(total: number): Promise<{ qrPayload: string } | { error: string }>`, `export function QrPaymentModal({ total, onConfirm, onCancel }: { total: number; onConfirm: () => void; onCancel: () => void })`

---

- [ ] **Step 1: Install dependencies**

```powershell
npm install promptpay-qr qrcode
npm install -D @types/qrcode
```
Expected: `added N packages`, no errors. `promptpay-qr` ships its own `.d.ts` (no `@types/promptpay-qr` needed). `esModuleInterop` is already `true` in `tsconfig.json`.

- [ ] **Step 2: Create `src/app/actions/payment.ts`**

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

- [ ] **Step 3: Create `src/components/pos/qr-payment-modal.tsx`**

```tsx
"use client";
import { useEffect, useState, useTransition } from "react";
import QRCode from "qrcode";
import { generatePaymentQr } from "@/app/actions/payment";
import { Button } from "@/components/ui/button";

type Props = {
  total: number;
  onConfirm: () => void;
  onCancel: () => void;
};

export function QrPaymentModal({ total, onConfirm, onCancel }: Props) {
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await generatePaymentQr(total);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const dataUrl = await QRCode.toDataURL(result.qrPayload, {
        width: 280,
        margin: 1,
      });
      setQrImageUrl(dataUrl);
    });
  }, [total]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4">
        <h2 className="text-lg font-bold text-sidebar text-center">
          สแกนจ่ายด้วย PromptPay
        </h2>
        <p className="text-2xl font-bold text-center text-sidebar tabular-nums">
          ฿{total.toFixed(2)}
        </p>

        {isPending && (
          <p className="text-sm text-muted-foreground text-center py-8">
            กำลังสร้าง QR…
          </p>
        )}

        {error && (
          <div className="space-y-3">
            <p className="text-sm text-destructive text-center">{error}</p>
            <Button type="button" onClick={onCancel} className="w-full">
              ปิด
            </Button>
          </div>
        )}

        {qrImageUrl && !error && (
          <>
            <img
              src={qrImageUrl}
              alt="PromptPay QR"
              className="w-full max-w-[280px] mx-auto"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={onCancel}
                className="flex-1 bg-white border border-input text-sidebar hover:bg-muted"
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                onClick={onConfirm}
                className="flex-1 bg-accent hover:bg-accent/90 text-white"
              >
                ยืนยันชำระเงินแล้ว
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add `updatePromptPayId` to `src/app/actions/settings.ts`**

Read the file first (currently ends after `updateBusinessSettings`, around line 112), then append:

```ts

export async function updatePromptPayId(
  prevState: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const raw = formData.get("promptpay_id");
  if (typeof raw !== "string") {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }

  const digits = raw.replace(/[^0-9]/g, "");
  if (digits !== "" && digits.length !== 10 && digits.length !== 13 && digits.length !== 15) {
    return {
      error: "เลข PromptPay ต้องเป็นเบอร์โทร (10 หลัก) หรือเลขผู้เสียภาษี (13 หลัก)",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tenants")
    .update({ promptpay_id: digits === "" ? null : digits })
    .eq("id", profile.tenant_id);

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/settings");
  return { success: true };
}
```

- [ ] **Step 5: Create `src/components/settings/promptpay-form.tsx`**

```tsx
"use client";
import { useActionState } from "react";
import type { SettingsState } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  action: (prevState: SettingsState, formData: FormData) => Promise<SettingsState>;
  defaultValue: string;
};

export function PromptPayForm({ action, defaultValue }: Props) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="pp-id">เลข PromptPay</Label>
        <Input
          id="pp-id"
          name="promptpay_id"
          defaultValue={defaultValue}
          placeholder="0812345678"
          maxLength={15}
        />
        <p className="text-xs text-muted-foreground">
          เบอร์โทร (10 หลัก) หรือเลขผู้เสียภาษี (13 หลัก) — ใช้แสดง QR รับเงินตอนลูกค้าเลือกจ่ายแบบโอน
        </p>
      </div>

      {state?.error && (
        <p className="text-sm font-medium text-destructive">{state.error}</p>
      )}
      {state?.success && (
        <p className="text-sm font-medium text-green-600">บันทึกเรียบร้อย</p>
      )}

      <Button
        type="submit"
        disabled={pending}
        className="bg-accent hover:bg-accent/90 text-white"
      >
        {pending ? "กำลังบันทึก…" : "บันทึก"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 6: Modify `src/app/(shell)/settings/page.tsx`**

Change the import block from:
```tsx
import { updateStoreName, updateBusinessSettings } from "@/app/actions/settings";
import { StoreNameForm } from "@/components/settings/store-name-form";
import { BusinessSettingsForm } from "@/components/settings/business-settings-form";
```
to:
```tsx
import { updateStoreName, updateBusinessSettings, updatePromptPayId } from "@/app/actions/settings";
import { StoreNameForm } from "@/components/settings/store-name-form";
import { BusinessSettingsForm } from "@/components/settings/business-settings-form";
import { PromptPayForm } from "@/components/settings/promptpay-form";
```

Change the tenant select from:
```tsx
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, fixed_cost_monthly, delivery_gp_percent, order_prefix")
    .eq("id", profile.tenant_id)
    .single();
```
to:
```tsx
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, fixed_cost_monthly, delivery_gp_percent, order_prefix, promptpay_id")
    .eq("id", profile.tenant_id)
    .single();
```

Insert a new card between the "Business settings" block and the "Team" block:
```tsx
      {/* PromptPay */}
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-sidebar">รับเงินผ่าน QR PromptPay</h2>
        <PromptPayForm
          action={updatePromptPayId}
          defaultValue={tenant?.promptpay_id ?? ""}
        />
      </div>

      {/* Team */}
```
(the `{/* Team */}` line already exists — just insert the new block directly above it)

- [ ] **Step 7: Modify `src/components/pos/pos-screen.tsx` — gate checkout on payment method**

Read the current file, then replace it in full with:

```tsx
"use client";
import { useState, useTransition, useMemo } from "react";
import { createOrder } from "@/app/actions/orders";
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

type Props = {
  products: PosProduct[];
  categories: PosCategory[];
  productModifierRecord: Record<string, string[]>;
  allModifiers: ModifierWithOptions[];
  userName: string;
  todayOrderCount: number;
};

export function PosScreen({
  products,
  categories,
  productModifierRecord,
  allModifiers,
  userName,
  todayOrderCount,
}: Props) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [pendingProduct, setPendingProduct] = useState<PosProduct | null>(null);
  const [orderType, setOrderType] = useState<"dine_in" | "take_away">("dine_in");
  const [tableNumber, setTableNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer" | "card">("cash");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastOrderNumber, setLastOrderNumber] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [checkoutPending, startCheckout] = useTransition();

  const productsWithModifiers = useMemo(
    () => new Set(Object.keys(productModifierRecord)),
    [productModifierRecord]
  );

  const productModifierMap = useMemo(
    () => new Map(Object.entries(productModifierRecord)),
    [productModifierRecord]
  );

  const total = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);

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
  }

  function submitOrder() {
    setError(null);
    setLastOrderNumber(null);
    startCheckout(async () => {
      const result = await createOrder({
        items: cartItems,
        paymentMethod,
        orderType,
        tableNumber: tableNumber.trim() !== "" ? tableNumber.trim() : undefined,
        customerId: customerId ?? undefined,
      });
      if ("error" in result) {
        setError(result.error);
      } else {
        setLastOrderNumber(result.orderNumber);
        setCartItems([]);
        setTableNumber("");
        setCustomerId(null);
      }
    });
  }

  function handleCheckout() {
    if (paymentMethod === "transfer") {
      setError(null);
      setShowQrModal(true);
      return;
    }
    submitOrder();
  }

  function handleQrConfirm() {
    setShowQrModal(false);
    submitOrder();
  }

  const pendingProductModifiers: ModifierWithOptions[] = pendingProduct
    ? (productModifierMap.get(pendingProduct.id) ?? [])
        .map((modId) => allModifiers.find((m) => m.id === modId))
        .filter((m): m is ModifierWithOptions => m !== undefined)
    : [];

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <PosHeader userName={userName} todayOrderCount={todayOrderCount} />
      <div className="flex gap-4 flex-1 min-h-0 mt-2">
        <div className="flex-1 min-w-0">
          <ProductGrid
            products={products}
            categories={categories}
            productsWithModifiers={productsWithModifiers}
            onProductClick={handleProductClick}
          />
        </div>
        <div className="w-72 shrink-0">
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
            pending={checkoutPending}
            error={error}
            lastOrderNumber={lastOrderNumber}
            onCheckout={handleCheckout}
          />
        </div>
      </div>
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

Note: `smart-cart.tsx` needs no changes — `onCheckout` keeps the same `() => void` signature; the gating logic lives entirely in `handleCheckout` above.

- [ ] **Step 8: TypeScript check**

```powershell
npx tsc --noEmit 2>&1
```
Expected: no output.

- [ ] **Step 9: Commit**

```powershell
git add src/app/actions/payment.ts src/app/actions/settings.ts src/components/pos/qr-payment-modal.tsx src/components/settings/promptpay-form.tsx src/app/(shell)/settings/page.tsx src/components/pos/pos-screen.tsx package.json package-lock.json
git commit -m "feat(pos): add QR PromptPay payment flow with manual staff confirmation"
```

---

### Task 4: Shift Close Flow

**Files:**
- Create: `src/app/actions/shifts.ts`
- Create: `src/components/shifts/shift-panel.tsx`
- Create: `src/app/(shell)/shifts/page.tsx`
- Modify: `src/app/actions/orders.ts` (attach `shift_id` best-effort)
- Modify: `src/app/(shell)/pos/page.tsx` (fetch and pass `activeShiftId`)
- Modify: `src/components/pos/pos-screen.tsx` (accept `activeShiftId` prop — file already rewritten by Task 3)
- Modify: `src/components/pos/pos-header.tsx` (shift status indicator)

**Depends on:** Task 3 (this task's `pos-screen.tsx` edit applies on top of Task 3's rewrite)

**Interfaces:**
- Consumes: `getActiveShift`, `getShiftSummary`, `Shift`, `ShiftSummary` (Task 2)
- Produces:
  ```ts
  export async function openShift(openingCash: number): Promise<{ shiftId: string } | { error: string }>
  export async function closeShift(shiftId: string, closingCashCounted: number): Promise<{ variance: number } | { error: string }>
  ```

---

- [ ] **Step 1: Create `src/app/actions/shifts.ts`**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getActiveShift, getShiftSummary } from "@/lib/dal";

export async function openShift(
  openingCash: number
): Promise<{ shiftId: string } | { error: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (isNaN(openingCash) || openingCash < 0) {
    return { error: "กรุณากรอกเงินสดตั้งต้นที่ถูกต้อง (>= 0)" };
  }

  const existing = await getActiveShift(profile.tenant_id);
  if (existing) return { error: "มีกะที่เปิดอยู่แล้ว" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shifts")
    .insert({
      tenant_id: profile.tenant_id,
      opened_by: profile.id,
      opening_cash: openingCash,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "เปิดกะไม่สำเร็จ" };

  revalidatePath("/shifts");
  revalidatePath("/pos");
  return { shiftId: data.id };
}

export async function closeShift(
  shiftId: string,
  closingCashCounted: number
): Promise<{ variance: number } | { error: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };
  if (isNaN(closingCashCounted) || closingCashCounted < 0) {
    return { error: "กรุณากรอกเงินสดที่นับได้ที่ถูกต้อง (>= 0)" };
  }

  const summary = await getShiftSummary(profile.tenant_id, shiftId);
  const variance = closingCashCounted - summary.expectedCash;

  const supabase = await createClient();
  const { error } = await supabase
    .from("shifts")
    .update({
      closed_by: profile.id,
      closed_at: new Date().toISOString(),
      closing_cash_counted: closingCashCounted,
      expected_cash: summary.expectedCash,
      variance,
      status: "closed",
    })
    .eq("id", shiftId)
    .eq("tenant_id", profile.tenant_id);

  if (error) return { error: "ปิดกะไม่สำเร็จ" };

  revalidatePath("/shifts");
  revalidatePath("/pos");
  return { variance };
}
```

- [ ] **Step 2: Create `src/components/shifts/shift-panel.tsx`**

```tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { openShift, closeShift } from "@/app/actions/shifts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Shift, ShiftSummary } from "@/lib/dal";

type Props = {
  activeShift: Shift | null;
  summary: ShiftSummary | null;
};

export function ShiftPanel({ activeShift, summary }: Props) {
  const router = useRouter();
  const [openingCash, setOpeningCash] = useState("0");
  const [closingCash, setClosingCash] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ variance: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpen() {
    setError(null);
    startTransition(async () => {
      const res = await openShift(Number(openingCash));
      if ("error" in res) {
        setError(res.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleClose() {
    if (!activeShift) return;
    setError(null);
    startTransition(async () => {
      const res = await closeShift(activeShift.id, Number(closingCash));
      if ("error" in res) {
        setError(res.error);
      } else {
        setResult(res);
        router.refresh();
      }
    });
  }

  if (!activeShift) {
    return (
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-sidebar">เปิดกะใหม่</h2>
        {result && (
          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium text-sidebar">
              ปิดกะล่าสุด — ส่วนต่าง:{" "}
              <span
                className={
                  result.variance >= 0 ? "text-green-600" : "text-destructive"
                }
              >
                {result.variance > 0 ? "+" : ""}
                {result.variance.toFixed(2)} บาท
              </span>
            </p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="opening-cash">เงินสดตั้งต้น (บาท)</Label>
          <Input
            id="opening-cash"
            type="number"
            step="0.01"
            min="0"
            value={openingCash}
            onChange={(e) => setOpeningCash(e.target.value)}
          />
        </div>
        {error && (
          <p className="text-sm font-medium text-destructive">{error}</p>
        )}
        <Button
          type="button"
          onClick={handleOpen}
          disabled={isPending}
          className="bg-accent hover:bg-accent/90 text-white"
        >
          {isPending ? "กำลังเปิดกะ…" : "เปิดกะ"}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-5 space-y-4">
      <h2 className="text-base font-semibold text-sidebar">กะปัจจุบัน — เปิดอยู่</h2>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-md bg-muted p-3">
          <p className="text-xs text-muted-foreground">เงินสด</p>
          <p className="font-semibold text-sidebar tabular-nums">
            ฿{summary?.totalCash.toFixed(2) ?? "0.00"}
          </p>
        </div>
        <div className="rounded-md bg-muted p-3">
          <p className="text-xs text-muted-foreground">โอน</p>
          <p className="font-semibold text-sidebar tabular-nums">
            ฿{summary?.totalTransfer.toFixed(2) ?? "0.00"}
          </p>
        </div>
        <div className="rounded-md bg-muted p-3">
          <p className="text-xs text-muted-foreground">บัตร</p>
          <p className="font-semibold text-sidebar tabular-nums">
            ฿{summary?.totalCard.toFixed(2) ?? "0.00"}
          </p>
        </div>
        <div className="rounded-md bg-muted p-3">
          <p className="text-xs text-muted-foreground">จำนวนออเดอร์</p>
          <p className="font-semibold text-sidebar tabular-nums">
            {summary?.orderCount ?? 0}
          </p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        เงินสดที่ควรมีในลิ้นชัก:{" "}
        <span className="font-semibold text-sidebar">
          ฿{summary?.expectedCash.toFixed(2) ?? "0.00"}
        </span>
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="closing-cash">เงินสดที่นับได้จริง (บาท)</Label>
        <Input
          id="closing-cash"
          type="number"
          step="0.01"
          min="0"
          value={closingCash}
          onChange={(e) => setClosingCash(e.target.value)}
        />
      </div>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      <Button
        type="button"
        onClick={handleClose}
        disabled={isPending}
        className="bg-accent hover:bg-accent/90 text-white"
      >
        {isPending ? "กำลังปิดกะ…" : "ปิดกะ"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/(shell)/shifts/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { getProfile, getActiveShift, getShiftSummary } from "@/lib/dal";
import { ShiftPanel } from "@/components/shifts/shift-panel";

export default async function ShiftsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const activeShift = await getActiveShift(profile.tenant_id);
  const summary = activeShift
    ? await getShiftSummary(profile.tenant_id, activeShift.id)
    : null;

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">จัดการกะ</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          เปิด/ปิดกะและตรวจสอบเงินสดในลิ้นชัก
        </p>
      </div>
      <ShiftPanel activeShift={activeShift} summary={summary} />
    </div>
  );
}
```

- [ ] **Step 4: Modify `src/app/actions/orders.ts` — attach `shift_id` best-effort**

Change the import line from:
```ts
import { getProfile } from "@/lib/dal";
```
to:
```ts
import { getProfile, getActiveShift } from "@/lib/dal";
```

Add a shift lookup right before the order insert (after the category-snapshot block, before `// 4. Insert order row`):
```ts
  // 3.5. Best-effort: attach the currently open shift (does not block the sale if none is open)
  const activeShift = await getActiveShift(profile.tenant_id);

```

Then change the insert payload from:
```ts
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
```
to:
```ts
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
      shift_id: activeShift?.id ?? null,
    })
    .select("id")
    .single();
```

- [ ] **Step 5: Modify `src/app/(shell)/pos/page.tsx` — pass `activeShiftId`**

Change the import from:
```ts
import { getProfile, getModifiers } from "@/lib/dal";
```
to:
```ts
import { getProfile, getModifiers, getActiveShift } from "@/lib/dal";
```

Add a shift lookup right before the `return` statement (after the `todayOrderCount` query):
```ts
  const activeShift = await getActiveShift(profile.tenant_id);

```

Change the final `<PosScreen ... />` call from:
```tsx
  return (
    <PosScreen
      products={products}
      categories={categories}
      productModifierRecord={productModifierRecord}
      allModifiers={allModifiers}
      userName={profile.full_name ?? "ผู้ใช้"}
      todayOrderCount={todayOrderCount ?? 0}
    />
  );
```
to:
```tsx
  return (
    <PosScreen
      products={products}
      categories={categories}
      productModifierRecord={productModifierRecord}
      allModifiers={allModifiers}
      userName={profile.full_name ?? "ผู้ใช้"}
      todayOrderCount={todayOrderCount ?? 0}
      activeShiftId={activeShift?.id ?? null}
    />
  );
```

- [ ] **Step 6: Modify `src/components/pos/pos-screen.tsx` (as rewritten by Task 3) — accept `activeShiftId`**

Change the `Props` type from:
```tsx
type Props = {
  products: PosProduct[];
  categories: PosCategory[];
  productModifierRecord: Record<string, string[]>;
  allModifiers: ModifierWithOptions[];
  userName: string;
  todayOrderCount: number;
};
```
to:
```tsx
type Props = {
  products: PosProduct[];
  categories: PosCategory[];
  productModifierRecord: Record<string, string[]>;
  allModifiers: ModifierWithOptions[];
  userName: string;
  todayOrderCount: number;
  activeShiftId: string | null;
};
```

Change the function signature from:
```tsx
export function PosScreen({
  products,
  categories,
  productModifierRecord,
  allModifiers,
  userName,
  todayOrderCount,
}: Props) {
```
to:
```tsx
export function PosScreen({
  products,
  categories,
  productModifierRecord,
  allModifiers,
  userName,
  todayOrderCount,
  activeShiftId,
}: Props) {
```

Change the `PosHeader` call from:
```tsx
      <PosHeader userName={userName} todayOrderCount={todayOrderCount} />
```
to:
```tsx
      <PosHeader
        userName={userName}
        todayOrderCount={todayOrderCount}
        hasActiveShift={activeShiftId !== null}
      />
```

- [ ] **Step 7: Modify `src/components/pos/pos-header.tsx` — shift status indicator**

Replace the full file with:

```tsx
"use client";
import Link from "next/link";

type Props = {
  userName: string;
  todayOrderCount: number;
  hasActiveShift: boolean;
};

export function PosHeader({ userName, todayOrderCount, hasActiveShift }: Props) {
  const dateStr = new Date().toLocaleDateString("th-TH", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex items-center justify-between py-1 shrink-0">
      <div>
        <h1 className="text-xl font-bold text-sidebar">POS</h1>
        <p className="text-xs text-muted-foreground mt-0.5">{dateStr}</p>
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/shifts"
          className={
            "text-xs font-medium px-2.5 py-1 rounded-full transition-colors " +
            (hasActiveShift
              ? "bg-green-100 text-green-700 hover:bg-green-200"
              : "bg-destructive/10 text-destructive hover:bg-destructive/20")
          }
        >
          {hasActiveShift ? "กะเปิดอยู่" : "ยังไม่เปิดกะ"}
        </Link>
        <div className="text-right text-sm">
          <p className="font-medium text-sidebar">{userName}</p>
          <p className="text-xs text-muted-foreground">
            ออเดอร์วันนี้{" "}
            <span className="font-semibold text-sidebar">{todayOrderCount}</span>{" "}
            รายการ
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: TypeScript check**

```powershell
npx tsc --noEmit 2>&1
```
Expected: no output.

- [ ] **Step 9: Commit**

```powershell
git add src/app/actions/shifts.ts src/components/shifts/shift-panel.tsx src/app/(shell)/shifts/page.tsx src/app/actions/orders.ts src/app/(shell)/pos/page.tsx src/components/pos/pos-screen.tsx src/components/pos/pos-header.tsx
git commit -m "feat(shifts): add Shift Close with cash reconciliation and POS shift indicator"
```

---

### Task 5: Customer History

**Files:**
- Create: `src/app/(shell)/customers/page.tsx`
- Create: `src/app/(shell)/customers/[id]/page.tsx`
- Modify: `src/components/shell/sidebar.tsx` (nav items for Shifts + Customers)

**Interfaces:**
- Consumes: `getCustomers`, `getCustomerById`, `getCustomerOrders` (Task 2)

---

- [ ] **Step 1: Create `src/app/(shell)/customers/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile, getCustomers } from "@/lib/dal";

export default async function CustomersPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");

  const customers = await getCustomers(profile.tenant_id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">ลูกค้า</h1>
        <p className="text-sm text-muted-foreground mt-1">
          รายชื่อลูกค้าและประวัติการสั่งซื้อ
        </p>
      </div>

      <div className="rounded-lg border bg-white divide-y divide-border">
        {customers.length > 0 ? (
          customers.map((c) => (
            <Link
              key={c.id}
              href={`/customers/${c.id}`}
              className="flex items-center gap-4 px-4 py-3 hover:bg-muted transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sidebar truncate">{c.name}</p>
                <p className="text-sm text-muted-foreground">
                  {c.phone ?? "ไม่มีเบอร์โทร"} · {c.orderCount} ออเดอร์
                </p>
              </div>
              <p className="text-sm font-semibold text-sidebar tabular-nums shrink-0">
                ฿{c.totalSpent.toFixed(2)}
              </p>
            </Link>
          ))
        ) : (
          <p className="px-4 py-8 text-center text-muted-foreground">
            ยังไม่มีข้อมูลลูกค้า
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/(shell)/customers/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getProfile, getCustomerById, getCustomerOrders } from "@/lib/dal";

const PAYMENT_LABELS: Record<string, string> = {
  cash: "เงินสด",
  transfer: "โอน",
  card: "บัตร",
};

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");

  const { id } = await params;

  const customer = await getCustomerById(profile.tenant_id, id);
  if (!customer) notFound();

  const orders = await getCustomerOrders(profile.tenant_id, id);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/customers" className="text-sm text-accent hover:underline">
          ← กลับไปรายชื่อลูกค้า
        </Link>
        <h1 className="text-2xl font-bold text-sidebar mt-1">{customer.name}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {customer.phone ?? "ไม่มีเบอร์โทร"} · {customer.email ?? "ไม่มีอีเมล"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-muted-foreground">ยอดซื้อสะสม</p>
          <p className="text-xl font-bold text-sidebar tabular-nums">
            ฿{customer.totalSpent.toFixed(2)}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-muted-foreground">จำนวนออเดอร์</p>
          <p className="text-xl font-bold text-sidebar tabular-nums">
            {customer.orderCount}
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-base font-semibold text-sidebar mb-3">
          ประวัติการสั่งซื้อ
        </h2>
        <div className="rounded-lg border bg-white divide-y divide-border">
          {orders.length > 0 ? (
            orders.map((o) => (
              <Link
                key={o.id}
                href={`/orders/${o.id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-muted transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sidebar truncate">
                    {o.orderNumber ?? "—"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(o.createdAt).toLocaleDateString("th-TH")} ·{" "}
                    {PAYMENT_LABELS[o.paymentMethod] ?? o.paymentMethod}
                  </p>
                </div>
                <p className="text-sm font-semibold text-sidebar tabular-nums shrink-0">
                  ฿{o.total.toFixed(2)}
                </p>
              </Link>
            ))
          ) : (
            <p className="px-4 py-8 text-center text-muted-foreground">
              ยังไม่มีประวัติการสั่งซื้อ
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Modify `src/components/shell/sidebar.tsx` — add nav items**

Change the icon import from:
```tsx
import {
  LayoutDashboard,
  CreditCard,
  ShoppingBag,
  Package,
  Tag,
  FlaskConical,
  Sliders,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";
```
to:
```tsx
import {
  LayoutDashboard,
  CreditCard,
  ShoppingBag,
  Package,
  Tag,
  FlaskConical,
  Sliders,
  BarChart3,
  Settings,
  Clock,
  Users,
  type LucideIcon,
} from "lucide-react";
```

Change `allNavItems` from:
```tsx
const allNavItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, minRole: "staff" },
  { href: "/pos", label: "POS", icon: CreditCard, minRole: "staff" },
  { href: "/orders", label: "Orders", icon: ShoppingBag, minRole: "staff" },
  { href: "/products", label: "Products", icon: Package, minRole: "staff" },
  { href: "/categories", label: "Categories", icon: Tag, minRole: "manager" },
  { href: "/inventory", label: "Inventory", icon: FlaskConical, minRole: "manager" },
  { href: "/modifiers", label: "Modifiers", icon: Sliders, minRole: "manager" },
  { href: "/reports", label: "Reports", icon: BarChart3, minRole: "manager" },
  { href: "/settings", label: "Settings", icon: Settings, minRole: "owner" },
];
```
to:
```tsx
const allNavItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, minRole: "staff" },
  { href: "/pos", label: "POS", icon: CreditCard, minRole: "staff" },
  { href: "/orders", label: "Orders", icon: ShoppingBag, minRole: "staff" },
  { href: "/shifts", label: "Shifts", icon: Clock, minRole: "staff" },
  { href: "/products", label: "Products", icon: Package, minRole: "staff" },
  { href: "/categories", label: "Categories", icon: Tag, minRole: "manager" },
  { href: "/inventory", label: "Inventory", icon: FlaskConical, minRole: "manager" },
  { href: "/modifiers", label: "Modifiers", icon: Sliders, minRole: "manager" },
  { href: "/customers", label: "Customers", icon: Users, minRole: "manager" },
  { href: "/reports", label: "Reports", icon: BarChart3, minRole: "manager" },
  { href: "/settings", label: "Settings", icon: Settings, minRole: "owner" },
];
```

- [ ] **Step 4: TypeScript check**

```powershell
npx tsc --noEmit 2>&1
```
Expected: no output.

- [ ] **Step 5: Commit**

```powershell
git add src/app/(shell)/customers src/components/shell/sidebar.tsx
git commit -m "feat(customers): add customer list and order history pages"
```

- [ ] **Step 6: Push to GitHub**

```powershell
git push origin main
```
