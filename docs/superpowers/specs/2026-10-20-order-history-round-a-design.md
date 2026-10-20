# Order history (ประวัติบิล) — Round A

Agreed with the user on 2026-10-20 through brainstorming with a live mockup
(`.superpowers/brainstorm/947-1792511222/content/orders-layout.html`). This is round A of the
roadmap that came out of the PaynEat comparison (`project_payneat_comparison` memory). Round B
(shift management) comes next and is out of scope here.

## Why

The shop is a café running KIDKUBPOS on an iPad Air 5 in landscape (Safari about 1180×740). The
busy window is 11:00–14:00. Staff go back to old bills for two reasons (user's words):

1. **Refunds.** A customer comes back and asks for a refund. Staff identify the bill by the
   **time** and the **queue number**.
2. **Transfers that never arrived.** Sometimes a bill is closed as "โอน" (transfer) but the
   customer never actually transferred. The owner reconciles by walking the system's transfer
   bills in time order against incoming money in the bank app, matching amount and time. A bill
   with no matching bank entry means the money never came. Today nothing can be done to that
   bill, so the system's transfer total stays higher than the bank account forever.

The user also confirmed that during the rush, staff sometimes record the wrong payment method
(cash ↔ transfer), which makes the cash drawer short and the transfer total high even though no
money is missing.

Problems found in the current code (`src/app/(shell)/orders/page.tsx`,
`src/app/(shell)/orders/[id]/page.tsx`):

- **Times are 7 hours early in production.** These are server components that call
  `toLocaleString("th-TH", …)` with no `timeZone`. Vercel runs in UTC, so a 10:15 bill shows as
  03:15. It looks right on localhost because the dev PC is on Bangkok time. Verified by rendering
  the same instant under both clocks. The same pattern exists in other places (list below).
- **Old bills disappear after 1,000 bills.** The list loads every order of the tenant in one
  query with no limit. The Supabase API caps responses at 1,000 rows, so once the shop passes
  1,000 bills (about 10 days at 100 bills/day) older bills silently stop appearing, and the
  page gets heavier every day.
- **Hard to find a bill.** The only filters are all/cash/transfer/cancelled/refunded. No date,
  no search by queue or bill number, no totals.
- **"Who did what" is stored but not shown.** `orders` already has `created_by`,
  `discount_approved_by`, `cancelled_by`, `cancelled_approved_by`, `refunded_by`,
  `refunded_approved_by`, `customer_id`, `shift_id`. The detail page shows none of them.

## Goals

1. **Day-based list.** The page opens on today's bills (Bangkok day). The user can step a day
   back/forward (◀ ▶) and pick any date. Only the selected day is loaded.
2. **Find a bill fast.** A search box matches the queue number within the selected day, or a
   bill number. Each row shows the closing time large (HH:MM), the queue number, a short item
   summary (for example "ลาเต้เย็น, ครัวซองต์"), the amount, and the status.
3. **Filter chips with counts** for the selected day: ทั้งหมด · เงินสด · โอน · ยกเลิก / คืนเงิน ·
   ไม่ได้รับเงิน.
4. **Day summary** at the top: net sales, cash, transfer, and "ไม่ได้รับเงิน" (shown in red when
   non-zero). The transfer figure is the one the owner compares with the bank app.
5. **Transfer check.** In the โอน view each transfer bill has a "เจอเงินแล้ว" (found the money)
   toggle and a progress line ("ตรวจยอดโอนแล้ว 15 จาก 18 บิล · เหลือ 3 บิล"). Unchecked bills
   stand out. The ticks are saved in the database so they survive a refresh, another device, or
   coming back the next day. Only owner/manager can tick or untick.
6. **New status "ไม่ได้รับเงิน" (payment not received)** for a transfer bill whose money never
   arrived. Owner/manager PIN + a reason are required. The bill stays in history with a red
   badge, who marked it, when, and why. It stops counting as revenue everywhere. Stock is **not**
   returned (the drink was made and handed over), which is what makes it different from
   ยกเลิกบิล (void), which restocks.
7. **Change payment method ("แก้ช่องทางชำระ")** cash ↔ transfer on a completed bill. Owner/manager
   PIN + a reason are required. Every change is recorded (from, to, who did it, who approved, when,
   reason). The open shift's cash figures follow the change.
8. **Bill detail shows people.** Who sold it, who approved the discount, who voided/refunded/
   marked not-received/changed the method and who approved each, the linked customer (name,
   linking to the customer page), and the full payment-method change history.
9. **Bangkok time everywhere.** Every date/time shown in the app is formatted in
   `Asia/Bangkok`, regardless of the server's clock.

## Non-goals

- Shift work (round B): requiring an open shift to take cash, blind cash count, shift history,
  Z-report, cash in/out of the drawer, protecting the `shifts` table.
- An app-wide audit log for non-bill events (price edits, role changes, shift open/close). Round
  B lays that foundation. This round only records bill-level actions.
- Receipt printing and tax invoices (the shop has no printer and is not VAT-registered).
- Bank/slip integration or automatic transfer matching. The check stays manual, just easier.
- Deleting bills. The user asked whether a not-received bill could be deleted; we agreed bills
  are never deleted (a deletable bill lets someone pocket cash and erase the evidence).
- CSV export (later).

## Anti-goals (would be a failure even if it "works")

- A not-received or method-changed bill still counted somewhere: Dashboard, sales reports,
  shift summary, customer totals, POS "today" counters. Every revenue number must agree.
- Any of the new actions doable by a Staff account straight through the Supabase Data API
  without the PIN (this class of bypass was found and fixed for void, discount, and refund).
- Times correct on localhost but wrong on Vercel. Verification must run with the server clock in
  UTC.
- Controls too small for the iPad. Keep the POS standard used in products round 2: tap targets
  ≥ 44–48px, body text ≥ 15–16px, no overflow at 1180×740 with the sidebar at 224px or 64px.

## Constraints

- **Shared database.** Dev and production use the same Supabase project
  (`khgahdjfkzpgsvbhfrqx`). Migrations go live immediately and must keep the deployed (old) code
  working. Adding a status value is safe as long as only QA tenants ever hold it before the new
  code ships.
- **Never touch the real tenant** "The Connect Brew&Bar". Test only on disposable QA tenants and
  clean them up.
- **`payment_method`, `total`, `shift_id` can only be written by service role** (trigger
  `prevent_direct_order_financial_tamper`, migration `20260818130000`). The method change must
  verify the PIN in the server action and then write through the admin (service-role) client,
  following how `voidOrder`/`refundOrder` in `src/app/actions/orders.ts` already work.
- **Status guards.** The existing triggers block a non-service-role write from entering or
  leaving `cancelled`/`refunded`. `unpaid` needs the same guard: entering it, leaving it, and
  touching any of its who/when/why columns must require service role. The transfer-check columns
  need a guard too, so only the owner/manager path can set them.
- **Revenue queries use a denylist today.** `src/lib/dal.ts` and `src/app/(shell)/pos/page.tsx`
  filter with `.neq("status","cancelled").neq("status","refunded")` (lines ~164, ~212, ~1083,
  ~1140), and `getShiftSummary` (~1001) excludes only `cancelled`. A new status would silently
  count as revenue. Every such query must exclude `unpaid`. Prefer switching revenue queries to
  an allowlist (`status = 'completed'`, plus `refunded` where a function intentionally includes
  it) so a future status can't leak in. `getShiftSummary`'s deliberate inclusion of `refunded`
  (comment at ~1002) must be kept.
- **Status CHECK.** `orders_status_check` currently allows `completed, voided, cancelled,
  refunded`. Add `unpaid`. `voided` has never been used by any code. Dropping it in the same
  migration is the builder's call; check that no row holds it first.
- **Row cap.** One day of a café is far below 1,000 bills, but the day query must not fail
  silently. If a day returns the cap, show a visible notice. Use the same care as the earlier
  fan-out fix (`project_order_item_fanout_fix` memory) when fetching item names for the rows.
- **Next.js 16 in this repo differs from older versions.** Read `node_modules/next/dist/docs/`
  for anything routing/searchParams related before writing it (AGENTS.md).
- Regenerate `src/types/database.ts` after migrations.

## Decided behaviour

### Day and time

- The selected day is a Bangkok calendar day: `[YYYY-MM-DDT00:00+07:00, next day)`. Default is
  today in Bangkok, computed on the server, never from the server's local clock.
- State lives in the URL (`?date=YYYY-MM-DD&filter=…&q=…`) so the back button from a bill
  detail returns to the same day, filter and search.
- All display goes through one shared formatter module that always passes
  `timeZone: "Asia/Bangkok"`. Known places to switch over (sweep with a grep for `toLocale`):
  `orders/page.tsx`, `orders/[id]/page.tsx` (created, cancelled, refunded, held-bill history),
  `customers/[id]/page.tsx`, `components/pos/held-bills-panel.tsx`,
  `components/pos/pos-header.tsx`, `components/products/archived-products-section.tsx`,
  `components/settings/deactivated-members-section.tsx`. Client components count too: they are
  also rendered on the server first.
- The existing Bangkok range math in `dal.ts` and `(shell)/page.tsx` already uses explicit
  `+07:00` and is correct. Consolidating it is optional, not required.

### List rows and search

- Sorted newest first (the bank app also lists newest first).
- The row shows the time as HH:MM in Bangkok. Queue number "คิว N" if present, else the bill
  number. Item summary (first items, truncated). Amount. A status badge only when the bill is
  not a normal completed sale (ยกเลิก, คืนเงิน, ไม่ได้รับเงิน); a completed bill shows its method
  (เงินสด/โอน).
- Search: digits only, so it matches the queue number within the selected day. Anything that
  looks like a bill number matches `order_number` (exact or prefix) across all days. The exact
  bill-number format is in `generate_order_number`.

### Filters and summary

| Chip | Shows (selected day) |
|---|---|
| ทั้งหมด | every bill |
| เงินสด | `completed`, method cash |
| โอน | `completed`, method transfer — the transfer-check view |
| ยกเลิก / คืนเงิน | `cancelled` or `refunded` |
| ไม่ได้รับเงิน | `unpaid` |

Summary numbers for the selected day:

- **ยอดขายสุทธิ** = sum of `completed` totals. It must equal what the Dashboard reports for the
  same day.
- **เงินสด** / **โอน** = `completed` totals split by method. The โอน figure is the one to compare
  with the bank app.
- **ไม่ได้รับเงิน** = sum of `unpaid` totals, red when non-zero.
- Edge case for the bank comparison (my call): a transfer bill that was later refunded
  (especially refunded in cash) still had its money arrive in the bank. The โอน view shows a
  short line under the progress, for example "บิลโอนที่คืนเงินแล้ววันนี้ 1 บิล ฿85 (เงินเคยเข้า
  บัญชี)", so the owner isn't confused when the bank shows more than the โอน figure.
