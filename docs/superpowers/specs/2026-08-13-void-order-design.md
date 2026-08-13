# Void Order (ยกเลิกบิล) — Design

## Problem

Every real POS competitor (Square, Toast, Clover, Loyverse) lets staff cancel a mistaken sale, and
gates that action behind a supervisor's approval. KIDKUBPOS has **no way to cancel an order at
all** — `src/app/actions/orders.ts` only has `createOrder`. Mistakes (wrong item, customer changed
their mind, out of stock discovered after ringing up) currently have no correction path.

The groundwork is unexpectedly already half-built: `orders.status` already supports a `"cancelled"`
value, and every reporting/dashboard query in `src/lib/dal.ts` (10+ call sites) already excludes
`status = "cancelled"`. Nothing has ever written that value — this feature closes that gap rather
than starting from zero.

This is the first of three related gaps identified in a broader Login/Job-Level vs. market-POS
comparison (see [[project_login_joblevel_gap_analysis]]); discount and refund are deliberately out
of scope here and will be separate specs.

## Approach

A Staff member (or Manager/Owner) can tap "ยกเลิกบิล" on an order's detail page. This opens a modal
requiring two things before anything is written: a typed reason, and a Manager/Owner's PIN entered
as an in-place approval — the device's own logged-in identity (`worker_verified`) does not change,
this is purely an approval check layered on top of whoever is currently using the device. This
mirrors how Square/Toast gate voids: the acting staff member doesn't need supervisor-level access
themselves, they just need a supervisor physically present to approve.

Voiding is restricted to orders belonging to the **currently open shift** — once a shift is closed
and its cash has been reconciled, retroactively voiding an order would silently invalidate that
reconciliation. This scope also keeps v1 simple: whole-order void only, no partial line-item void
(that's a materially harder problem — recomputing `total`, deciding whether it changes the order's
category-based sales stats — and can be a follow-up once whole-order void has been used in
production for a while).

Voiding reverses the stock deduction that `createOrder` made via `deduct_stock_for_order`, using a
new mirror RPC, and records who initiated the void, who approved it, and why — the minimum audit
trail this specific action needs, without waiting on the general-purpose audit log feature from the
gap analysis backlog.

## Data model changes

New columns on `public.orders`:
- `cancelled_at timestamptz` — null unless voided
- `cancelled_by uuid references public.profiles(id)` — who tapped "ยกเลิกบิล" (the acting staff
  member, i.e. whoever `getProfile()` resolves to at the time)
- `cancelled_approved_by uuid references public.profiles(id)` — whose PIN matched during approval
- `cancel_reason text` — required free-text reason

New RPC `public.restock_for_voided_order(p_order_id uuid)` — mirrors
`deduct_stock_for_order`'s join across `order_items` → `product_recipes`, but adds the quantity
back to `raw_materials.current_stock` instead of subtracting, and logs a `inventory_transactions`
row per material with `type = 'void_restock'` and a positive quantity (mirroring the existing
`'deduct'` type's negative-quantity convention).

**Known limitation to accept for v1, not fix here:** `deduct_stock_for_order` clamps stock at zero
(`GREATEST(0, current_stock - deducted)`), so if a raw material was already low when the sale
happened, the true deduction was less than the recipe calls for. `restock_for_voided_order` restores
the recipe's full quantity regardless, which can over-restock in that specific edge case. This
mirrors the existing deduction's own "best-effort" framing (`createOrder` already doesn't block on
stock errors) and is a pre-existing class of imprecision, not a new one introduced by this feature.

## Data flow

