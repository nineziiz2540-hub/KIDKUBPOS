# Shift management (จัดการกะ) — Round B

Agreed with the user on 2026-10-21 through brainstorming with live mockups
(`.superpowers/brainstorm/1648-1792576250/content/shift-overview.html`, `shift-float-v2.html`,
`shift-recount-v3.html`). This is round B of the roadmap from the PaynEat comparison
(`project_payneat_comparison` memory). Round A (order history) shipped in c5df68c.

## Why

The shop is a café running KIDKUBPOS on an iPad Air 5 in landscape (Safari about 1180×740). One
shift per day: the shop opens, a shift is opened; the shop closes, the shift is closed. There is
no hand-over between people in the middle of the day.

How the drawer works today (user's words, paraphrased):

- **Closing.** About 30 minutes after the shop closes, the owner counts the cash in the drawer,
  then compares the number with the system. After that they clean up. In future a manager or a
  staff member will do the count instead of the owner.
- **What stays overnight.** Once the count matches, the owner leaves **฿1,000** in the drawer as
  change for the next day (100s, 20s and coins) and takes the rest to the bank. The cash stays
  in the drawer overnight.
- **Opening.** Whoever opens (the owner today, later a manager or staff) counts what was left in
  the drawer and enters it as the opening cash.
- **Topping up change.** Sometimes the drawer runs short of change and someone puts in their own
  money. The user didn't know how the system should handle that.
- **Emergency buys.** Milk or ice runs out and someone takes cash from the drawer to buy more.

The user also confirmed earlier (round A brainstorm) that these cash problems happen: wrong
change, taking cash out of the drawer without recording it, forgetting to open a shift, and
copying the expected amount instead of really counting.

Problems in the current code and database:

- **Cash sales without a shift.** `createOrder` attaches the open shift "best-effort"
  (`src/app/actions/orders.ts`, step 5). If no shift is open, a cash sale is saved with
  `shift_id = null` and never appears in any drawer. 1 of the shop's 5 cash bills has no shift.
- **The expected amount is shown before counting.** `ShiftPanel`
  (`src/components/shifts/shift-panel.tsx`) shows "เงินสดที่ควรมีในลิ้นชัก" right above the
  "เงินสดที่นับได้จริง" box, so whoever closes can type the expected number and the variance is
  always 0.
- **No history.** `/shifts` shows only the current shift. After closing, the variance shows once
  in local state and is gone. There is no way to look at yesterday's shift.
- **The shifts table is unprotected.** Its only RLS policy is `tenant_isolation` (`ALL`, no
  `WITH CHECK`), and `authenticated` has INSERT/UPDATE/DELETE. Any tenant member, including
  Staff, can use the Data API to change `opening_cash`, rewrite `variance` or
  `closing_cash_counted` after closing, reopen a closed shift, delete a shift, or open a second
  shift.
- **More than one open shift is possible.** There is no unique index on open shifts per tenant
  and no CHECK on `status`. `getActiveShift` uses `.maybeSingle()`, which returns nothing when
  two rows match, so a second open shift silently turns every sale into a no-shift sale.
- **Races with closing.** `closeShift` reads the summary, then updates the row, with no lock.
  A cash sale, a cash refund, or a payment-method change (`order_change_payment_method` checks
  `status = 'open'` without a lock) that lands between those two steps is left out of the
  snapshotted expected cash.
- **No record of cash in/out of the drawer.**
- **The page is old.** Small text, `max-w-lg`, not sized for the iPad like round A pages.

Current production data: the real tenant ("The Connect Brew&Bar") has **one shift**, status
`open`, opened 2026-07-08 with opening cash ฿3,000 and 14 orders. The shop has not been closing
shifts daily yet. See **Rollout**.

## Goals

1. A cash payment is only possible while a shift is open, enforced by the server and the
   database, not only the UI.
2. Whoever counts never sees the system's number before entering their count, both at opening
   and at closing. If the count doesn't match, they recount once; the second count is final.
3. Cash going in or out of the drawer for any reason other than a sale or a refund is recorded
   with an amount, a reason, who did it and when.
4. Closing tells the counter how much to leave in the drawer for tomorrow and how much to take
   to the bank.
5. The owner (and a manager) can look back at any past shift without being in the shop: who
   opened and closed it, the counts, the differences, the movements, and export to Excel.
6. The shifts data can only change through the app's own steps.
7. Staff use it with the fewest possible steps. Every step asks for one number.

## Non-goals

- Several shifts in one day or a mid-day hand-over (it keeps working technically, as today, but
  is not designed for).
- Counting by denomination (number of 1000s, 500s, …). One total only.
- Branches or several drawers. The float setting is per tenant; a tenant is one shop today.
- PIN approval for cash in/out (user's decision: speed matters; accountability is by name).
- Printing a Z-report (no printer yet).
- Editing or deleting a closed shift or a recorded movement.
- Offline mode.

## Anti-goals (would make this a failure even if it works)

- Extra taps or screens for staff during the rush.
- Any place where the expected cash is visible to the person counting before they count.
- Anything that lets a record be silently changed or removed afterwards.
- Long messages. The user asked for short, plain wording.

## Decisions (made by the user)

- **One shift per day**, opened at opening, closed at closing.
- **Blind count at opening and at closing**, with **one recount** if the first count doesn't
  match. If the second count still doesn't match, the second count is entered as the real
  amount and the difference is recorded.
- **Overnight float.** The amount left in the drawer at closing is a **tenant setting** (the
  shop uses ฿1,000), owner-editable, so that future branches can choose their own. At each
  closing the counter can change it **for that night only**. The system calculates the bank
  deposit as counted − float.
- **Opening is compared with what was left in the drawer last night** (the previous shift's
  actual float, not the tenant setting). A difference is recorded as an **overnight difference**,
  separate from the day's variance. **Both** the person who closed last night and the person who
  opened this morning are named as responsible for it.
- **Closing is compared with the day's expected cash** = opening cash (morning count) + cash
  sales + cash in − cash out − cash refunds to customers. Not with last night's float.
- **Cash in/out of the drawer:** anyone (staff, manager, owner) can record it, **no PIN**, for
  speed in emergencies (milk or ice runs out). The person who **opened the shift** is
  responsible for the day's variance.
- **Personal money** used as change is recorded as cash in ("เงินส่วนตัวเติมเงินทอน"); taking
  it back is cash out ("คืนเงินส่วนตัว"). The system reminds that personal money is still in the
  drawer.
- Also agreed (proposed by Claude, accepted by the user):
  - **Owner and manager** see the live expected cash during the day; **staff never do**. (The
    first proposal was owner-only. The user changed it: a manager acts for the owner and is
    accountable, and a shop that wants to grow and open branches must be able to rely on its
    managers. Control comes from the record, not from hiding: every count attempt is saved with a
    name, and the owner reviews the history.) The closing screen still asks for the count first
    for everyone, managers included.
  - When a count doesn't match, an **optional note** can be added.
  - A closed shift cannot be edited.
  - **Shift history** is visible to owner and manager, not staff.
  - Each movement records who recorded it and when. A mistaken entry is fixed by recording the
    opposite movement with the reason "แก้รายการที่กดผิด"; nothing is edited or deleted.

## The day, step by step

Screen texts below are the agreed Thai wording; keep them short.

### 1. Opening (no shift open)

`/shifts` shows one card: **"นับเงินในลิ้นชักก่อนเปิดร้าน"**, one large amount box (empty, not
pre-filled), button **"ตรวจยอด"**. Nothing about last night's amount is shown before the count.

- Count matches last night's float → **"ตรงกับเงินที่เหลือไว้เมื่อคืน ✓"**, button
  **"เปิดกะ"**.
- Doesn't match → **"ขาด ฿50 · นับอีกครั้ง"** (or **"เกิน ฿50 · นับอีกครั้ง"**), a new empty box
  for the second count, button "ตรวจยอด".
  - Second count matches → "ตรงแล้ว ✓", "เปิดกะ".
  - Still doesn't match → **"ขาด ฿50 · บันทึกแล้ว"**, an optional note box, "เปิดกะ". The second
    count becomes the opening cash.
- No previous closed shift (first shift ever, or the last shift was closed before this
  feature) → there is nothing to compare with: after "ตรวจยอด" go straight to "เปิดกะ" with no
  match message; overnight difference is not recorded.

The opening cash is always the final count, so the day's expected cash starts from what is
really in the drawer.

### 2. During the day

**POS, no open shift:** tapping cash payment opens a dialog: **"ยังไม่ได้เปิดกะ"** /
"ต้องเปิดกะก่อนรับเงินสด" with **"ไปเปิดกะ"** (goes to `/shifts`) and **"ชำระด้วยโอนแทน"**
(switches the payment to transfer and continues to the PromptPay QR). The POS header badge
"ยังไม่เปิดกะ" stays as it is today. Transfer sales do not need a shift (they don't touch the
drawer); they still attach to the open shift when there is one, as today.

**`/shifts`, shift open:**

- Header line: "เปิดกะโดย {name} · {HH:MM}".
- Two large buttons: **"＋ เงินเข้าลิ้นชัก"** and **"－ เงินออกลิ้นชัก"**.
- If personal money is still in the drawer for this shift (sum of personal top-ups − sum of
  personal returns > 0): warning line **"เงินส่วนตัวยังอยู่ในลิ้นชัก ฿500"**.
- List of this shift's movements, newest first: time, reason, note, who, amount (+ green / −
  red).
- **Owner and manager only:** a small summary with cash sales, transfer sales, refunds, cash
  in/out and "เงินสดที่ควรมีในลิ้นชัก". Staff do not see the expected cash or the cash-sales
  total (the cash total plus the movements would give the expected amount away). Staff may see
  the bill count and the transfer total.
- The closing step ก never shows the expected amount, whatever the role.
- Unpaid held bills note and the "ปิดกะ" entry button.

**Movement dialog:** amount box, reason chips, optional note box, "บันทึก".

| Direction | Reason code | Chip text | Note |
|---|---|---|---|
| in | `personal_topup` | เงินส่วนตัวเติมเงินทอน | optional |
| in | `other_in` | อื่นๆ | required |
| in/out | `correction` | แก้รายการที่กดผิด | required |
| out | `purchase` | ซื้อของเข้าร้าน | optional |
| out | `personal_return` | คืนเงินส่วนตัว | optional |
| out | `other_out` | อื่นๆ | required |

### 3. Closing

Tapping "ปิดกะ" shows step ก: **"นับเงินสดทั้งหมดในลิ้นชัก"**, one empty box, "ตรวจยอด". The
expected amount is not on screen.

- If unpaid held bills exist, the existing warning and second confirmation stay.
- If personal money is still in the drawer, the warning line shows here too, so it can be
  taken back (as a "คืนเงินส่วนตัว" movement) before counting.

After "ตรวจยอด", the same match / recount / "บันทึกแล้ว" flow as opening, compared with the
expected cash. The result shows three lines: นับได้ / ระบบคิดว่าควรมี / ส่วนต่าง (ตรง, ขาด ฿x,
เกิน ฿x).

Step ข (float and deposit):

- **"เก็บไว้เป็นเงินทอนพรุ่งนี้"**: editable amount, pre-filled with the tenant's float
  setting. If the setting differs from what is typed, a small line says "ค่าปกติของร้าน ฿1,000".
- **"นำไปฝากธนาคาร"**: calculated live = final count − float.
- If the final count is less than the float setting: float is pre-filled with the whole count,
  deposit ฿0, and a line says **"เงินทอนขาดอีก ฿200 · เติมก่อนเปิดร้าน"**.
- The float must be between 0 and the final count.
- Optional note (shared with the count note if one was already typed).
- **"ยืนยันปิดกะ"**. After success: a short confirmation with the deposit amount and a link to
  the shift's summary for owner/manager; for staff, back to the "open a shift" card.

**The shift is not frozen while counting (Claude's call).** Sales, movements and refunds can
still happen between "ตรวจยอด" and "ยืนยันปิดกะ" (the count usually happens 30 minutes after
closing, so this is rare). Instead, `shift_close` refuses if the expected cash has changed since
the latest count, and the UI shows **"มีรายการเงินสดใหม่ระหว่างนับ · นับอีกครั้ง"** with a new
empty box. A count that was started and then abandoned (dialog closed, page reloaded) stays
recorded as an attempt.

**The recount rule is enforced by the server (Claude's call).** `shift_close` accepts only when
the latest closing attempt was compared with the current expected cash **and** either it matched
or there are at least two attempts. There is no hard cap on attempts (a cash change during
counting needs a fresh count), but every attempt is listed in the summary. `/shifts` reads the
saved attempts of the open shift and resumes where the counter left off: after one mismatched
attempt it shows the second-count box; after a match or two attempts it shows step ข.

### 4. History (owner and manager)

**`/shifts/history`**: shifts newest first, one row each: date (Bangkok), opened by / closed
by, cash sales, variance (ตรง / ขาด ฿x red / เกิน ฿x), overnight difference when there is one,
open shifts marked "เปิดอยู่". Paginated (do not load every shift in one query; the Supabase
API caps responses at 1,000 rows). Button **"ส่งออกไฟล์ Excel (CSV)"** for a chosen month.

**`/shifts/[id]`** (ใบสรุปกะ):

- Opened by + time; closed by + time.
- Opening: count(s), last night's float, overnight difference, responsible people (last night's
  closer + this morning's opener), note.
- Sales: cash, transfer, bill count; cash refunds.
- Movements list (same as during the day) with totals in / out.
- Closing: count(s) ("นับ 2 ครั้ง ฿5,670 / ฿5,670"), expected, variance, responsible (opener;
  closer shown too when different), note.
- Float left and deposit.
- Each count attempt is listed, so any "probing" is visible.

**CSV** (UTF-8 with BOM so Excel shows Thai): one row per shift in the chosen month. Columns:
date, opened at, opened by, closed at, closed by, last night's float, opening count, overnight
difference, cash sales, transfer sales, cash refunds, cash in, cash out, expected, closing
count, variance, float left, deposit, notes.

Staff opening `/shifts/history` or `/shifts/[id]` are redirected to `/shifts`.

### Settings

Settings page (owner only, already owner-gated): new field **"เงินทอนที่เก็บไว้ในลิ้นชักข้ามคืน"**
(baht, 0 to 100,000). Default for every tenant: ฿1,000.

## Data model

All money is `numeric(10,2)`; app-side arithmetic in satang (`src/lib/cash.ts` `toSatang`).

### `tenants`

- `cash_float_default numeric(10,2) not null default 1000`, check 0–100,000.

### `shifts` (new columns, all nullable for old rows)

- `opening_expected` — last night's float, or null if there was no closed shift to compare with.
- `opening_difference` — final opening count − `opening_expected` (null when no comparison).
- `opening_note text`.
- `previous_shift_id uuid` → shifts(id), the shift whose float was compared.
- `closing_note text`.
- `float_left numeric` — cash left in the drawer at closing.
- `deposit_amount numeric` — `closing_cash_counted − float_left`.
- `opening_cash` keeps meaning "cash in the drawer at the start" = final opening count.
  `closing_cash_counted`, `expected_cash`, `variance` keep their meaning (final count; expected
  at close; final − expected).
- `CHECK (status in ('open','closed'))`.
- Unique partial index: one `open` shift per tenant.
- Consistency checks for closed shifts written by the new flow (for example
  `0 <= float_left <= closing_cash_counted`, `deposit_amount = closing_cash_counted - float_left`),
  written so the old rows with nulls still pass.

### `shift_cash_counts` (new, append-only)

One row per count attempt: `id`, `tenant_id`, `shift_id`, `stage` (`opening` | `closing`),
`attempt` (1, 2, …), `amount`, `expected` (the number it was compared with; null at opening when
there is nothing to compare), `created_by`, `created_at` (`clock_timestamp()`).

Closing attempts are written when "ตรวจยอด" is tapped, before the result is shown, so the
first number someone typed can never be replaced. Opening attempts are stored when the shift is
opened (see the limitation below).

### `cash_movements` (new, append-only)

`id`, `tenant_id`, `shift_id`, `direction` (`in` | `out`), `reason` (codes in the table above),
`amount` (> 0, ≤ 100,000), `note` (≤ 200 chars; required for `other_in`, `other_out`,
`correction`), `created_by`, `created_at` (`clock_timestamp()`).

### Expected cash

```
expected = opening_cash
         + Σ total of orders in this shift where payment_method = 'cash'
             and status in ('completed','refunded')          -- as getShiftSummary today
         − Σ total of orders refunded in this shift (refund_shift_id) with refund_method = 'cash'
         + Σ cash_movements in
         − Σ cash_movements out
```

The existing comment in `getShiftSummary` explains why refunded orders still count as sales of
their own shift. One pure function computes this for both the server and the database result
checks; it gets unit tests.

## Writes and protection

Same pattern as round A's order adjustments: service-role-only plpgsql functions
(`SECURITY INVOKER`, called from server actions through the admin client, EXECUTE revoked from
public/anon/authenticated, granted to service_role), each taking `FOR UPDATE` on the shift row so
everything that changes a drawer is serialised.

- `shift_open(tenant, actor, counts[], note)` — rejects if a shift is open; finds the previous
  closed shift; stores the shift, the opening count rows, `opening_expected`,
  `opening_difference`.
- `shift_record_closing_count(tenant, shift, actor, amount)` — shift must be open; computes
  expected under the lock; inserts the attempt; returns expected and difference.
- `shift_close(tenant, shift, actor, float_left, note)` — needs at least one closing count;
  recomputes expected under the lock; final count = the latest closing attempt; validates float;
  stores everything and sets `closed`.
- `shift_add_cash_movement(tenant, shift, actor, direction, reason, amount, note)` — shift must
  be open.
- Actors must belong to the tenant and not be deactivated (as in round A's
  `20261021140000_order_adjustments_active_approver`).

Shifts table: replace `tenant_isolation` (ALL) with a SELECT-only policy for tenant members
(staff still need to read the active shift); revoke INSERT/UPDATE/DELETE from
anon/authenticated. New tables: SELECT policy for tenant members, no write grants, plus a
trigger rejecting UPDATE/DELETE so append-only does not depend on grants alone (round A deferred
this for `order_adjustments`).

Orders:

- **Insert guard (trigger):** if `payment_method = 'cash'`, `shift_id` must be the tenant's open
  shift; any non-null `shift_id` must be the same tenant's **open** shift. The check locks the
  shift row (`FOR SHARE`) so it waits for a concurrent close. This blocks cash sales without a
  shift through the Data API too, and closes the race with closing.
- `createOrder`: for cash, no open shift → `{ error: "ยังไม่ได้เปิดกะ กรุณาเปิดกะก่อนรับเงินสด" }`
  before the order and queue numbers are generated (so a rejected attempt burns no number).
- **Cash refunds:** the write that sets `refund_shift_id` must also find that shift open under a
  share lock (trigger on the refund update), so a refund cannot land in a shift being closed.
- **Payment-method change:** `order_change_payment_method` takes the share lock on the shift row
  instead of a plain `exists`. A bill with **no shift** can no longer be changed **to cash**
  (Claude's call): it would create a cash sale outside any drawer. Message:
  "บิลนี้ขายตอนไม่ได้เปิดกะ เปลี่ยนเป็นเงินสดไม่ได้". Cash → transfer stays allowed.
- **Void:** cancelling a cash bill changes the drawer too. `voidOrder` already requires the
  bill's shift to be the open one (app check, no lock); the database write must also find that
  shift open under the share lock (trigger on entering `cancelled`), like refunds.

Server actions validate input before calling the functions (amounts, reason codes, note length,
float range) and map function errors to short Thai messages, in the style of
`src/lib/order-adjustment-errors.ts`.

## Who can do what

| | Staff | Manager | Owner |
|---|---|---|---|
| Open / close a shift, record counts | ✓ | ✓ | ✓ |
| Cash in / out | ✓ | ✓ | ✓ |
| See live expected cash on `/shifts` | — | ✓ | ✓ |
| Dashboard (unchanged: cash/transfer split etc.) | — | ✓ | ✓ |
| See the count result after "ตรวจยอด" | ✓ | ✓ | ✓ |
| Shift history, summaries, CSV | — | ✓ | ✓ |
| Change the float setting | — | — | ✓ |

Role comes from `profile.role` as elsewhere.

## UI notes

- Built for 1180×740: large text (round A sizes: 26px page title, 16–18px body, h-12+ buttons),
  amount boxes `inputMode="decimal"`, numbers `tabular-nums`, Bangkok times through
  `src/lib/bangkok-time.ts`.
- Colors from the existing status tokens (success / warning / destructive).
- The count flow is a client component with a small state machine (count1 → result → count2 →
  result → float/deposit → done). The expected number reaches the client **only** in the
  response to "ตรวจยอด".
- Sidebar: "Shifts" stays visible to all roles; history is reached from `/shifts` (link shown to
  owner/manager).

## Known limitations (Claude's calls)

**Blind count is a screen rule, not a data rule.** Staff can still read `orders` through the Data
API (needed by the app today) and so could add up cash bills. Tightening order reads is outside
this round. The goal is that staff cannot just copy the number from a screen. Managers can see
it (user's decision, see Decisions); the closing screen still asks them to count first.

At opening, nothing is secret: last night's float was seen by whoever closed and is usually the
shop standard. So the opening check does not write an attempt row until the shift is opened;
someone could try numbers before tapping "เปิดกะ". The closing check, where the expected cash
is secret, records every attempt immediately.

## Rollout

Dev and production share one Supabase database, and the deployed app writes shifts with the
user's own client. Locking the shifts table or adding the cash-needs-a-shift insert guard before
the new code is live would break opening/closing and cash sales in the shop. So the database
work ships in two migrations:

1. **Additive** (safe to apply during development): new columns, tables, functions, setting.
   The old code ignores them.
2. **Lock-down** (apply right after the new code is deployed and verified): shifts policies and
   grants, the orders insert guard, the refund guard, the method-change lock, the unique open
   index and the status CHECK.

The existing open shift from 2026-07-08 (opening ฿3,000, 14 orders) is the user's own test
data. The user will clear test data (orders, shifts, etc.) before the shop goes live; that
clean-up is a separate task, not part of this round. The migrations must not touch that shift,
and the new code must work with it (an old open shift with none of the new columns can be closed
with the new flow). Shifts closed by the old code (no `float_left`) are skipped as "nothing to
compare with" at the next opening.

## Testing

- **Unit tests** (`node --test`, as in round A): expected-cash calculation, float/deposit
  calculation (including count < float), difference labels (ตรง / ขาด / เกิน), personal-money
  outstanding, reason/note validation, CSV builder (BOM, Thai, escaping, Bangkok dates).
- **Database test** (`supabase/tests/`, a DO block that rolls back, like
  `order_adjustments_test.sql`): every function's happy path and errors; one open shift per
  tenant; append-only tables; Data-API writes to shifts rejected; cash order insert without an
  open shift rejected; insert into a closed shift rejected; refund, void and method change against a
  closed shift rejected; no-shift bill changed to cash rejected; `shift_close` refused after the
  expected cash changed since the latest count, and refused after one mismatched attempt.
- **Live check** on a disposable QA tenant (never the real tenant), dev server with `TZ=UTC`
  (`kidkubpos-dev-utc`), Browser pane at 1180×740: the whole day as owner, then as staff
  (no expected cash visible, no history), recount paths, float change, count < float,
  POS cash without a shift, personal-money warning, history + CSV download, Data-API attacks
  as staff. Clean up the QA tenant afterwards.

## Left to the builder

- Exact component split, file names and routes beyond `/shifts`, `/shifts/history`,
  `/shifts/[id]`.
- Function names and error codes (keep the round A style).
- How the POS dialog is wired into the existing payment flow.
- History page size and month picker style.