- The page keeps today's access rules (every role that can open ประวัติบิล today can still open
  it and see the summary). Only the new actions and the ticks are owner/manager.

### Transfer check ("เจอเงินแล้ว")

- Appears only on `completed` transfer bills, in the โอน view (and may also appear on the
  detail page).
- Toggling records `transfer_verified_at` / `transfer_verified_by` (names are the builder's
  call); untoggling clears them. Owner/manager only, enforced server-side.
- Changing a bill's method away from transfer clears its tick. Marking it not-received keeps
  the bill out of the โอน view, so the progress line counts `completed` transfer bills only.

### "ไม่ได้รับเงิน" (status `unpaid`)

- Allowed only from `completed` with method `transfer`. Cash was physically received, so it
  can't be "not received". A cash bill recorded wrongly gets a method change first.
- Needs a reason (required text) and an owner/manager PIN, using the same PIN pad component and
  5-wrong-attempt lockout pattern as `void-order-button.tsx`.
- Allowed whether or not the bill's shift is still open (the owner usually reconciles later).
  Transfer money never touches the drawer, so closed shifts' cash figures are unaffected.
- Records who pressed, who approved, when, and why (mirrors the `cancelled_*` columns).
- No restock.
- Excluded from every revenue/count figure in the app (see constraints).
- One-way in this round, unless the user decides otherwise (see open question).

