# Order Refund Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff refund a whole completed order (any time, any shift — no shift-window
restriction) gated by mandatory Manager/Owner PIN approval, with an independently-selectable
refund method, and correct cash-drawer impact on whichever shift the refund itself happens in.

**Architecture:** One new server action (`refundOrder`) does the whole write in one call —
same shape as `voidOrder`: validate → find an approving Manager/Owner by PIN (admin client) →
update the order row (admin client, required this time from the first commit since the guarding
trigger ships with the migration, not added after a review catches the gap) → done (no stock
restock, unlike void). One new client component (`RefundOrderButton`) mirrors
`VoidOrderButton`'s self-contained modal, with an added refund-method selector. `getShiftSummary`
gains a second, independent query so a cash refund correctly reduces the till of whatever shift is
open when the refund happens — which may not be the shift the original sale belonged to.

**Tech Stack:** Same as the rest of the app — Next.js 16 Server Actions, `useActionState`,
Supabase (Postgres + PostgREST + RPC), bcryptjs. No test framework — verification is manual
live-browser QA.

## Global Constraints

- Exact Thai copy strings below are final — use them verbatim, do not rephrase.
- No automated tests exist in this project — do not add a test framework. Verify by running the
  app and clicking through it.
- The DB migration must be applied directly to the production Supabase project via the Supabase
  MCP `apply_migration` tool first (project id `khgahdjfkzpgsvbhfrqx`), *then* written to
  `supabase/migrations/` as a matching file, then regenerate `src/types/database.ts` via the MCP
  `generate_typescript_types` tool and overwrite the file wholesale (do not hand-edit it).
- Reuse the existing `PinPad`, `Button`, `Label` components exactly as used elsewhere — no new
  primitives. Modal styling must match the existing hand-rolled overlay pattern already used by
  `src/components/orders/void-order-button.tsx` (`fixed inset-0 z-50 bg-black/50 flex items-center
  justify-center p-4` wrapping a `bg-white rounded-xl p-6 w-full max-w-sm` card).
- Refund is **whole-order only** in v1 — no partial/line-item refund.
- A refunded order does **not** trigger any stock restock — deliberately different from void.
- `refund_method` is independently selectable (cash/transfer/card) and is **not** required to
  match the order's original `payment_method`.
- The security trigger (`prevent_direct_order_refund`) must guard **both** INSERT and UPDATE from
  the very first migration — this is not optional hardening to add later. Both
  [[project_void_order_feature]] and [[project_discount_feature]] needed a post-hoc Critical fix
  for exactly this class of gap (a Data-API-forgeable approval column); this plan applies that
  lesson from the start.
- `getShiftSummary`'s main orders query must continue excluding only `'cancelled'`, **not**
  `'refunded'` — the cash from a later-refunded order's original sale genuinely entered that
  shift's drawer historically, and excluding it here (on top of the separate refund-subtraction
  query) would double-subtract when a refund happens in the same shift as its original sale. Every
  *other* reporting query in `dal.ts` (Dashboard, sales-by-*, customer totals) DOES additionally
  exclude `'refunded'`, since those represent net revenue, not drawer cash. This distinction is
  load-bearing — do not "simplify" it to a single consistent rule across all queries.

---

### Task 1: Order refund feature (migration + action + shift cash + UI)

**Files:**
- Create: `supabase/migrations/20260818120000_order_refund.sql`
- Modify: `src/types/database.ts` (regenerate wholesale after migration — do not hand-edit)
- Modify: `src/app/actions/orders.ts`
- Modify: `src/lib/dal.ts`
- Modify: `src/app/(shell)/pos/page.tsx`
- Modify: `src/app/(shell)/orders/page.tsx`
- Modify: `src/app/(shell)/orders/[id]/page.tsx`
- Modify: `src/components/orders/orders-filter.tsx`
- Modify: `src/components/shifts/shift-panel.tsx`
- Create: `src/components/orders/refund-order-button.tsx`

