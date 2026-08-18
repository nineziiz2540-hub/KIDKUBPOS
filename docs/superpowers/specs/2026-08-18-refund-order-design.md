# Order Refund (คืนเงิน) — Design

## Problem

`src/app/actions/orders.ts` has no way to refund a completed order after the fact. Real POS
competitors (Square, Toast, Clover, Loyverse) all support this as a distinct action from voiding —
a void corrects a same-session mistake before a shift closes; a refund handles a customer return
or complaint that can surface hours, days, or shifts later, after the sale has already been
reconciled and possibly consumed.

This is the third and final gap of the three identified in
[[project_login_joblevel_gap_analysis]]'s Group 1 backlog. [[project_void_order_feature]] and
[[project_discount_feature]] both shipped earlier; both spec's own scope notes deliberately
excluded refund as a separate effort, since it has a materially different data-flow shape (an
after-the-fact action spanning shifts, not an in-session correction).

## Approach

A Staff member (or Manager/Owner) taps "คืนเงิน" on a **completed** order's detail page — available
regardless of which shift the order belongs to, or whether that shift is still open. This opens a
modal requiring: a refund method (cash / transfer / card — independently selectable, not assumed
to match the order's original `payment_method`, since small cafés commonly hand back cash
regardless of how the customer originally paid), a typed reason, and a Manager/Owner PIN entered
in-place — the same in-place approval pattern void and discount both use, and unconditionally
required every time (no threshold, unlike discount — a refund is definitionally a full reversal of
revenue, closer in risk profile to a void than to a routine discount).

Refunding writes a new `status = 'refunded'` — deliberately **not** reusing void's `'cancelled'`
value, since the two represent different real-world events with different eligibility windows and
different business meaning to the owner (a void indicates an order-entry mistake; a refund
indicates a customer-facing return, often a product-quality signal worth tracking separately). A
refunded order is excluded from sales/reporting queries the same way a cancelled order is.

Unlike void, a refund does **not** automatically restock materials — by the time a refund happens,
the drink has typically already been made and served (often consumed), unlike a same-session void
where the order may not have been prepared yet at all. Automatic restock would silently overstate
inventory in the common case. (Staff can still adjust stock manually via the existing Inventory
page if a specific refund genuinely returned unopened product — out of scope for this feature.)

**Shift cash impact:** a cash refund physically removes money from whichever till is open *at the
moment the refund happens* — not the original sale's shift, which may already be closed and
reconciled. The refund therefore records its own `refund_shift_id` (the currently active shift at
refund time), and `getShiftSummary` subtracts cash refunds tagged to a shift from that shift's
`totalCash`/`expectedCash`. Because this only makes sense when a physical drawer is open, refunding
via `cash` requires an open shift to exist; refunding via `transfer`/`card` does not (no physical
drawer implication).

## Data model changes

New columns on `public.orders`:
- `refunded_at timestamptz` — null unless refunded
- `refunded_by uuid references public.profiles(id)` — who tapped "คืนเงิน" (acting staff member)
- `refunded_approved_by uuid references public.profiles(id)` — whose PIN matched during approval
- `refund_reason text` — required free-text reason
- `refund_method text` — `'cash' | 'transfer' | 'card'`, independent of the order's original
  `payment_method`
- `refund_shift_id uuid references public.shifts(id)` — the shift open at the moment of refund
  (null if refunded via transfer/card with no shift open); distinct from the existing `shift_id`
  column, which continues to mean "the shift the original sale belonged to"

`orders_status_check` extended to also allow `'refunded'` (alongside the existing `'completed'` /
`'cancelled'`).

New `BEFORE INSERT OR UPDATE` trigger `prevent_direct_order_refund` on `public.orders` — mirrors
`prevent_direct_order_void` and `prevent_direct_discount_approval`/`prevent_direct_discount_update`
exactly (both trigger timings from day one, not added after a review catches the gap this time):
rejects any non-service_role write that sets `status` to `'refunded'` or touches any
`refunded_*`/`refund_*` column.

## Data flow

```
Order detail page (/orders/[id]), status === "completed"
  → tap "คืนเงิน"
  → modal: refund method (cash/transfer/card buttons) + reason textarea (required) + PinPad
  → refundOrder(orderId, refundMethod, reason, approverPin)
     → getProfile() → acting staff member
     → fetch order by id + tenant_id
        - not found / wrong tenant → generic error
        - status === "cancelled" → "บิลนี้ถูกยกเลิกไปแล้ว ไม่สามารถคืนเงินได้"
        - status === "refunded" → "บิลนี้ถูกคืนเงินไปแล้ว"
     → reason.trim() === "" → "กรุณาระบุเหตุผล"
     → if refundMethod === "cash": getActiveShift(tenant_id); no active shift →
       "ต้องเปิดกะก่อนจึงจะคืนเงินสดได้" (transfer/card skip this check entirely)
     → **admin client** fetches tenant profiles with role in ('owner','manager') and
       pin_hash is not null, bcrypt.compare against each candidate
        - no match → "PIN ไม่ถูกต้อง" (client caps at 5 attempts per modal open, same as void)
        - match → that profile is the approver
     → **admin client** (required — `orders_update_own_tenant`'s RLS has no `WITH CHECK`, so a
       regular-client write here would be exactly the kind of forgeable approval
       `prevent_direct_order_refund` exists to block; see Data model changes above) update
       orders set
       status='refunded', refunded_at=now(), refunded_by=<staff>.id,
       refunded_approved_by=<approver>.id, refund_reason=reason,
       refund_method=refundMethod, refund_shift_id=<active shift id, or null>
       where id = orderId and tenant_id = ... and status = 'completed'
       (the `status = 'completed'` filter closes the same double-action race void's fix
       addressed — a concurrent void and refund on the same order can't both win)
     → revalidatePath(`/orders/${orderId}`), revalidatePath("/orders")
  → modal closes, page shows status = คืนเงิน + reason + method + timestamp
```

