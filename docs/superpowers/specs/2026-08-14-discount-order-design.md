# Order Discount (ส่วนลด) — Design

## Problem

`createOrder` (`src/app/actions/orders.ts`) has no concept of a discount. `orders.total` is a flat
number, computed client-side from the cart (`sum(item.totalPrice)`) and inserted as-is — there is
no server-side floor tying it back to `order_items`. Every real POS competitor (Square, Toast,
Clover, Loyverse) lets staff knock a percentage or fixed amount off a bill, usually with a
supervisor-approval gate above some threshold to prevent revenue leakage.

This is the second of three related gaps identified in
[[project_login_joblevel_gap_analysis]] (after Void Order); refund remains out of scope and will
be a separate spec.

**Note on the pre-existing gap this feature does not fix:** `orders_insert_own_tenant`'s RLS has no
`WITH CHECK` beyond `tenant_id`/`created_by` — a malicious staff member could already forge
`total` to anything via a direct API call today, discount or not. This spec does not attempt to
close that (it would require validating `total` against `order_items` server-side, a materially
larger change unrelated to discounts). What this spec *does* guard, deliberately, is the new
**approval claim** this feature introduces (`discount_approved_by`) — see Data model below — for
the same reason Void Order's `cancelled_approved_by` needed a guard: an unprotected approval column
is a new, specific way to implicate an innocent Manager/Owner in an audit trail, not merely a
variant of the pre-existing `total` gap.

## Approach

Staff apply a discount in the cart, before checkout — not after the fact, and not per-line-item.
They pick **one** type (percent or fixed ฿ amount, not both) and type a value. Below a hardcoded
threshold (**discount > 20% of subtotal, or > ฿100, whichever is crossed first**) it applies
immediately with an optional reason. Crossing the threshold immediately opens a reason (required)
+ PIN modal — a Manager or Owner approves in-place, the same pattern Void Order uses: the device's
own logged-in identity (`worker_verified`) does not change, this is purely an approval check layered
on top of whoever is currently using the device. The modal appears as soon as the discount value
crosses the threshold, not deferred to the final "ชำระ" tap, so staff aren't surprised at checkout.

`orders.total` keeps its existing meaning end-to-end (the final, post-discount amount) — every
existing report/dashboard query in `src/lib/dal.ts` keeps working unchanged, same as Void Order's
`status = 'cancelled'` filter required no report changes. A new `subtotal` column holds the
pre-discount reference value.

## Data model changes

New columns on `public.orders`:
- `subtotal numeric not null default 0` — pre-discount sum of `order_items.subtotal` (what `total`
  used to represent)
- `discount_type text` — `'percent' | 'amount'`, null if no discount was applied
- `discount_value numeric` — the raw value staff typed (e.g. `10` for 10%, `20` for ฿20); null if
  no discount
- `discount_amount numeric not null default 0` — the resolved ฿ amount actually deducted, computed
  server-side (`subtotal * value / 100` for percent, `value` for amount) — reports/receipts read
  this regardless of which type was used, so nothing downstream needs to know about `discount_type`
- `discount_reason text` — required only when `discount_amount` crosses the approval threshold
- `discount_approved_by uuid references public.profiles(id)` — whose PIN matched during approval;
  null when the discount was under threshold (no approval needed)

New `BEFORE INSERT` trigger `prevent_direct_discount_approval` on `public.orders`: rejects any
insert that sets `discount_approved_by` to a non-null value when `auth.uid() is not null` (i.e.
any caller except service_role). Mirrors `prevent_direct_order_void` exactly (same remedy pattern
as the 2026-07-16 `profiles_update_own` fix and the 2026-08-14 Void Order fix). This is what forces
the "PIN was actually verified" claim to only ever originate from `createOrder`'s own server-side
bcrypt check, never from a forged direct insert.

No changes to `order_items`, `product_recipes`, or stock deduction — a discount changes money, not
what physically left the shelf.

## Data flow