**Interfaces:**
- Produces: `refundOrder(prevState: RefundOrderState, formData: FormData): Promise<RefundOrderState>`
  from `src/app/actions/orders.ts`, where
  `RefundOrderState = { error?: string; success?: boolean } | undefined`. `formData` fields:
  `order_id` (string), `refund_method` (`"cash" | "transfer" | "card"`), `reason` (string), `pin`
  (6-digit string).
- Produces: `RefundOrderButton({ orderId }: { orderId: string })` from
  `src/components/orders/refund-order-button.tsx` — fully self-contained, takes no callbacks.
- Produces: `ShiftSummary` (from `src/lib/dal.ts`) gains a new field `totalCashRefunded: number`.
- Consumes: existing `PinPad`, `Button`, `Label` from `src/components/ui/`, existing
  `getProfile`/`getActiveShift` from `src/lib/dal.ts`, existing `createAdminClient` from
  `src/lib/supabase/admin.ts`.

- [ ] **Step 1: Apply the migration directly to the production Supabase project**

Use the Supabase MCP `apply_migration` tool (project id `khgahdjfkzpgsvbhfrqx`), name
`order_refund`, with this exact SQL:

```sql
alter table public.orders
  add column refunded_at timestamptz,
  add column refunded_by uuid references public.profiles(id),
  add column refunded_approved_by uuid references public.profiles(id),
  add column refund_reason text,
  add column refund_method text,
  add column refund_shift_id uuid references public.shifts(id);

alter table public.orders drop constraint orders_status_check;
alter table public.orders
  add constraint orders_status_check
    check (status = any (array['completed', 'voided', 'cancelled', 'refunded']));

alter table public.orders
  add constraint orders_refund_method_check
    check (refund_method is null or refund_method in ('cash', 'transfer', 'card'));

comment on column public.orders.refunded_at is
  'Timestamp the order was refunded. Null unless status = ''refunded''.';
comment on column public.orders.refunded_by is
  'Profile that tapped "คืนเงิน" — the acting staff member (whoever getProfile() resolved to).';
comment on column public.orders.refunded_approved_by is
  'Profile whose PIN matched during the refund approval modal. Always role owner or manager.';
comment on column public.orders.refund_reason is
  'Required free-text reason entered in the refund modal.';
comment on column public.orders.refund_method is
  '''cash'' | ''transfer'' | ''card'' — independently selectable, not necessarily the same as
   the order''s original payment_method.';
comment on column public.orders.refund_shift_id is
  'The shift open at the moment of refund (NOT the original sale''s shift_id) — used to subtract
   cash refunds from the correct till in getShiftSummary.';

-- orders_insert_own_tenant's RLS has no WITH CHECK beyond tenant_id/created_by, and
-- orders_update_own_tenant has no WITH CHECK at all, so any authenticated tenant member could
-- otherwise fabricate a refund two ways: (a) INSERT a brand-new fake order with
-- status='refunded' and a forged refunded_approved_by, never having been a real sale at all, or
-- (b) UPDATE an existing order to set the same columns directly. Both both Void Order and
-- Discount needed a post-hoc Critical fix for exactly this class of gap on their own approval
-- columns — this trigger closes both write paths from the very first migration.
create or replace function public.prevent_direct_order_refund()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    if (
         new.status = 'refunded'
      or new.refunded_at is not null
      or new.refunded_by is not null
      or new.refunded_approved_by is not null
      or new.refund_reason is not null
      or new.refund_method is not null
      or new.refund_shift_id is not null
       )
       and auth.uid() is not null
    then
      raise exception 'Refunding an order requires PIN verification via the app';
    end if;
  elsif TG_OP = 'UPDATE' then
    if (
         (new.status is distinct from old.status and new.status = 'refunded')
      or (new.refunded_at is distinct from old.refunded_at)
      or (new.refunded_by is distinct from old.refunded_by)
      or (new.refunded_approved_by is distinct from old.refunded_approved_by)
      or (new.refund_reason is distinct from old.refund_reason)
      or (new.refund_method is distinct from old.refund_method)
      or (new.refund_shift_id is distinct from old.refund_shift_id)
       )
       and auth.uid() is not null
    then
      raise exception 'Refunding an order requires PIN verification via the app';
    end if;
  end if;
  return new;
end;
$$;

create trigger prevent_direct_order_refund_trigger
before insert or update on public.orders
for each row
execute function public.prevent_direct_order_refund();
```