`getShiftSummary(tenantId, shiftId)` gains a second query: sum `total` for orders where
`refund_shift_id = shiftId` and `refund_method = 'cash'` (regardless of that order's own
`shift_id` — it may belong to a different, already-closed shift), and subtract that sum from
`totalCash`/`expectedCash`.

## Error handling

- Refunding an already-cancelled or already-refunded order: rejected with a specific Thai message
  per case, not a generic failure.
- Empty reason: rejected client-side (required field) and re-validated server-side.
- Cash refund with no shift open: rejected — a deliberate policy boundary (mirrors void's
  shift-window boundary in spirit, though the underlying constraint here is physical: there is no
  open drawer to remove cash from).
- Wrong PIN: generic "PIN ไม่ถูกต้อง", 5-attempt client-side cap closes the modal, matching void
  and discount's existing convention.
- Concurrent void + refund on the same order: the final UPDATE's `status = 'completed'` filter
  ensures only the first one to land succeeds; the loser sees a "already
  cancelled"/"already refunded" message on retry (same class of race-safety void's own fix added).

## Files touched

- New migration: adds the six `orders` columns, extends `orders_status_check`, adds
  `prevent_direct_order_refund` (BEFORE INSERT OR UPDATE).
- `src/app/actions/orders.ts` — add `refundOrder` action; extend `voidOrder`'s existing
  `status === "cancelled"` guard to also reject `status === "refunded"` (mutual exclusivity).
- `src/lib/dal.ts` — every one of the 12 existing `.neq("status", "cancelled")` call sites (order
  lists, dashboard totals, category sales, customer history, etc.) extended to also exclude
  `'refunded'`; `getShiftSummary` gains the cash-refund-subtraction query described above.
- `src/app/(shell)/pos/page.tsx` — today's-order-count query, same filter extension.
- `src/app/(shell)/orders/[id]/page.tsx` — add the "คืนเงิน" button (shown only when
  `status === "completed"`), render refund method/reason/timestamp when `status === "refunded"`,
  and extend the existing status label logic (`สำเร็จ`/`ยกเลิก`) to a third case (`คืนเงิน`).
- `src/app/(shell)/orders/page.tsx` — the order-list filter tabs gain a `"refunded"` option
  alongside the existing `"cancelled"` one; status badge rendering extended for the third state.
- New component `src/components/orders/refund-order-button.tsx` — reason textarea + refund-method
  selector + `PinPad` (reused), wired to `refundOrder` via `useActionState`, following
  `void-order-button.tsx`'s existing structure and modal styling.
- `src/types/database.ts` — regenerate after the migration.

No changes to `src/lib/supabase/admin.ts`, `restock_for_voided_order`, or any discount code —
orthogonal features sharing only the PIN-verification pattern.

## Testing

Manual live-browser verification (per [[feedback_live_preview_ipad_standard]]), disposable QA
tenant/accounts deleted immediately after:
1. Refund a completed order with cash while a shift is open, valid Manager PIN + reason → status
   becomes `refunded`, order disappears from Dashboard/report totals, and the open shift's
   `getShiftSummary` cash total drops by the refunded amount.
2. Attempt a cash refund with no shift open → rejected with the "ต้องเปิดกะก่อน" message.
3. Refund via transfer/card with no shift open → succeeds (no shift requirement for non-cash).
4. Attempt to refund an already-cancelled order → rejected. Attempt to void an already-refunded
   order → rejected (mutual exclusivity both directions).
5. Attempt to refund the same order twice → second attempt rejected.
6. Staff member's own PIN as approver → rejected (role filter, same as void/discount).
7. Direct Data-API `PATCH`/`POST` on `orders` with a fabricated `refunded_approved_by` (real anon
   key + real authenticated session, no admin shortcut) → rejected by
   `prevent_direct_order_refund`, same exploit-proof methodology used for void and discount.
8. Refund an order originally paid by `transfer` back as `cash` → confirms `refund_method` is
   independently selectable, not coupled to the order's original `payment_method`.

[[project_login_joblevel_gap_analysis]] [[project_void_order_feature]] [[project_discount_feature]]