```
Order detail page (/orders/[id]), status !== "cancelled"
  → tap "ยกเลิกบิล"
  → modal: reason textarea (required) + PinPad (existing component, reused)
  → voidOrder(orderId, reason, approverPin)
     → getProfile() → the acting staff member (current worker_verified identity)
     → fetch order by id + tenant_id
        - not found / wrong tenant → generic error
        - already status === "cancelled" → "บิลนี้ถูกยกเลิกไปแล้ว"
        - order.shift_id is null, or != getActiveShift(tenant_id)?.id
          → "ยกเลิกได้เฉพาะบิลในกะที่เปิดอยู่ตอนนี้"
     → reason.trim() === "" → "กรุณาระบุเหตุผล"
     → **admin client** (service_role, same pattern `switchToMember` already uses to
       read other members' pin_hash — `profiles_select_own` RLS blocks the regular
       client from seeing anyone else's `pin_hash`) fetches all profiles in this
       tenant with role in ('owner','manager') and pin_hash is not null
     → bcrypt.compare(approverPin, ...) against each candidate
        - no match → "PIN ไม่ถูกต้อง" (client-side caps at 5 attempts per modal
          open, then forces the modal closed — see Error handling)
        - match → that profile is the approver
     → **regular client** (already permitted — `orders_update_own_tenant` RLS allows
       any authenticated member to update any order row in their own tenant, no
       owner/manager restriction at the row-security layer; the PIN check above is
       what actually gates this) update orders set status='cancelled',
       cancelled_at=now(), cancelled_by=<staff>.id,
       cancelled_approved_by=<approver>.id, cancel_reason=reason
       — verified via .select("id") like the project's other silent-RLS-rejection-
         aware writes (resetOwnPinViaPassword, setBackupPassword)
     → **regular client** rpc('restock_for_voided_order', { p_order_id }) — mirrors
       `deduct_stock_for_order`'s security model (no explicit SECURITY DEFINER, runs
       as the caller; `raw_materials`/`inventory_transactions` both have a
       tenant-scoped `ALL`-command RLS policy so this works under the caller's own
       privileges) — best-effort, logs on failure, never blocks the cancellation
       itself (same convention as the original deduct)
     → revalidatePath(`/orders/${orderId}`), revalidatePath("/orders")
  → modal closes, page shows status = ยกเลิก + reason + who cancelled/approved
```

## Error handling

- Double-void (already cancelled): rejected with a clear Thai message, not a generic failure.
- Outside the current open shift, or no shift open at all: rejected — this is a deliberate policy
  boundary from this spec, not an incidental limitation.
- Empty reason: rejected client-side (required field) and re-validated server-side.
- Wrong PIN: generic "PIN ไม่ถูกต้อง", no hint about which accounts exist or how close the guess
  was. A **per-modal-session** cap of 5 attempts (component state, not persisted) closes the modal
  and forces staff to reopen it — deliberately simpler than the per-profile
  `pin_failed_attempts`/`pin_locked_until` lockout used elsewhere, because this check tests a PIN
  against *multiple* candidate profiles at once and there's no single profile whose counter should
  be charged for a non-match. Threat model: this is an insider (already an authenticated staff
  member on a trusted device) trying to skip getting real approval, not an anonymous internet
  attacker — the existing PIN space plus this soft cap is judged sufficient for v1.
- Stock reversal RPC failure: logged via `console.error`, does not block the void from completing
  (matches `createOrder`'s existing best-effort stance on `deduct_stock_for_order`).

## Files touched

- New migration: adds the four `orders` columns and the `restock_for_voided_order` RPC.
- `src/app/actions/orders.ts` — add `voidOrder` action.
- `src/app/(shell)/orders/[id]/page.tsx` — add the "ยกเลิกบิล" button (hidden once
  `status === "cancelled"`) and render `cancelled_at`/`cancel_reason`/who-approved when present.
- New component, e.g. `src/components/orders/void-order-modal.tsx` — reason textarea + `PinPad`
  (reused from `src/components/ui/pin-pad.tsx`), wired to `voidOrder` via `useActionState`.
- `src/types/database.ts` — regenerate after the migration (new columns + RPC signature).

No changes to `src/proxy.ts`, the `worker_verified` cookie, or any existing PIN-verification action
— the approval check is fully self-contained inside `voidOrder`.

## Testing

Manual live-browser verification (per [[feedback_live_preview_ipad_standard]]), using disposable
QA tenant/accounts deleted immediately after, matching this project's established practice:
1. Create a test order while a shift is open → void it with a valid Manager PIN + reason → status
   flips to `cancelled`, reason/approver visible on the detail page, order disappears from
   Dashboard/report totals (proves the pre-existing `neq("status","cancelled")` filters work without
   any changes there), raw material stock is restored.
2. Attempt to void the same order again → rejected ("already cancelled").
3. Attempt with a Staff member's own PIN as the "approval" PIN → rejected (role filter excludes
   staff from the approver candidate set even though they have a real `pin_hash`).
4. Close the shift, then attempt to void an order that belonged to it → rejected
   ("เฉพาะกะที่เปิดอยู่").
5. Submit with an empty reason → client-side validation blocks submit.
6. Enter 5 wrong PINs in one modal session → modal force-closes.

[[project_login_joblevel_gap_analysis]]