### "แก้ช่องทางชำระ" (payment method change)

- Allowed only on `completed` bills (not on cancelled, refunded or unpaid).
- Allowed only while the bill's shift is still the open shift, or when the bill has no shift.
  Reason: a closed shift's expected cash and variance are already snapshotted. Changing the
  method afterwards would leave that reconciliation silently wrong. This matches the rule
  `voidOrder` already enforces. The UI explains why when the button is unavailable.
- Needs an owner/manager PIN and a reason.
- Each change is appended to a history that can't be edited or deleted: order, from, to, who
  pressed, who approved, when, reason. A bill can be changed more than once. Recommendation (the
  builder's call): a small append-only table with RLS select for the tenant and no direct
  write grants, written only by the service-role path. Shape it so round B's audit log can grow
  out of it.
- `cash_received`/`change_amount` stay as recorded (they describe what happened at the till). When
  a bill moves to transfer, the detail page hides the cash-tendered lines.
- The open shift's summary follows automatically, because `getShiftSummary` reads the live
  method.

### Bill detail

- Header: bill number, queue, full Bangkok date/time.
- People section: ขายโดย, อนุมัติส่วนลดโดย, ยกเลิก/คืนเงิน/แจ้งไม่ได้รับเงินโดย + อนุมัติโดย,
  customer (link). Names come from `profiles.full_name` and must also show for deactivated
  members. The builder must check that profiles RLS lets every role allowed on this page read
  those names. If it doesn't, resolve the names server-side without widening RLS.
- Actions on a `completed` bill: คืนเงิน and ยกเลิกบิล (existing), แก้ช่องทางชำระ (new),
  ไม่ได้รับเงิน (new, transfer only). All four require the manager/owner PIN.
- Payment-method change history listed under the summary when present.

## Verification expected

- DB-level checks on a QA tenant: allowed transitions succeed, disallowed ones raise; Staff
  direct Data-API writes to the new status/columns/table are rejected; revenue functions
  exclude `unpaid`; the shift summary follows a method change; no restock on `unpaid`.
- Live checks in the browser pane at 1180×740 with the dev server's clock forced to UTC
  (`TZ=UTC`), to prove the times are right the way Vercel would render them.
- Dashboard day total equals the order-history day summary for the same day on test data with
  every status present.
- No overflow at sidebar 224px and 64px.

## Left to the builder

- Column/table names, RPC vs server-action split, component breakdown.
- Exact chip/summary visuals within the iPad sizing standard and the mockup's layout.
- Item-summary truncation length.
- Whether to drop `voided` from the CHECK.
