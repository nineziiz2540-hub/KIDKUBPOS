# Void Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a staff member cancel a whole order, gated by a Manager/Owner PIN entered as
in-modal approval, restricted to the currently open shift, with stock automatically restored.

**Architecture:** One new server action (`voidOrder`) does the whole write in one call: validate →
find an approving Manager/Owner by PIN (admin client, mirrors `switchToMember`'s existing
cross-profile PIN lookup) → update the order row (regular client, already permitted by
`orders_update_own_tenant` RLS) → best-effort stock restock via a new RPC. One new client
component (`VoidOrderButton`) owns its own open/closed modal state and wraps the existing
`PinPad` primitive — no new pages, no changes to the auth/session system.

**Tech Stack:** Same as the rest of the app — Next.js 16 Server Actions, `useActionState`,
Supabase (Postgres + PostgREST + RPC), bcryptjs. No test framework in this repo — verification is
manual live-browser QA, per every other feature built this session.

## Global Constraints

- Exact Thai copy strings below are final — use them verbatim, do not rephrase.
- No automated tests exist in this project (`package.json` has no test script) — do not add a
  test framework. Verify by running the app and clicking through it.
- The DB migration must be applied directly to the production Supabase project via the Supabase
  MCP `apply_migration` tool first (this project's established practice all session), *then*
  written to `supabase/migrations/` as a matching file, then regenerate
  `src/types/database.ts` via the MCP `generate_typescript_types` tool and overwrite the file
  wholesale (do not hand-edit it).
- Reuse the existing `PinPad` component (`src/components/ui/pin-pad.tsx`) and `Button`/`Label`
  components exactly as used elsewhere (e.g. `src/components/job-level/owner-tile.tsx`) — do not
  create new primitives.
- Modal styling must match the existing hand-rolled overlay pattern in
  `src/components/pos/qr-payment-modal.tsx` (`fixed inset-0 z-50 bg-black/50 flex items-center
  justify-center p-4` wrapping a `bg-white rounded-xl p-6 w-full max-w-sm` card) — this project has
  no dialog/modal library.
- Do not resolve `cancelled_by`/`cancelled_approved_by` to display names in v1 — `orders` will
  have two separate foreign keys to `profiles` after this migration, and PostgREST requires
  explicit `!constraint_name` disambiguation for embeds when a table has multiple FKs to the same
  target; skipping the join avoids that footgun for a first version. Just display the reason and
  timestamp.
- Do not query `getActiveShift` from the order detail page to conditionally hide the button —
  always show "ยกเลิกบิล" when `status !== "cancelled"` and let the server action be the single
  source of truth for the shift-window rule. This avoids adding a DB round-trip to every page view
  for a check the server enforces anyway.

---

### Task 1: Void Order feature (migration + action + UI)

**Files:**
- Create: `supabase/migrations/20260813160000_void_order.sql`
- Modify: `src/types/database.ts` (regenerate wholesale after migration — do not hand-edit)
- Modify: `src/app/actions/orders.ts`
- Create: `src/components/orders/void-order-button.tsx`
- Modify: `src/app/(shell)/orders/[id]/page.tsx`

**Interfaces:**
- Produces: `voidOrder(prevState: VoidOrderState, formData: FormData): Promise<VoidOrderState>`
  from `src/app/actions/orders.ts`, where
  `VoidOrderState = { error?: string; success?: boolean } | undefined`. `formData` fields:
  `order_id` (string), `reason` (string), `pin` (6-digit string).
- Produces: `VoidOrderButton({ orderId }: { orderId: string })` from
  `src/components/orders/void-order-button.tsx` — fully self-contained (owns its own open/closed
  state and the modal), takes no callbacks.
- Consumes: existing `PinPad` (`src/components/ui/pin-pad.tsx`,
  `{ length?: number; onComplete: (pin: string) => void; disabled?: boolean }`), existing `Button`
  and `Label` from `src/components/ui/`, existing `getProfile`/`getActiveShift` from
  `src/lib/dal.ts`, existing `createAdminClient` from `src/lib/supabase/admin.ts`.

- [ ] **Step 1: Apply the migration directly to the production Supabase project**

Use the Supabase MCP `apply_migration` tool (project id `khgahdjfkzpgsvbhfrqx`), name
`void_order`, with this exact SQL:

```sql
alter table public.orders
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles(id),
  add column cancelled_approved_by uuid references public.profiles(id),
  add column cancel_reason text;

comment on column public.orders.cancelled_at is
  'Timestamp the order was voided. Null unless status = ''cancelled''.';
comment on column public.orders.cancelled_by is
  'Profile that tapped "ยกเลิกบิล" — the acting staff member (whoever getProfile() resolved to).';
comment on column public.orders.cancelled_approved_by is
  'Profile whose PIN matched during the void approval modal. Always role owner or manager.';
comment on column public.orders.cancel_reason is
  'Required free-text reason entered in the void modal.';

create or replace function public.restock_for_voided_order(p_order_id uuid)
returns void
language plpgsql
as $$
declare
  r record;
  tenant uuid;
begin
  select tenant_id into tenant from orders where id = p_order_id;

  if tenant is null then
    raise exception 'Order not found: %', p_order_id;
  end if;

  for r in
    select
      oi.product_id,
      oi.quantity        as order_qty,
      pr.raw_material_id,
      pr.quantity_used
    from order_items oi
    join product_recipes pr
      on pr.product_id = oi.product_id
     and pr.tenant_id  = tenant
    where oi.order_id = p_order_id
  loop
    update raw_materials
    set
      current_stock = current_stock + (r.quantity_used * r.order_qty),
      updated_at    = now()
    where id = r.raw_material_id;

    insert into inventory_transactions
      (tenant_id, raw_material_id, type, quantity, note)
    values
      (tenant,
       r.raw_material_id,
       'void_restock',
       (r.quantity_used * r.order_qty),
       'Restock from voided order ' || p_order_id::text);
  end loop;
end;
$$;
```

- [ ] **Step 2: Write the same SQL to a migration file in the repo**

Create `supabase/migrations/20260813160000_void_order.sql` with the exact SQL from Step 1
(including the comments).

- [ ] **Step 3: Regenerate `src/types/database.ts`**

Call the Supabase MCP `generate_typescript_types` tool for project `khgahdjfkzpgsvbhfrqx` and
overwrite `src/types/database.ts` with the returned content in full (same procedure used earlier
this session — see `profiles.has_backup_password` / `create_tenant_and_owner` additions in git
history for the exact pattern). Verify afterward that `Database["public"]["Tables"]["orders"]["Row"]`
includes `cancelled_at`, `cancelled_by`, `cancelled_approved_by`, `cancel_reason`, and that
`Database["public"]["Functions"]` includes `restock_for_voided_order`.

- [ ] **Step 4: Add `voidOrder` to `src/app/actions/orders.ts`**

Replace the file's imports (top of file) with:

```ts
"use server";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile, getActiveShift } from "@/lib/dal";
import type { CreateOrderInput } from "@/types/app";
```

Then append this to the end of the file, after `createOrder`:

```ts
export type VoidOrderState = { error?: string; success?: boolean } | undefined;

export async function voidOrder(
  prevState: VoidOrderState,
  formData: FormData
): Promise<VoidOrderState> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบก่อน" };

  const orderId = formData.get("order_id");
  const reason = formData.get("reason");
  const pin = formData.get("pin");

  if (
    typeof orderId !== "string" ||
    typeof reason !== "string" ||
    typeof pin !== "string"
  ) {
    return { error: "ข้อมูลไม่ถูกต้อง" };
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
    .select("id, status, shift_id")
    .eq("id", orderId)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (!order) return { error: "ไม่พบบิลนี้" };
  if (order.status === "cancelled") return { error: "บิลนี้ถูกยกเลิกไปแล้ว" };

  const activeShift = await getActiveShift(profile.tenant_id);
  if (!activeShift || order.shift_id !== activeShift.id) {
    return { error: "ยกเลิกได้เฉพาะบิลในกะที่เปิดอยู่ตอนนี้" };
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

  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: profile.id,
      cancelled_approved_by: approverId,
      cancel_reason: reason.trim(),
    })
    .eq("id", orderId)
    .select("id");

  if (updateError || !updated || updated.length === 0) {
    console.error(
      "voidOrder: failed to update order:",
      updateError ?? "update matched 0 rows (RLS rejected or row missing)"
    );
    return { error: "ยกเลิกบิลไม่สำเร็จ" };
  }

  const { error: restockError } = await supabase.rpc("restock_for_voided_order", {
    p_order_id: orderId,
  });
  if (restockError) {
    console.error(
      "[voidOrder] restock_for_voided_order failed:",
      restockError.message
    );
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  return { success: true };
}
```

- [ ] **Step 5: Create `src/components/orders/void-order-button.tsx`**

```tsx
"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { voidOrder, type VoidOrderState } from "@/app/actions/orders";
import { PinPad } from "@/components/ui/pin-pad";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const MAX_PIN_ATTEMPTS = 5;

export function VoidOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [attempts, setAttempts] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, action, pending] = useActionState<VoidOrderState, FormData>(
    voidOrder,
    undefined
  );

  useEffect(() => {
    if (state?.success) {
      router.refresh();
      setIsOpen(false);
    }
  }, [state?.success, router]);

  useEffect(() => {
    if (state?.error === "PIN ไม่ถูกต้อง") {
      setAttempts((prev) => {
        const next = prev + 1;
        if (next >= MAX_PIN_ATTEMPTS) setIsOpen(false);
        return next;
      });
    }
  }, [state?.error]);

  function close() {
    setIsOpen(false);
    setReason("");
    setAttempts(0);
  }

  if (!isOpen) {
    return (
      <Button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full bg-white border border-destructive/40 text-destructive hover:bg-destructive/5"
      >
        ยกเลิกบิล
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4">
        <h2 className="text-lg font-bold text-sidebar text-center">ยกเลิกบิล</h2>

        <form ref={formRef} action={action} className="space-y-4">
          <input type="hidden" name="order_id" value={orderId} />
          <input type="hidden" name="pin" />

          <div className="space-y-1.5">
            <Label htmlFor="reason">เหตุผลที่ยกเลิก</Label>
            <textarea
              id="reason"
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={2}
              className="w-full rounded-md border border-input px-3 py-2 text-sm"
              placeholder="เช่น สั่งผิด, ลูกค้ายกเลิก"
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

- [ ] **Step 6: Wire the button and cancelled-state display into the order detail page**

In `src/app/(shell)/orders/[id]/page.tsx`, add the import:

```ts
import { VoidOrderButton } from "@/components/orders/void-order-button";
```

Extend the `OrderDetail` type (add two fields after `note`):

```ts
type OrderDetail = {
  id: string;
  order_number: string | null;
  payment_method: string;
  status: string;
  total: number;
  note: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  order_items: OrderItem[];
};
```

Update the `.select(...)` call to include the two new columns:

```ts
  const { data: order } = (await supabase
    .from("orders")
    .select(
      "id, order_number, payment_method, status, total, note, cancelled_at, cancel_reason, created_at, order_items(id, product_name, unit_price, quantity, subtotal)"
    )
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .single()) as { data: OrderDetail | null };
```

Replace the order-summary `<div className="rounded-lg border bg-white px-4 py-4 space-y-2">`
block (everything from that opening tag through its matching closing `</div>`) with:

```tsx
      <div className="rounded-lg border bg-white px-4 py-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">วิธีชำระ</span>
          <span className="font-medium text-sidebar">
            {PAYMENT_LABELS[order.payment_method] ?? order.payment_method}
          </span>
        </div>
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
        {order.note !== null && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">หมายเหตุ</span>
            <span className="font-medium text-sidebar text-right max-w-[60%]">
              {order.note}
            </span>
          </div>
        )}
        {order.status === "cancelled" && order.cancel_reason !== null && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">เหตุผลที่ยกเลิก</span>
            <span className="font-medium text-sidebar text-right max-w-[60%]">
              {order.cancel_reason}
            </span>
          </div>
        )}
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
        <div className="flex justify-between font-semibold text-sidebar pt-2 border-t border-border">
          <span>รวมทั้งหมด</span>
          <span className="tabular-nums">
            ฿{Number(order.total).toFixed(2)}
          </span>
        </div>
      </div>

      {order.status !== "cancelled" && <VoidOrderButton orderId={order.id} />}