- [ ] **Step 2: Write the same SQL to a migration file in the repo**

Create `supabase/migrations/20260818120000_order_refund.sql` with the exact SQL from Step 1
(including all comments).

- [ ] **Step 3: Regenerate `src/types/database.ts`**

Call the Supabase MCP `generate_typescript_types` tool for project `khgahdjfkzpgsvbhfrqx` and
overwrite `src/types/database.ts` with the returned content in full. Verify afterward that
`Database["public"]["Tables"]["orders"]["Row"]` includes `refunded_at`, `refunded_by`,
`refunded_approved_by`, `refund_reason`, `refund_method`, `refund_shift_id`.

- [ ] **Step 4: Add `refundOrder` to `src/app/actions/orders.ts`, and extend `voidOrder`'s guard**

Add this import to the top of the file, alongside the existing ones (the file already imports
`getProfile, getActiveShift` from `@/lib/dal` — no import line changes needed beyond what's
already there).

In `voidOrder`, find this line:

```ts
  if (order.status === "cancelled") return { error: "บิลนี้ถูกยกเลิกไปแล้ว" };
```

and add a line directly after it:

```ts
  if (order.status === "refunded") return { error: "บิลนี้ถูกคืนเงินไปแล้ว ไม่สามารถยกเลิกได้" };
```

Then append this to the very end of the file, after `voidOrder`:

```ts
export type RefundOrderState = { error?: string; success?: boolean } | undefined;

export async function refundOrder(
  prevState: RefundOrderState,
  formData: FormData
): Promise<RefundOrderState> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };

  const orderId = formData.get("order_id");
  const refundMethod = formData.get("refund_method");
  const reason = formData.get("reason");
  const pin = formData.get("pin");

  if (
    typeof orderId !== "string" ||
    typeof refundMethod !== "string" ||
    typeof reason !== "string" ||
    typeof pin !== "string"
  ) {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }
  if (
    refundMethod !== "cash" &&
    refundMethod !== "transfer" &&
    refundMethod !== "card"
  ) {
    return { error: "กรุณาเลือกวิธีคืนเงิน" };
  }
  if (reason.trim() === "") {
    return { error: "กรุณาระบุเหตุผล" };
  }
  if (!/^\d{6}$/.test(pin)) {
    return { error: "PIN ไม่ถูกต้อง" };
  }

  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (!order) return { error: "ไม่พบบิลนี้" };
  if (order.status === "cancelled") {
    return { error: "บิลนี้ถูกยกเลิกไปแล้ว ไม่สามารถคืนเงินได้" };
  }
  if (order.status === "refunded") return { error: "บิลนี้ถูกคืนเงินไปแล้ว" };

  const activeShift = await getActiveShift(profile.tenant_id);
  if (refundMethod === "cash" && !activeShift) {
    return { error: "ต้องเปิดกะก่อนจึงจะคืนเงินสดได้" };
  }

  const admin = createAdminClient();
  const { data: approvers } = await admin
    .from("profiles")
    .select("id, pin_hash")
    .eq("tenant_id", profile.tenant_id)
    .in("role", ["owner", "manager"])
    .not("pin_hash", "is", null);

  let approverId: string | null = null;
  for (const approver of approvers ?? []) {
    if (approver.pin_hash && (await bcrypt.compare(pin, approver.pin_hash))) {
      approverId = approver.id;
      break;
    }
  }

  if (!approverId) return { error: "PIN ไม่ถูกต้อง" };

  // Written via the admin client from the start (unlike voidOrder's original commit, which
  // needed a later fix): orders_update_own_tenant RLS has no WITH CHECK, so any tenant member
  // could otherwise PATCH the refund_* columns directly through the Data API. The
  // prevent_direct_order_refund trigger rejects this exact write from any caller whose
  // auth.uid() is non-null — i.e. everyone except this service_role call — so the trigger and
  // this client choice must be changed together.
  const { data: updated, error: updateError } = await admin
    .from("orders")
    .update({
      status: "refunded",
      refunded_at: new Date().toISOString(),
      refunded_by: profile.id,
      refunded_approved_by: approverId,
      refund_reason: reason.trim(),
      refund_method: refundMethod,
      refund_shift_id: activeShift?.id ?? null,
    })
    .eq("id", orderId)
    .eq("tenant_id", profile.tenant_id)
    .eq("status", "completed")
    .select("id");

  if (updateError || !updated || updated.length === 0) {
    if (!updateError) {
      // 0 rows with no error means the status/tenant/id filter didn't match — most likely
      // someone else's concurrent void/refund already won the race, not a real failure.
      const { data: recheck } = await admin
        .from("orders")
        .select("status")
        .eq("id", orderId)
        .maybeSingle();
      if (recheck?.status === "cancelled") {
        return { error: "บิลนี้ถูกยกเลิกไปแล้ว ไม่สามารถคืนเงินได้" };
      }
      if (recheck?.status === "refunded") {
        return { error: "บิลนี้ถูกคืนเงินไปแล้ว" };
      }
    }
    console.error(
      "refundOrder: failed to update order:",
      updateError ?? "update matched 0 rows (row missing or tenant mismatch)"
    );
    return { error: "คืนเงินไม่สำเร็จ" };
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  return { success: true };
}
```