```
POS cart (SmartCart), before checkout
  → staff opens discount input, picks percent|amount, types a value
  → client computes a preview discount amount from the client-side subtotal (display only —
    createOrder recomputes it server-side from trusted data, this is never trusted for the write)
  → preview crosses threshold?
      no  → optional reason field shown, staff can just checkout
      yes → reason (required) + PinPad shown immediately, staff must resolve this before "ชำระ"
             becomes usable
  → tap "ชำระ" → createOrder(data) where data now optionally carries
    { discountType, discountValue, discountReason, approverPin }
     → getProfile() → acting staff member
     → subtotal computed server-side from data.items (same reduce as today's `total` computation
       — this is the existing trust boundary, unchanged by this feature)
     → if discountType present:
        - validate discountValue: percent must be in (0, 100]; amount must be in (0, subtotal]
          → out of range: "ส่วนลดไม่ถูกต้อง"
        - discountAmount = percent ? subtotal * value / 100 : value
        - requiresApproval = discountAmount > 100 || (subtotal > 0 && discountAmount / subtotal > 0.20)
        - requiresApproval && reason.trim() === "" → "กรุณาระบุเหตุผลสำหรับส่วนลดนี้"
        - requiresApproval:
           → **admin client** fetches tenant profiles with role in ('owner','manager') and
             pin_hash is not null (same pattern voidOrder uses to read pin_hash — RLS blocks the
             regular client from seeing anyone else's pin_hash)
           → bcrypt.compare(approverPin, ...) against each candidate
              - no match → "PIN ไม่ถูกต้อง" (client caps at 5 attempts per modal open, then
                forces the modal closed and clears the discount — same as Void Order)
              - match → that profile's id becomes discount_approved_by
           → **admin client** inserts the order (service_role write — the only path exempt from
             `prevent_direct_discount_approval`, since it sets a non-null discount_approved_by)
        - !requiresApproval:
           → **regular client** inserts the order (discount_approved_by stays null, nothing to
             protect, same client as today's unmodified insert path)
     → else (no discount): **regular client** inserts the order exactly as today, with
       subtotal = total and all discount_* columns null/zero
     → rest of createOrder (order_items insert, stock deduction) unchanged
  → revalidatePath("/orders"), cart clears
  → order detail page shows subtotal / discount (type, value, amount) / reason / approved-by when
    present, and total as today
```

## Error handling

- Discount ≥ subtotal (amount type) or > 100% (percent type): rejected with a clear Thai message,
  validated both client-side (immediate feedback) and server-side (source of truth).
- Missing reason when the threshold is crossed: rejected client-side (required field once the
  modal appears) and re-validated server-side.
- Wrong PIN: generic "PIN ไม่ถูกต้อง", no hint about which accounts exist. Same per-modal-session
  cap of 5 attempts as Void Order — closes the modal and clears the pending discount back to
  editable state, forcing staff to reopen and retype it.
- No discount entered at all: identical behavior to today, `createOrder` unchanged on that path.

## Files touched

- New migration: adds the five `orders` columns and the `prevent_direct_discount_approval` trigger.
- `src/types/app.ts` — extend `CreateOrderInput` with optional `discountType` / `discountValue` /
  `discountReason` / `approverPin`.
- `src/app/actions/orders.ts` — extend `createOrder` with the discount computation, threshold
  check, and PIN-verification branch described above.
- `src/components/pos/smart-cart.tsx` — discount input (type toggle + value field), reason field,
  threshold-triggered PinPad modal (reusing `src/components/ui/pin-pad.tsx`, same component Void
  Order reuses), updated total display (subtotal → discount → total).
- `src/app/(shell)/orders/[id]/page.tsx` — render subtotal/discount/approved-by block when
  `discount_type` is present, same shape as the existing cancelled-reason block.
- `src/types/database.ts` — regenerate after the migration (new columns + updated `orders` types).

No changes to `src/lib/dal.ts` — every existing query filters/sums `total`, whose meaning is
unchanged. No changes to `restock_for_voided_order` or void-order code — orthogonal features.

## Testing

Manual live-browser verification (per [[feedback_live_preview_ipad_standard]]), disposable QA
tenant/accounts deleted immediately after, matching this project's established practice:
1. Apply a 10% discount (under threshold) → checkout succeeds with no PIN prompt, order detail
   shows subtotal/discount/total correctly, `discount_approved_by` is null.
2. Apply a 30% discount (over threshold) → PIN modal appears immediately; a Staff member's own PIN
   is rejected (role filter excludes staff from the approver candidate set); a Manager's PIN
   succeeds → order detail shows the approver's name.
3. Apply a fixed ฿150 discount (over the ฿100 leg of the threshold even though no percent was
   entered) → same approval gate triggers.
4. Attempt a ฿ discount larger than the subtotal → rejected client-side and re-verified rejected
   server-side (simulate via direct call bypassing the client check).
5. Enter 5 wrong PINs in one modal session → modal force-closes, discount cleared.
6. Direct Data-API `POST /rest/v1/orders` with a fabricated `discount_approved_by` (real anon key +
   real authenticated session, no admin shortcut) → rejected by
   `prevent_direct_discount_approval`, same exploit-proof methodology used for Void Order's
   `prevent_direct_order_void`.
7. Confirm Dashboard/shift-summary totals still sum correctly post-discount (proves `total`'s
   unchanged meaning holds under real data).

[[project_login_joblevel_gap_analysis]] [[project_void_order_feature]]