```

- [ ] **Step 7: Type-check, lint, build**

Run:
```bash
npx tsc --noEmit
npm run lint
npm run build
```
Expected: all three clean (0 errors). Fix any mismatch between the regenerated
`src/types/database.ts` and the code above before proceeding — do not silence type errors with
`as any`.

- [ ] **Step 8: Manual live-browser verification**

Using disposable QA data (a test tenant/owner/manager/staff, a test order, deleted immediately
after — this project's established practice all session), verify on localhost via the Browser
pane at tablet size, per [[feedback_live_preview_ipad_standard]]:

1. Create a test order while a shift is open. Open its detail page → "ยกเลิกบิล" button visible.
2. Click it → modal opens. PinPad is disabled until reason text is entered (verify: tapping a
   digit does nothing while reason is empty; hint text shows).
3. Type a reason, enter a Staff member's own PIN → rejected with "PIN ไม่ถูกต้อง" (staff excluded
   from the approver set even though they have a real `pin_hash`).
4. Enter the test Manager's correct PIN → modal closes, page shows status "ยกเลิก", the reason and
   cancelled-at timestamp, "ยกเลิกบิล" button gone. Confirm in the DB directly (via
   `execute_sql`) that `cancelled_by`/`cancelled_approved_by` point to the right profiles and that
   the relevant `raw_materials.current_stock` increased back by the recipe amount, with a matching
   `inventory_transactions` row of `type = 'void_restock'`.
5. Reload `/orders` list → the voided order shows "ยกเลิก", and confirm the Dashboard's
   today's-sales total does **not** include it (proves the pre-existing `neq("status",
   "cancelled")` filters, unchanged by this task, work with a real cancelled row for the first
   time).
6. Attempt to void the same order again (revisit detail page) → button is gone (since status is
   now cancelled), confirming the UI-level guard; separately confirm server-side rejection by
   calling `voidOrder` again isn't reachable through the UI at all once cancelled (this is enough
   — no need to hand-craft a raw request to prove the belt-and-suspenders server check).
7. Close the shift, create a second test order in a **new** shift, then attempt to void the first
   (now shift-closed) order's... actually simpler: attempt to void an order whose `shift_id` does
   not match the currently active shift → rejected with "ยกเลิกได้เฉพาะบิลในกะที่เปิดอยู่ตอนนี้".
8. Submit the reason field empty (clear it via keyboard after typing, if the browser allows
   bypassing `required`) → confirm server-side rejection too, not just the client-side
   `required` attribute.
9. Delete all disposable QA data (profiles, orders, order_items, inventory_transactions rows,
   tenants, auth identities/sessions/users) created for this test, confirming 0 rows remain.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260813160000_void_order.sql src/types/database.ts src/app/actions/orders.ts src/components/orders/void-order-button.tsx "src/app/(shell)/orders/[id]/page.tsx"
git commit -m "feat(orders): void order with Manager/Owner PIN approval and stock restock"
```