Leave `createOrder` and everything else already in the file exactly as it is.

- [ ] **Step 5: Create `src/components/orders/refund-order-button.tsx`**

```tsx
"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { refundOrder, type RefundOrderState } from "@/app/actions/orders";
import { PinPad } from "@/components/ui/pin-pad";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const MAX_PIN_ATTEMPTS = 5;

type RefundMethod = "cash" | "transfer" | "card";

const REFUND_METHODS: { value: RefundMethod; label: string }[] = [
  { value: "cash", label: "เงินสด" },
  { value: "transfer", label: "โอน" },
  { value: "card", label: "บัตร" },
];

export function RefundOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [refundMethod, setRefundMethod] = useState<RefundMethod>("cash");
  const [reason, setReason] = useState("");
  const [attempts, setAttempts] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, action, pending] = useActionState<RefundOrderState, FormData>(
    refundOrder,
    undefined
  );

  const [handledState, setHandledState] = useState<RefundOrderState>(undefined);
  if (state !== handledState) {
    setHandledState(state);
    if (state?.success) {
      setIsOpen(false);
    } else if (state?.error === "PIN ไม่ถูกต้อง") {
      const next = attempts + 1;
      if (next >= MAX_PIN_ATTEMPTS) {
        setIsOpen(false);
        setReason("");
        setRefundMethod("cash");
        setAttempts(0);
      } else {
        setAttempts(next);
      }
    }
  }

  useEffect(() => {
    if (state?.success) {
      router.refresh();
    }
  }, [state?.success, router]);

  function close() {
    setIsOpen(false);
    setReason("");
    setRefundMethod("cash");
    setAttempts(0);
  }

  if (!isOpen) {
    return (
      <Button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full bg-white border border-destructive/40 text-destructive hover:bg-destructive/5"
      >
        คืนเงิน
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4">
        <h2 className="text-lg font-bold text-sidebar text-center">คืนเงิน</h2>

        <form ref={formRef} action={action} className="space-y-4">
          <input type="hidden" name="order_id" value={orderId} />
          <input type="hidden" name="refund_method" value={refundMethod} />
          <input type="hidden" name="pin" />

          <div className="space-y-1.5">
            <Label>วิธีคืนเงิน</Label>
            <div className="flex gap-2">
              {REFUND_METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setRefundMethod(m.value)}
                  className={`flex-1 rounded-md border py-1.5 text-xs font-medium transition-colors ${
                    refundMethod === m.value
                      ? "border-accent bg-accent text-white"
                      : "border-input text-muted-foreground hover:border-accent hover:text-accent"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="refund-reason">เหตุผลที่คืนเงิน</Label>
            <textarea
              id="refund-reason"
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={2}
              className="w-full rounded-md border border-input px-3 py-2 text-sm"
              placeholder="เช่น ลูกค้าไม่พอใจสินค้า, สั่งผิด"
            />
          </div>

          <div className="space-y-1.5">
            <Label>PIN ของ Manager/Owner เพื่ออนุมัติ</Label>
            <PinPad
              disabled={pending || reason.trim() === ""}
              onComplete={(pin) => {
                if (!formRef.current) return;
                const hidden = formRef.current.elements.namedItem(
                  "pin"
                ) as HTMLInputElement;
                hidden.value = pin;
                formRef.current.requestSubmit();
                // Clear immediately after submit — FormData is captured synchronously by
                // requestSubmit, so this can't affect what was sent. Matches void-order-button's
                // existing convention: leaving the real PIN in the DOM after a wrong guess would
                // let anyone read it back out on a shared device.
                hidden.value = "";
              }}
            />
            {reason.trim() === "" && (
              <p className="text-xs text-muted-foreground text-center">
                กรอกเหตุผลก่อนกดตัวเลข
              </p>
            )}
          </div>

          {state?.error !== undefined && (
            <p className="text-sm text-destructive font-medium text-center">
              {state.error}
            </p>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={close}
            disabled={pending}
            className="w-full"
          >
            ยกเลิก
          </Button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Extend all report-facing queries in `src/lib/dal.ts` to also exclude `'refunded'`**

In each of the following functions, find the existing `.neq("status", "cancelled")` call and add
`.neq("status", "refunded")` immediately after it (same chained-method style, one line each):

- `getDashboardStats` — **both** query builders inside the `Promise.all([...])` (the `todayRows`
  query and the `yesterdayRows` query)
- `getTopProducts`
- `getSalesByHour`
- `getSalesByCategory`
- `getSalesByDay`
- `getSalesByMonth`
- `getHourlyPattern`
- `getSalesSummary`
- `getCustomers` (the `orderRows` query)
- `getCustomerById` (the `orderRows` query)

Do **not** touch `getCustomerOrders` (it intentionally shows every order regardless of status —
a customer's own order history should still show their cancelled/refunded orders).

Do **not** add `.neq("status", "refunded")` to `getShiftSummary`'s main `orderRows` query — see
the Global Constraints note above for why. Instead, replace the whole `getShiftSummary` function
with:

```ts
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
  // Deliberately NOT excluding 'refunded' here: the cash from a later-refunded order's original
  // sale genuinely entered this shift's drawer historically. The refund's cash outflow is
  // subtracted separately below, tagged to whichever shift the refund itself happened in
  // (refund_shift_id) — which may differ from this shift. Excluding 'refunded' here too would
  // double-subtract when the refund happens in the same shift as its original sale.

  const rows = (orderRows ?? []) as { total: number; payment_method: string }[];
  const totalCashGross = rows
    .filter((r) => r.payment_method === "cash")
    .reduce((sum, r) => sum + Number(r.total), 0);
  const totalTransfer = rows
    .filter((r) => r.payment_method === "transfer")
    .reduce((sum, r) => sum + Number(r.total), 0);
  const totalCard = rows
    .filter((r) => r.payment_method === "card")
    .reduce((sum, r) => sum + Number(r.total), 0);

  const { data: refundRows } = await supabase
    .from("orders")
    .select("total")
    .eq("tenant_id", tenantId)
    .eq("refund_shift_id", shiftId)
    .eq("status", "refunded")
    .eq("refund_method", "cash");
  const totalCashRefunded = ((refundRows ?? []) as { total: number }[]).reduce(
    (sum, r) => sum + Number(r.total),
    0
  );

  const { data: shiftRow } = await supabase
    .from("shifts")
    .select("opening_cash")
    .eq("id", shiftId)
    .eq("tenant_id", tenantId)
    .single();
  const openingCash = Number(
    (shiftRow as { opening_cash: number } | null)?.opening_cash ?? 0
  );

  const totalCash = totalCashGross - totalCashRefunded;

  return {
    totalCash,
    totalCashRefunded,
    totalTransfer,
    totalCard,
    orderCount: rows.length,
    expectedCash: openingCash + totalCash,
  };
}
```

Update the `ShiftSummary` type (defined just above `getActiveShift` in the same file) to add the
new field:

```ts
export type ShiftSummary = {
  totalCash: number;
  totalCashRefunded: number;
  totalTransfer: number;
  totalCard: number;
  orderCount: number;
  expectedCash: number;
};
```

- [ ] **Step 7: Extend the today's-order-count query in `src/app/(shell)/pos/page.tsx`**

Find:

```ts
  const { count: todayOrderCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", profile.tenant_id)
    .neq("status", "cancelled")
    .gte("created_at", todayStart.toISOString());
```

and add `.neq("status", "refunded")` after the existing `.neq("status", "cancelled")` line.

- [ ] **Step 8: Add a "refunded" filter tab in `src/components/orders/orders-filter.tsx`**

Replace the file's content with:

```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";

type FilterValue = "all" | "cash" | "transfer" | "card" | "cancelled" | "refunded";

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "cash", label: "เงินสด" },
  { value: "transfer", label: "โอน" },
  { value: "card", label: "บัตร" },
  { value: "cancelled", label: "ยกเลิก" },
  { value: "refunded", label: "คืนเงิน" },
];

export function OrdersFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = (searchParams.get("filter") ?? "all") as FilterValue;

  function setFilter(value: FilterValue) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("filter");
    } else {
      params.set("filter", value);
    }
    router.push(`/orders?${params.toString()}`);
  }

  return (
    <div className="flex gap-2 flex-wrap">
      {FILTERS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => setFilter(value)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
            current === value
              ? "border-accent bg-accent text-white"
              : "border-input text-muted-foreground hover:border-accent hover:text-accent"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 9: Wire the "refunded" filter and status badge into `src/app/(shell)/orders/page.tsx`**

Replace the file's content with:

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { OrdersFilter } from "@/components/orders/orders-filter";

type FilterValue = "all" | "cash" | "transfer" | "card" | "cancelled" | "refunded";

type OrderRow = {
  id: string;
  order_number: string | null;
  payment_method: string;
  status: string;
  total: number;
  created_at: string;
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: "เงินสด",
  transfer: "โอน",
  card: "บัตร",
};

type Props = {
  searchParams: Promise<{ filter?: string }>;
};

export default async function OrdersPage({ searchParams }: Props) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const { filter } = await searchParams;
  const filterValue = (filter ?? "all") as FilterValue;

  const supabase = await createClient();
  const baseQuery = supabase
    .from("orders")
    .select("id, order_number, payment_method, status, total, created_at")
    .eq("tenant_id", profile.tenant_id)
    .order("created_at", { ascending: false });

  const filteredQuery =
    filterValue === "cancelled"
      ? baseQuery.eq("status", "cancelled")
      : filterValue === "refunded"
        ? baseQuery.eq("status", "refunded")
        : filterValue !== "all"
          ? baseQuery
              .eq("payment_method", filterValue)
              .neq("status", "cancelled")
              .neq("status", "refunded")
          : baseQuery;

  const { data: orders } = (await filteredQuery) as { data: OrderRow[] | null };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">ประวัติบิล</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          บิลทั้งหมดของร้าน
        </p>
      </div>

      <Suspense fallback={null}>
        <OrdersFilter />
      </Suspense>

      <div className="rounded-lg border bg-white divide-y divide-border">
        {orders && orders.length > 0 ? (
          orders.map((order) => (
            <Link
              key={order.id}
              href={`/orders/${order.id}`}
              className="flex items-center gap-4 px-4 py-3 hover:bg-surface transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sidebar text-sm font-mono">
                  {order.order_number ?? `#${order.id.slice(0, 8).toUpperCase()}`}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(order.created_at).toLocaleString("th-TH", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                  order.status === "cancelled"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : order.status === "refunded"
                      ? "border-orange-300 bg-orange-50 text-orange-600"
                      : "border-green-200 bg-green-50 text-green-700"
                }`}
              >
                {order.status === "cancelled"
                  ? "ยกเลิก"
                  : order.status === "refunded"
                    ? "คืนเงิน"
                    : (PAYMENT_LABELS[order.payment_method] ?? order.payment_method)}
              </span>
              <p className="text-sm font-semibold text-sidebar tabular-nums w-24 text-right">
                ฿{Number(order.total).toFixed(2)}
              </p>
            </Link>
          ))
        ) : (
          <p className="px-4 py-12 text-center text-muted-foreground text-sm">
            ไม่พบบิล
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Wire the refund button and refunded-state display into the order detail page**

In `src/app/(shell)/orders/[id]/page.tsx`, add the import:

```ts
import { RefundOrderButton } from "@/components/orders/refund-order-button";
```

Extend the `OrderDetail` type (add four fields after `cancel_reason`):

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
  refunded_at: string | null;
  refund_reason: string | null;
  refund_method: string | null;
  created_at: string;
  order_items: OrderItem[];
};
```

Update the `.select(...)` call to include the three new columns needed for display (add
`refunded_at, refund_reason, refund_method` right after `cancel_reason`):

```ts
  const { data: order } = (await supabase
    .from("orders")
    .select(
      "id, order_number, payment_method, status, subtotal, discount_type, discount_value, discount_amount, discount_reason, total, note, cancelled_at, cancel_reason, refunded_at, refund_reason, refund_method, created_at, order_items(id, product_name, unit_price, quantity, subtotal)"
    )
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .single()) as { data: OrderDetail | null };
```

Replace the status row:

```tsx
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">สถานะ</span>
          <span
            className={`font-medium ${
              order.status === "cancelled"
                ? "text-destructive"
                : "text-green-700"
            }`}
          >
            {order.status === "cancelled" ? "ยกเลิก" : "สำเร็จ"}
          </span>
        </div>
```

with:

```tsx
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">สถานะ</span>
          <span
            className={`font-medium ${
              order.status === "cancelled"
                ? "text-destructive"
                : order.status === "refunded"
                  ? "text-orange-600"
                  : "text-green-700"
            }`}
          >
            {order.status === "cancelled"
              ? "ยกเลิก"
              : order.status === "refunded"
                ? "คืนเงิน"
                : "สำเร็จ"}
          </span>
        </div>
```

Right after the existing cancelled-state block:

```tsx
        {order.status === "cancelled" && order.cancelled_at !== null && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">เวลาที่ยกเลิก</span>
            <span className="font-medium text-sidebar">
              {new Date(order.cancelled_at).toLocaleString("th-TH", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </div>
        )}
```

add the refunded-state block:

```tsx
        {order.status === "refunded" && order.refund_reason !== null && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">เหตุผลที่คืนเงิน</span>
            <span className="font-medium text-sidebar text-right max-w-[60%]">
              {order.refund_reason}
            </span>
          </div>
        )}
        {order.status === "refunded" && order.refund_method !== null && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">วิธีคืนเงิน</span>
            <span className="font-medium text-sidebar">
              {PAYMENT_LABELS[order.refund_method] ?? order.refund_method}
            </span>
          </div>
        )}
        {order.status === "refunded" && order.refunded_at !== null && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">เวลาที่คืนเงิน</span>
            <span className="font-medium text-sidebar">
              {new Date(order.refunded_at).toLocaleString("th-TH", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </div>
        )}
```

Finally, replace the button-rendering line at the end of the file:

```tsx
      {order.status !== "cancelled" && <VoidOrderButton orderId={order.id} />}
```

with:

```tsx
      {order.status === "completed" && (
        <div className="space-y-2">
          <VoidOrderButton orderId={order.id} />
          <RefundOrderButton orderId={order.id} />
        </div>
      )}
```

- [ ] **Step 11: Show the cash-refunded figure on the shift panel**

In `src/components/shifts/shift-panel.tsx`, find this block:

```tsx
      <p className="text-sm text-muted-foreground">
        เงินสดที่ควรมีในลิ้นชัก:{" "}
        <span className="font-semibold text-sidebar">
          ฿{summary?.expectedCash.toFixed(2) ?? "0.00"}
        </span>
      </p>
```

and insert this immediately before it:

```tsx
      {summary && summary.totalCashRefunded > 0 && (
        <p className="text-sm text-muted-foreground">
          คืนเงินสดระหว่างกะนี้:{" "}
          <span className="font-semibold text-destructive">
            -฿{summary.totalCashRefunded.toFixed(2)}
          </span>
        </p>
      )}
```

- [ ] **Step 12: Type-check, lint, build**

Run:
```bash
npx tsc --noEmit
npm run lint
npm run build
```
Expected: all three clean (0 errors).

- [ ] **Step 13: Manual live-browser verification**

Using disposable QA data (a test tenant/owner/manager/staff, deleted immediately after), verify on
localhost via the Browser pane at tablet size, per [[feedback_live_preview_ipad_standard]]:

1. Create and complete a test order while a shift is open. Open its detail page → both "ยกเลิกบิล"
   and "คืนเงิน" buttons visible.
2. Tap "คืนเงิน" → modal opens with method selector (default "เงินสด"), reason textarea, PinPad
   (disabled until reason typed). Enter a Staff member's own PIN → rejected. Enter the Manager's
   correct PIN → succeeds, order shows status "คืนเงิน", refund reason/method/timestamp, both
   action buttons gone. Confirm via SQL: `status='refunded'`, `refunded_approved_by` = Manager's
   id, `refund_shift_id` = the currently open shift's id.
3. Reload `/orders` and Dashboard → the refunded order is excluded from sales totals; reload
   `/shifts` → the open shift's "เงินสด" tile and "เงินสดที่ควรมีในลิ้นชัก" both reflect the
   refund subtraction, and a new "คืนเงินสดระหว่างกะนี้: -฿X" line appears.
4. Close that shift, open a **new** shift, then refund a **different** completed order that
   originally belonged to the now-closed shift (this is the cross-shift scenario the spec called
   out) → succeeds (no shift-window restriction, unlike void). Confirm the refund is tagged to the
   **new** shift's `refund_shift_id`, and the new shift's cash summary reflects the subtraction —
   not the old, closed shift's.
5. With no shift open at all, attempt a cash refund on a completed order → rejected with
   "ต้องเปิดกะก่อนจึงจะคืนเงินสดได้". Attempt the same refund via "โอน" or "บัตร" instead → succeeds
   with no shift required, `refund_shift_id` is null.
6. Attempt to refund an already-cancelled order → rejected. Attempt to void an already-refunded
   order → rejected (test both directions of the new mutual-exclusivity guard).
7. Attempt to refund the same order twice → second attempt rejected ("บิลนี้ถูกคืนเงินไปแล้ว").
8. Refund an order whose original `payment_method` was `transfer`, choosing `cash` as the refund
   method → succeeds, confirming the two are independent.
9. Filter `/orders` by the new "คืนเงิน" tab → shows only refunded orders with the orange badge.
10. Direct Data-API `POST`/`PATCH` on `/rest/v1/orders` with a fabricated `refunded_approved_by`
    (real anon key + real authenticated session, no admin shortcut) attempted both as a fresh
    INSERT and as an UPDATE on an existing order → both rejected by
    `prevent_direct_order_refund`, same exploit-proof methodology used for void order and
    discount.
11. Delete all disposable QA data (profiles, orders, order_items, shifts, tenants, auth
    identities/sessions/users) created for this test, confirming 0 rows remain.

- [ ] **Step 14: Commit**

```bash
git add supabase/migrations/20260818120000_order_refund.sql src/types/database.ts \
  src/app/actions/orders.ts src/lib/dal.ts "src/app/(shell)/pos/page.tsx" \
  "src/app/(shell)/orders/page.tsx" "src/app/(shell)/orders/[id]/page.tsx" \
  src/components/orders/orders-filter.tsx src/components/shifts/shift-panel.tsx \
  src/components/orders/refund-order-button.tsx
git commit -m "feat(orders): whole-bill refund with Manager/Owner PIN approval and shift cash impact"
```
