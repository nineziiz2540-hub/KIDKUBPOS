# Shift Management Round B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shift the control of the cash drawer: blind opening/closing counts with one recount, cash in/out records, float and bank-deposit calculation, cash sales only with an open shift, shift history with a summary and CSV, and a shifts table that can only change through the app.

**Architecture:** Two migrations. **A (additive, applied in Task 2)** adds the float setting, new shift columns (including close-time total snapshots), two append-only tables (`shift_cash_counts`, `cash_movements`), a one-open-shift index, and service-role-only plpgsql functions that lock the shift row (`FOR UPDATE`) for every drawer-changing step. **B (lock-down, written and tested in a rolled-back transaction in Task 8, applied only after the new code is deployed)** removes Data-API writes to shifts and adds an unconditional orders trigger that locks the shift row (`FOR SHARE`) for cash inserts, cash voids and cash refunds. Server actions validate input, then call the functions through the admin client (round A pattern). Pure logic lives in alias-free modules tested with `node --test`.

**Tech Stack:** Next.js 16 (server components, server actions, one route handler), Supabase Postgres/RLS, Tailwind v4, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-21-shift-management-round-b-design.md`

## Global Constraints

- Shared DB (`khgahdjfkzpgsvbhfrqx`): every applied migration is live at once and must keep the deployed (old) code working. **Migration B must not be applied during this plan.** Only Task 8 runs it, inside a transaction that aborts.
- Never touch the real tenant "The Connect Brew&Bar" or its open shift from 2026-07-08. Test on disposable QA tenants, then delete them. Delete `cash_movements` and `shift_cash_counts` rows before `shifts` (FKs are `on delete restrict`).
- Money is `numeric(10,2)`; app arithmetic in satang (`toSatang` from `src/lib/cash.ts`). Limits: count 0–1,000,000; movement amount > 0 and ≤ 100,000; float setting 0–100,000 (default 1000); note ≤ 200 chars.
- Expected cash = opening_cash + cash sales (status `completed`/`refunded`, this shift) − cash refunds (`refund_shift_id` = this shift, `refund_method = 'cash'`, status `refunded`) + cash in − cash out. Computed in SQL only (`shift_totals`), never re-derived in TS.
- Visibility: staff never receive the expected cash or the cash-sales total in any page payload before their own closing count. Owner and manager see the live summary. History, summary pages and CSV are owner/manager only (staff → redirect `/shifts`). Float setting is owner only.
- Count rule: opening and closing both ask for the count first. A mismatch asks for one recount; the second count is final. At closing, the server refuses to close unless the latest attempt was compared with the current expected cash and (it matched or there are ≥ 2 attempts).
- Thai copy, exact strings:
  - Opening: `นับเงินในลิ้นชักก่อนเปิดร้าน`, `ตรวจยอด`, `เปิดกะ`, `ตรงกับเงินที่เหลือไว้เมื่อคืน ✓`, `ตรงแล้ว ✓`, `{label} · นับอีกครั้ง`, `{label} · บันทึกแล้ว` where label is `ขาด ฿50` / `เกิน ฿50`.
  - Movements: `＋ เงินเข้าลิ้นชัก`, `－ เงินออกลิ้นชัก`, `บันทึก`, `เงินส่วนตัวยังอยู่ในลิ้นชัก ฿500`, header `เปิดกะโดย {name} · {HH:MM}`. Reason chips: `เงินส่วนตัวเติมเงินทอน`, `ซื้อของเข้าร้าน`, `คืนเงินส่วนตัว`, `แก้รายการที่กดผิด`, `อื่นๆ`.
  - Closing: `นับเงินสดทั้งหมดในลิ้นชัก`, `นับได้`, `ระบบคิดว่าควรมี`, `ส่วนต่าง`, `ตรง`, `มีรายการเงินสดใหม่ระหว่างนับ · นับอีกครั้ง`, `เก็บไว้เป็นเงินทอนพรุ่งนี้`, `ค่าปกติของร้าน ฿1,000`, `นำไปฝากธนาคาร`, `เงินทอนขาดอีก ฿200 · เติมก่อนเปิดร้าน`, `ยืนยันปิดกะ`.
  - POS: `ยังไม่ได้เปิดกะ`, `ต้องเปิดกะก่อนรับเงินสด`, `ไปเปิดกะ`, `ชำระด้วยโอนแทน`; server error `ยังไม่ได้เปิดกะ กรุณาเปิดกะก่อนรับเงินสด`.
  - Method change: `บิลนี้ขายตอนไม่ได้เปิดกะ เปลี่ยนเป็นเงินสดไม่ได้`.
  - History: `ส่งออกไฟล์ Excel (CSV)`, open shift tag `เปิดอยู่`. Settings field: `เงินทอนที่เก็บไว้ในลิ้นชักข้ามคืน`.
- Every displayed date/time goes through `src/lib/bangkok-time.ts`.
- iPad sizing (round A standard): page title 26px, body ≥ 15px, tap targets ≥ 48px, amount inputs `inputMode="decimal"` and ≥ 22px text, `tabular-nums`; no overflow at 1180×740 with the sidebar at 224px and at 64px. Status colours from the success/warning/destructive tokens.
- Read `node_modules/next/dist/docs/` before writing the route handler (Task 7) and before touching `searchParams` (AGENTS.md).
- After applying a migration, patch `src/types/database.ts` by hand for the new columns/tables/functions (a full regenerate reverts round 2's optional `sort_order` on Insert).

## Review Focus

1. A cash sale (or movement, or refund) lands between "ตรวจยอด" and "ยืนยันปิดกะ": closing must be refused and the counter asked to count again, never saved with a variance the screen didn't show. Pinned by DB keys in Task 2 and the `closingStep` tests in Task 1.
2. The counter reloads the page or closes the tab after a mismatched first closing count: `/shifts` must resume at the second count, not offer a fresh first count. Pinned by `closingStep` tests (Task 1) and a live check (Task 9).
3. Closing on a slow day where the count is below the float setting: float pre-fills with the whole count, deposit ฿0, shortfall shown. Pinned by `planFloat` tests (Task 1).
4. Amounts typed the way people type them on an iPad (`1,000`, ` 950 `, `45.5`, `45.555`, `-5`, empty): accepted or rejected consistently on client and server. Pinned by `parseAmount` tests (Task 1), used by every amount box and every action.
5. A staff member's page never contains the expected cash before their own count (checked in the rendered HTML/RSC payload, not only on screen). Live check in Task 9.

---

### Task 1: Pure shift logic, error messages, Bangkok month range

**Files:**
- Create: `src/lib/shift-math.ts`, `src/lib/shift-math.test.ts`, `src/lib/shift-errors.ts`, `src/lib/shift-errors.test.ts`
- Modify: `src/lib/bangkok-time.ts`, `src/lib/bangkok-time.test.ts`

**Interfaces:**
- **Produces** (`src/lib/shift-math.ts`, no `@/` imports; may import `./cash.ts`):
  - `MAX_COUNT = 1_000_000`, `MAX_MOVEMENT = 100_000`, `MAX_FLOAT = 100_000`, `NOTE_MAX = 200`
  - `type MovementDirection = "in" | "out"`
  - `type MovementReason = "personal_topup" | "purchase" | "personal_return" | "correction" | "other_in" | "other_out"`
  - `MOVEMENT_REASONS: Record<MovementReason, { label: string; directions: MovementDirection[]; noteRequired: boolean }>` — labels exactly as Global Constraints (`other_in`/`other_out` both `อื่นๆ`; `correction` allows both directions).
  - `parseAmount(raw: string, max?: number): number | null` — trims, strips commas and spaces, accepts `^\d+(\.\d{1,2})?$`, rejects > `max` (default `MAX_COUNT`); returns baht.
  - `type CountComparison = { kind: "none" } | { kind: "match" } | { kind: "short" | "over"; amount: number }`
  - `compareCount(counted: number, expected: number | null): CountComparison` (satang compare; `null` expected → `none`)
  - `differenceLabel(c: CountComparison): string` → `ตรง` | `ขาด ฿20` | `เกิน ฿5` (amount via `formatBaht` style: no decimals when whole, else 2)
  - `type ClosingAttempt = { amount: number; expected: number }`
  - `closingStep(attempts: ClosingAttempt[], expectedNow: number): "count1" | "count2" | "recount_changed" | "float"` — none → `count1`; latest.expected ≠ expectedNow → `recount_changed`; latest matched → `float`; ≥ 2 attempts → `float`; else `count2`. Same rule as SQL `shift_close`.
  - `planFloat(counted: number, floatDefault: number): { floatLeft: number; deposit: number; shortfall: number }`
  - `depositFor(counted: number, floatLeft: number): number | null` (null when floatLeft < 0 or > counted)
  - `personalOutstanding(movements: { reason: string; amount: number }[]): number` — max(0, Σ personal_topup − Σ personal_return)
  - `validateMovement(input: { direction: string; reason: string; amount: number; note: string }): string | null` — Thai error or null.
- **Produces** (`src/lib/shift-errors.ts`): `shiftErrorMessage(raw: string): string`, fallback `ทำรายการไม่สำเร็จ`. Codes → messages:
  `shift_not_found` ไม่พบกะนี้ · `shift_closed` กะนี้ปิดไปแล้ว กรุณารีเฟรชหน้า · `shift_already_open` มีกะที่เปิดอยู่แล้ว · `recount_required` ยอดไม่ตรง กรุณานับอีกครั้ง · `expected_changed` มีรายการเงินสดใหม่ระหว่างนับ · นับอีกครั้ง · `count_required` กรุณานับเงินก่อนปิดกะ · `invalid_amount` จำนวนเงินไม่ถูกต้อง · `invalid_float` เงินทอนที่เก็บไว้ต้องไม่เกินยอดที่นับได้ · `invalid_reason` เหตุผลไม่ถูกต้อง · `note_required` กรุณาเขียนหมายเหตุ · `invalid_counts` ข้อมูลการนับไม่ถูกต้อง · `forbidden` ไม่มีสิทธิ์ทำรายการนี้
- **Produces** (`bangkok-time.ts`): `bangkokMonthRange(month: string): { start: string; end: string } | null` for `YYYY-MM`; `bangkokMonth(iso: string): string` (`YYYY-MM` in Bangkok).

- [ ] **Step 1: Write failing tests.**
  - `parseAmount`: `"1,000"`→1000, `" 950 "`→950, `"45.5"`→45.5, `"45.555"`→null, `"-5"`→null, `""`→null, `"1000001"`→null, `parseAmount("100001", MAX_MOVEMENT)`→null, `"0"`→0.
  - `compareCount(5670, 5690)` deep-equals `{kind:"short", amount:20}`; `(5695, 5690)` → over 5; `(85.5, 85.5)` → match; `(1000, null)` → none. `differenceLabel` of those: `"ขาด ฿20"`, `"เกิน ฿5"`, `"ตรง"`.
  - `closingStep` (writing `a(x, e)` for `{ amount: x, expected: e }`): `([], 100)`→count1; `([a(90,100)], 100)`→count2; `([a(100,100)], 100)`→float; `([a(90,100), a(90,100)], 100)`→float; `([a(100,100)], 150)`→recount_changed; `([a(90,100), a(150,150)], 150)`→float.
  - `planFloat(5670, 1000)` → `{floatLeft:1000, deposit:4670, shortfall:0}`; `planFloat(800, 1000)` → `{floatLeft:800, deposit:0, shortfall:200}`. `depositFor(5670,1500)`→4170; `depositFor(500,600)`→null; `depositFor(500,-1)`→null.
  - `personalOutstanding([{reason:"personal_topup",amount:500},{reason:"purchase",amount:60}])`→500; with an extra `personal_return` 500 → 0; return-only → 0.
  - `validateMovement`: `other_out` with empty note → error; `purchase` with direction `in` → error; amount 0 → error; amount 100000 ok; note of 201 chars → error; `correction` both directions ok with a note.
  - `shiftErrorMessage("P0001: expected_changed")` → the expected_changed message; unknown → fallback.
  - `bangkokMonthRange("2026-10")` → `{start:"2026-09-30T17:00:00.000Z", end:"2026-10-31T17:00:00.000Z"}`; `("2026-13")`→null; `bangkokMonth("2026-10-31T17:30:00Z")` → `"2026-11"`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL (modules missing).
- [ ] **Step 3: Implement the three modules.**
- [ ] **Step 4: Run `npm test`, `TZ=UTC npm test` (Git Bash), `npx tsc --noEmit`.** Expected: all PASS, 0 type errors.
- [ ] **Step 5: Commit.** `feat(shifts): pure shift math, error messages, Bangkok month range`

### Task 2: Migration A — columns, append-only tables, functions (applied)

**Files:**
- Create: `supabase/migrations/20261022120000_shift_management.sql`, `supabase/tests/shift_management_test.sql`
- Modify: `src/types/database.ts`

**Interfaces:**
- **Produces (schema):**
  - `tenants.cash_float_default numeric(10,2) not null default 1000 check (between 0 and 100000)`.
  - `shifts` + nullable: `opening_expected`, `opening_difference`, `opening_note text`, `previous_shift_id uuid references shifts(id)`, `closing_note text`, `float_left`, `deposit_amount`, and close-time snapshots `closing_cash_sales`, `closing_cash_refunds`, `closing_transfer_sales`, `closing_order_count int`, `closing_cash_in`, `closing_cash_out`. `check (status in ('open','closed'))`; CHECKs for new-flow rows that pass when the new columns are null (`float_left between 0 and closing_cash_counted`, `deposit_amount = closing_cash_counted - float_left`, notes ≤ 200). Unique partial index `shifts_one_open_per_tenant on shifts (tenant_id) where status = 'open'` (compatible with old code: it never opens a second shift except in the race this fixes; deliberately here rather than in B).
  - `shift_cash_counts (id, tenant_id, shift_id → shifts on delete restrict, stage text check in ('opening','closing'), attempt int > 0, amount numeric(10,2) 0–1,000,000, expected numeric(10,2) null, created_by → profiles, created_at default clock_timestamp())`, unique `(shift_id, stage, attempt)`.
  - `cash_movements (id, tenant_id, shift_id → shifts on delete restrict, direction check in ('in','out'), reason check in the six codes, amount > 0 ≤ 100000, note text ≤ 200, created_by, created_at default clock_timestamp())`, plus a CHECK tying reason to direction (`personal_topup`/`other_in` → in; `purchase`/`personal_return`/`other_out` → out) and note required for `other_*`/`correction`.
  - Both new tables: RLS on, SELECT policy `tenant_id = public.auth_tenant_id()`, `revoke all from anon`, `revoke insert, update, delete, truncate from authenticated`, and a BEFORE UPDATE OR DELETE trigger raising `append_only` for every caller.
- **Produces (functions, all `security invoker`, `set search_path = public`, EXECUTE revoked from public/anon/authenticated, granted to service_role; errors raised as the codes in Task 1):**
  - `shift_totals(p_tenant_id uuid, p_shift_id uuid) returns table(opening_cash, cash_sales, cash_refunds, transfer_sales, order_count int, cash_in, cash_out, expected_cash)` — the Global Constraints formula.
  - `shift_open(p_tenant_id uuid, p_actor_id uuid, p_counts numeric[], p_note text) returns uuid` — 1–2 counts in range else `invalid_counts`; actor active member (`deactivated_at is null`) else `forbidden`; previous = the tenant's latest closed shift by `closed_at`; expected = its `float_left` (null → no comparison); one count that mismatches a non-null expected → `recount_required`; two counts where the first matched → `invalid_counts`; opening_cash = last count; inserts the count rows (stage opening, attempts 1..n, expected); unique violation → `shift_already_open`.
  - `shift_record_closing_count(p_tenant_id, p_shift_id, p_actor_id, p_amount numeric) returns table(attempt int, expected numeric)` — lock shift `for update`; must exist (`shift_not_found`) and be open (`shift_closed`); actor active; amount 0–1,000,000 (`invalid_amount`); inserts the next attempt with expected from `shift_totals`.
  - `shift_close(p_tenant_id, p_shift_id, p_actor_id, p_float_left numeric, p_note text) returns table(counted, expected, variance, float_left, deposit)` — lock; open; latest closing attempt required (`count_required`); expected now ≠ latest.expected → `expected_changed`; latest mismatched and < 2 attempts → `recount_required`; float 0..counted (`invalid_float`); writes closed_by/at, `closing_cash_counted`, `expected_cash`, `variance`, float, deposit, note, the six snapshot columns, `status = 'closed'`.
  - `shift_add_cash_movement(p_tenant_id, p_shift_id, p_actor_id, p_direction text, p_reason text, p_amount numeric, p_note text) returns uuid` — lock; open; actor active; validates as the table CHECKs (`invalid_reason`, `note_required`, `invalid_amount`).

- [ ] **Step 1: Write `supabase/tests/shift_management_test.sql`** in the style of `supabase/tests/order_adjustments_test.sql` (DO block, two QA tenants + staff + deactivated manager, ends with `raise exception 'RESULT %'`). It must also pass after migration B (it is re-run at rollout): never insert an order into a shift that is already closed, never insert a cash order without a shift. Keys (all must be true):
  - open: first-ever open with one count → no comparison, opening_cash = count; second `shift_open` while open → `shift_already_open`; deactivated actor → `forbidden`; actor of tenant B → `forbidden`.
  - after a new-flow close with float 1000: one count 1000 → difference 0; one count 950 → `recount_required`; counts `[950, 950]` → opening_cash 950, opening_difference −50, previous_shift_id set, two opening count rows; counts `[1000, 1000]` → `invalid_counts`.
  - latest closed shift closed by old-style direct update (no float_left) → next open has `opening_expected` null.
  - totals: seed cash 100 + cash 65 + transfer 85 + cancelled cash 40 + a cash refund of a 50 bill in this shift + movement in 500 + out 60 → `expected_cash` = opening + 100 + 65 + 50 − 50 + 500 − 60, `transfer_sales` 85, cancelled excluded.
  - closing: close with no count → `count_required`; one matching count → close OK, snapshots equal `shift_totals`, deposit = counted − float; one mismatched count → `recount_required`; second mismatched → close OK with variance; a cash order inserted after the latest count → `expected_changed`; then a fresh count → OK.
  - float: float > counted → `invalid_float`; float −1 → `invalid_float`.
  - movement: on closed shift → `shift_closed`; `purchase` as `in` → `invalid_reason`; `other_out` without note → `note_required`; amount 0 and 100000.01 → `invalid_amount`.
  - append-only: UPDATE and DELETE on `cash_movements` and `shift_cash_counts` (as service) → `append_only`.
  - unique open index: direct insert of a second open shift → unique violation.
  - grants: `has_function_privilege('authenticated', …, 'EXECUTE')` false for all five; `has_table_privilege('authenticated','public.cash_movements','INSERT')` false.
  - an old-style open shift (inserted with only the old columns) can take a closing count and close.
- [ ] **Step 2: Run the test against the DB without the migration.** Expected: fails (functions missing).
- [ ] **Step 3: Write the migration** with a header comment explaining it is additive and safe for the deployed code. Apply with `apply_migration` (name `shift_management`).
- [ ] **Step 4: Run the test.** Expected: `RESULT {…}` with every key true. Run `get_advisors` (security); expected: no new findings for these objects. Confirm the real tenant's open shift is unchanged (`select status, opening_cash from shifts` on it).
- [ ] **Step 5: Patch `src/types/database.ts`** (new columns on `tenants`/`shifts`, both tables, five functions). Run `npx tsc --noEmit`. Expected: 0 errors.
- [ ] **Step 6: Commit.** `feat(shifts): counts, cash movements, float and locked shift functions (migration A)`

### Task 3: Data access and server actions

**Files:**
- Modify: `src/lib/dal.ts`, `src/app/actions/shifts.ts`

**Interfaces:**
- **Consumes:** Task 1 (`parseAmount` limits, `validateMovement`, `shiftErrorMessage`), Task 2 functions/tables.
- **Produces (`dal.ts`):**
  - `Shift` gains `openedBy: string` (profile id). `getActiveShift` unchanged otherwise.
  - `type ShiftTotals = { openingCash; cashSales; cashRefunds; transferSales; orderCount; cashIn; cashOut; expectedCash }` (numbers) and `getShiftTotals(tenantId, shiftId): Promise<ShiftTotals>` via admin client `rpc("shift_totals")`.
  - `type CashMovement = { id; direction: "in" | "out"; reason: string; amount: number; note: string | null; createdBy: string; createdAt: string }`; `getCashMovements(tenantId, shiftId): Promise<CashMovement[]>` newest first.
  - `type CashCount = { stage: "opening" | "closing"; attempt: number; amount: number; expected: number | null; createdBy: string; createdAt: string }`; `getCashCounts(tenantId, shiftId): Promise<CashCount[]>` by stage, attempt.
  - `type ShiftDetail` = every `shifts` column camel-cased (numbers as `number | null`); `getShiftById(tenantId, id): Promise<ShiftDetail | null>`; `getShiftHistory(tenantId, before?: string, limit = 30): Promise<{ rows: ShiftDetail[]; nextBefore: string | null }>` keyset on `opened_at desc`; `getClosedShiftsInMonth(tenantId, month: string): Promise<ShiftDetail[]>` (by `opened_at` in `bangkokMonthRange`, paginate with `.range` past 1,000).
  - `getCashFloatDefault(tenantId): Promise<number>`.
  - Keep the old `getShiftSummary` until Task 5 removes its last caller.
- **Produces (`src/app/actions/shifts.ts`, new exports; the old `openShift`/`closeShift` stay until Task 5):**
  - `checkOpeningCount(amount: number): Promise<{ error: string } | { expected: number | null; difference: number | null }>` — stateless (spec "Known limitations").
  - `startShift(counts: number[], note: string | null): Promise<{ error: string } | { shiftId: string }>`
  - `recordClosingCount(shiftId: string, amount: number): Promise<{ error: string } | { attempt: number; counted: number; expected: number; difference: number }>`
  - `finishShift(shiftId: string, floatLeft: number, note: string | null): Promise<{ error: string } | { counted: number; expected: number; variance: number; floatLeft: number; deposit: number }>`
  - `addCashMovement(input: { shiftId: string; direction: "in" | "out"; reason: MovementReason; amount: number; note: string }): Promise<{ error: string } | { id: string }>`
  - Each: `getProfile()` (else `กรุณาเข้าสู่ระบบก่อน`), validate types and ranges server-side with the Task 1 helpers, call the function with `p_tenant_id: profile.tenant_id`, `p_actor_id: profile.id`, map errors with `shiftErrorMessage`, `revalidatePath("/shifts")` and `revalidatePath("/pos")`.

- [ ] **Step 1: Implement the DAL functions and the actions.** Totals and history reads use the admin client only after `getProfile()` scoped the tenant (functions are service-only); simple selects use the user client (RLS SELECT).
- [ ] **Step 2: Verify against a QA tenant** with a scratch script (not committed) or the Browser pane later: `startShift([0])`, `addCashMovement` in 500 personal_topup, `recordClosingCount` 500, `finishShift(0)` succeed; `getShiftTotals` expected equals the SQL result. Run `npx tsc --noEmit`, `npm run lint`. Expected: 0 errors.
- [ ] **Step 3: Commit.** `feat(shifts): data access and server actions for counts, movements and closing`

### Task 4: `/shifts` — opening flow, open-shift view, cash movements

**Files:**
- Create: `src/components/shifts/amount-input.tsx`, `src/components/shifts/open-shift-card.tsx`, `src/components/shifts/cash-movement-dialog.tsx`, `src/components/shifts/shift-movements.tsx`, `src/components/shifts/shift-summary-card.tsx`
- Modify: `src/app/(shell)/shifts/page.tsx`

**Interfaces:**
- **Consumes:** Task 1 `parseAmount`, `compareCount`, `differenceLabel`, `personalOutstanding`, `MOVEMENT_REASONS`; Task 3 `checkOpeningCount`, `startShift`, `addCashMovement`, `getActiveShift`, `getShiftTotals`, `getCashMovements`, `getPeopleNames`.
- **Produces:** `AmountInput({ id, value, onChange, autoFocus? })` (large decimal input, `inputMode="decimal"`), used again in Task 5.

- [ ] **Step 1: `OpenShiftCard`** (client): states count1 → result → count2 → result. Empty box, `ตรวจยอด` calls `checkOpeningCount`; `expected === null` → straight to `เปิดกะ` with no message; match on first → `ตรงกับเงินที่เหลือไว้เมื่อคืน ✓`; on second → `ตรงแล้ว ✓`; mismatch on first → `{label} · นับอีกครั้ง` + new empty box; on second → `{label} · บันทึกแล้ว` + optional note. `เปิดกะ` calls `startShift(counts, note)` then `router.refresh()`.
- [ ] **Step 2: Open-shift view in `page.tsx`:** header `เปิดกะโดย {name} · {HH:MM}`; the two movement buttons; personal-money warning when `personalOutstanding > 0`; movement list (time, reason label, note, name, ±amount coloured); `ShiftSummaryCard` rendered **only** when `role` is owner or manager, and `getShiftTotals` called only then (staff payload must not contain it); held-bills note kept. Page layout to round A sizes (drop `max-w-lg`).
- [ ] **Step 3: `CashMovementDialog`** (overlay pattern of `src/components/orders/pin-reason-dialog.tsx`): amount, reason chips for the chosen direction, note (required marker for `other_*`/`correction`), `บันทึก`; inline error from the action; on success close + `router.refresh()`.
- [ ] **Step 4: Verify in the Browser pane at 1180×740** on a QA tenant (dev server `kidkubpos-dev-utc`): first open with no comparison; movements in/out; personal warning appears and clears after `คืนเงินส่วนตัว`; owner sees the summary, staff does not (also search the staff page HTML for the expected number — absent). `npx tsc --noEmit`, `npm run lint`, `npm test`. Expected: clean.
- [ ] **Step 5: Commit.** `feat(shifts): blind opening count, cash in/out and live summary for owner/manager`

### Task 5: Closing flow, float setting, remove the old panel

**Files:**
- Create: `src/components/shifts/close-shift-flow.tsx`, `src/components/settings/cash-float-form.tsx`
- Modify: `src/app/(shell)/shifts/page.tsx`, `src/app/actions/shifts.ts` (delete `openShift`, `closeShift`), `src/lib/dal.ts` (delete `getShiftSummary` and `ShiftSummary` once unused), `src/app/actions/settings.ts` (add `updateCashFloatDefault`), `src/app/(shell)/settings/page.tsx`
- Delete: `src/components/shifts/shift-panel.tsx`

**Interfaces:**
- **Consumes:** Task 1 `closingStep`, `planFloat`, `depositFor`, `differenceLabel`, `parseAmount`, `MAX_FLOAT`; Task 3 `recordClosingCount`, `finishShift`, `getCashCounts`, `getCashFloatDefault`, `getShiftTotals`; Task 4 `AmountInput`.
- **Produces:** `CloseShiftFlow({ shiftId, initialStep, lastResult, floatDefault, openHeld, personalOutstanding })` where `initialStep` comes from `closingStep` computed **on the server** and `lastResult: { attempt; counted; expected; difference } | null` is passed only when a closing attempt already exists. `updateCashFloatDefault(prevState: SettingsState, formData: FormData): Promise<SettingsState>` (owner only, `parseAmount(raw, MAX_FLOAT)`).

- [ ] **Step 1: `CloseShiftFlow`**: `ปิดกะ` opens step ก (`นับเงินสดทั้งหมดในลิ้นชัก`, empty box, `ตรวจยอด`; held-bills confirmation and the personal-money warning as in the spec). Result block `นับได้` / `ระบบคิดว่าควรมี` / `ส่วนต่าง`; mismatch on attempt 1 → `{label} · นับอีกครั้ง` + empty box; after attempt 2 → `{label} · บันทึกแล้ว` + optional note; `expected_changed` from `finishShift` → `มีรายการเงินสดใหม่ระหว่างนับ · นับอีกครั้ง` + empty box. Step ข: `เก็บไว้เป็นเงินทอนพรุ่งนี้` pre-filled from `planFloat`, `ค่าปกติของร้าน ฿{default}` when edited, `นำไปฝากธนาคาร` live from `depositFor`, shortfall line when `shortfall > 0`, `ยืนยันปิดกะ` → `finishShift` → confirmation with deposit (owner/manager: link to `/shifts/{id}`).
- [ ] **Step 2: Page resumes**: when the open shift has closing attempts, the server computes `closingStep(attempts, totals.expectedCash)` and renders `CloseShiftFlow` opened at that step.
- [ ] **Step 3: Float setting**: `CashFloatForm` on the settings page (label `เงินทอนที่เก็บไว้ในลิ้นชักข้ามคืน`, same form pattern as `PromptPayForm`), action updates `tenants.cash_float_default` with the user client (tenants UPDATE is owner-only).
- [ ] **Step 4: Remove** `shift-panel.tsx`, the old `openShift`/`closeShift`, and `getShiftSummary`/`ShiftSummary` (grep for any remaining caller first).
- [ ] **Step 5: Verify in the Browser pane at 1180×740** on a QA tenant: match close; mismatch → recount → saved; reload after one mismatch resumes at count 2; a cash sale from another tab between count and confirm → recount prompt; float edit 1500 → deposit updates; count 800 with default 1000 → shortfall line, deposit 0; float setting change shows next close; next morning compares with last night's actual float. `npx tsc --noEmit`, `npm run lint`, `npm test`. Expected: clean.
- [ ] **Step 6: Commit.** `feat(shifts): blind closing count with recount, float and bank deposit; float setting`

### Task 6: POS — cash only with an open shift

**Files:**
- Create: `src/components/pos/no-shift-dialog.tsx`
- Modify: `src/app/actions/orders.ts` (`createOrder`), `src/components/pos/pos-screen.tsx`

**Interfaces:**
- **Consumes:** existing `activeShiftId` prop of `PosScreen`, `getActiveShift`.
- **Produces:** `NoShiftDialog({ onGoToShifts, onPayByTransfer, onClose })`.

- [ ] **Step 1: Server.** In `createOrder`, right after the existing `getActiveShift` call (step 5, already before the order/queue numbers are generated), return `{ error: "ยังไม่ได้เปิดกะ กรุณาเปิดกะก่อนรับเงินสด" }` when `paymentMethod === "cash"` and there is no open shift. Update the step 5 comment ("best-effort") to match. Transfer behaviour unchanged.
- [ ] **Step 2: Client.** In `handleCheckout`, when `paymentMethod === "cash"` and `activeShiftId === null`, show `NoShiftDialog` instead of the cash modal. `ไปเปิดกะ` → `router.push("/shifts")`; `ชำระด้วยโอนแทน` → `setPaymentMethod("transfer")` and open the QR modal (same as the transfer branch). If the server returns the no-shift error from the cash modal (shift closed on another device), show the dialog too.
- [ ] **Step 3: Verify in the Browser pane** on a QA tenant: no shift → cash shows the dialog; transfer-instead completes a transfer sale; open a shift → cash works; close the shift in another tab, then pay cash in the stale POS tab → dialog, no bill saved, no queue number burned. `npx tsc --noEmit`, `npm run lint`. Expected: clean.
- [ ] **Step 4: Commit.** `feat(pos): cash payments need an open shift`

### Task 7: Shift history, summary page, CSV

**Files:**
- Create: `src/lib/shift-csv.ts`, `src/lib/shift-csv.test.ts`, `src/app/(shell)/shifts/history/page.tsx`, `src/app/(shell)/shifts/[id]/page.tsx`, `src/app/(shell)/shifts/export/route.ts`
- Modify: `src/app/(shell)/shifts/page.tsx` (link `ประวัติกะ` for owner/manager)

**Interfaces:**
- **Consumes:** Task 1 `differenceLabel`, `compareCount`, `bangkokMonth`, `bangkokMonthRange`; Task 3 `getShiftHistory`, `getShiftById`, `getCashCounts`, `getCashMovements`, `getShiftTotals`, `getClosedShiftsInMonth`, `getPeopleNames`.
- **Produces:** `type ShiftCsvRow` (one field per CSV column, names resolved) and `buildShiftCsv(rows: ShiftCsvRow[]): string`.

- [ ] **Step 1: Write failing CSV tests**: output starts with `"﻿"`; header line is exactly `วันที่,เปิดกะ,เปิดโดย,ปิดกะ,ปิดโดย,เงินทอนเมื่อคืน,นับตอนเปิด,ขาด/เกินข้ามคืน,ขายเงินสด,ขายโอน,คืนเงินสด,เงินเข้า,เงินออก,ควรมี,นับตอนปิด,ส่วนต่าง,เก็บไว้ในลิ้นชัก,นำฝาก,หมายเหตุ`; lines end with `\r\n`; a note containing `,` or `"` is quoted with `""` escaping; money has 2 decimals; a short variance is negative (`-20.00`); a shift opened `2026-10-20T17:30:00Z` shows date `2026-10-21` and time `00:30`; null fields are empty.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL. **Step 3: implement `buildShiftCsv`.** **Step 4: `npm test`** → PASS.
- [ ] **Step 5: History page** (owner/manager, staff → `redirect("/shifts")`): rows per spec (date, opened/closed by, `closing_cash_sales`, variance label coloured, overnight difference when set, `เปิดอยู่` for the open one), `ดูเพิ่ม` link with `?before=`; month picker + `ส่งออกไฟล์ Excel (CSV)` linking to `/shifts/export?month=YYYY-MM`.
- [ ] **Step 6: Summary page `/shifts/[id]`** (owner/manager): the spec's ใบสรุปกะ sections; closed shifts read the snapshot columns, the open shift reads `getShiftTotals`; every count attempt listed (`นับ 2 ครั้ง ฿5,670 / ฿5,670`); responsible names (overnight: previous shift's `closed_by` + this `opened_by`; day: `opened_by`, plus `closed_by` when different).
- [ ] **Step 7: Route handler** (read the Next.js route-handler docs first): `GET /shifts/export?month=` → owner/manager only (else 403), invalid month → 400, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="shifts-YYYY-MM.csv"`.
- [ ] **Step 8: Verify in the Browser pane** on a QA tenant with three closed shifts: list, summary, staff redirect, CSV fetched via `fetch` in the page and checked for BOM + Thai header (downloads are blocked in the pane). `npx tsc --noEmit`, `npm run lint`. Expected: clean.
- [ ] **Step 9: Commit.** `feat(shifts): shift history, shift summary and monthly CSV export`

### Task 8: Migration B — lock-down (written and tested, NOT applied)

**Files:**
- Create: `supabase/migrations/20261022130000_shift_lockdown.sql`, `supabase/tests/shift_lockdown_test.sql`
- Modify: `supabase/tests/order_adjustments_test.sql`, `src/lib/order-adjustment-errors.ts` (+ test), `src/app/actions/orders.ts` (map insert-guard errors)

**Interfaces:**
- **Produces (migration B):**
  - `shifts`: drop policy `tenant_isolation`; `create policy shifts_select for select to authenticated using (tenant_id = public.auth_tenant_id())`; `revoke all from anon`; `revoke insert, update, delete, truncate from authenticated`.
  - `guard_order_drawer()` BEFORE INSERT OR UPDATE on `orders`, **unconditional (every role)**: INSERT with non-null `shift_id` → that shift must be the same tenant's and `open` (`select … for share`) else `shift_closed`; INSERT `payment_method = 'cash'` with null `shift_id` → `no_open_shift`; UPDATE entering `cancelled` for a cash bill with a shift → shift open (`for share`) else `shift_closed`; UPDATE entering `refunded` with `refund_method = 'cash'` → `refund_shift_id` non-null, same tenant, open (`for share`) else `shift_closed`.
  - `order_change_payment_method`: replace the plain `exists` with a `for share` read of the shift; `shift_id is null and p_to_method = 'cash'` → `no_shift`.
- **Produces (app):** `adjustmentErrorMessage` maps `no_shift` → `บิลนี้ขายตอนไม่ได้เปิดกะ เปลี่ยนเป็นเงินสดไม่ได้`; `createOrder` maps an insert error containing `no_open_shift` → `ยังไม่ได้เปิดกะ กรุณาเปิดกะก่อนรับเงินสด` and `shift_closed` → `กะถูกปิดไปแล้ว กรุณาเปิดกะใหม่` (without `mayHaveSaved`). Both are inert until B is applied.

- [ ] **Step 1: Fix `order_adjustments_test.sql`** so it stays valid under B: insert the `s0` orders while `s0` is open, then close it. Run it now (A applied). Expected: all keys true.
- [ ] **Step 2: Write `shift_lockdown_test.sql`**: the file is `begin;` + the full migration B text + a DO block + nothing else; the DO block ends with `raise exception 'RESULT %'`, which aborts the transaction, so B is never committed. Keys: as `authenticated` (set `request.jwt.claims` + `set local role authenticated` like the existing exploit checks) INSERT/UPDATE/DELETE on `shifts` rejected and SELECT of own tenant works; cash order insert without shift → `no_open_shift` (also as service); insert into a closed shift → `shift_closed`; void of a cash bill in a closed shift → `shift_closed`; cash refund tagged to a closed shift → `shift_closed`; method change to cash on a no-shift bill → `no_shift`; transfer insert without shift still allowed; the existing round A keys still hold (re-run its scenarios briefly or note that Step 1 already passes under A).
- [ ] **Step 3: Run `shift_lockdown_test.sql` via `execute_sql`.** Expected: error `RESULT {…}` with every key true. Then confirm nothing was committed: `select count(*) from pg_policies where tablename='shifts' and policyname='tenant_isolation'` → 1.
- [ ] **Step 4: Error mapping + tests** for `no_shift` in `order-adjustment-errors.test.ts`; `createOrder` mapping. `npm test`, `npx tsc --noEmit`. Expected: PASS, 0 errors.
- [ ] **Step 5: Commit.** `feat(shifts): lock-down migration (not applied yet) and its rolled-back DB test`

### Task 9: Whole-day live check and clean-up

**Files:** none committed (scratch scripts in the scratchpad).

- [ ] **Step 1: QA tenant** via the round A flow (auth.users with token columns `''`, `create_tenant_and_owner`, PIN 246810 hash, cookie script with `NODE_PATH`), plus a staff and a manager profile. Dev server `kidkubpos-dev-utc`, Browser pane 1180×740.
- [ ] **Step 2: Owner day**: open (no comparison) → cash and transfer sales → personal top-up 500, ice 60, return 500 → close with a mismatch, recount, float 1000 → summary numbers equal `shift_totals` and the hand sum; next morning count 950 → recount → overnight difference −50 with both names.
- [ ] **Step 3: Staff day**: no summary card, no history link, `/shifts/history` and `/shifts/{id}` redirect, `/shifts/export` 403; the staff page HTML (`document.documentElement.outerHTML` and the RSC payload in network responses) does not contain the expected amount before the count; reload mid-closing resumes at count 2.
- [ ] **Step 4: POS** no-shift dialog and stale-tab path (Task 6 Step 3) once more; method change still works in an open shift.
- [ ] **Step 5: Widths** 224px and 64px sidebar, no overflow on `/shifts`, history, summary, settings.
- [ ] **Step 6: Clean up**: delete the QA tenant's `cash_movements`, `shift_cash_counts`, order rows, shifts, profiles, tenant, auth users; verify 0 left; confirm the real tenant's shift row is unchanged.

---

## Rollout (only when the user says push)

1. `npm test`, `npx tsc --noEmit`, `npm run lint` clean; push.
2. Wait for the Vercel deploy to finish and check the deployed `/shifts` loads the new page.
3. Apply migration B (`apply_migration`, name `shift_lockdown`). Run `shift_management_test.sql` and `order_adjustments_test.sql` again (all true), and the key checks of `shift_lockdown_test.sql` without its `begin;` + migration text.
4. Smoke test on production with a fresh QA tenant: open, cash sale, close. Delete the QA tenant.
5. Tell the user to refresh the iPad pages (POS and จัดการกะ).

Between steps 1 and 3 the deployed new code works with migration A alone (it never writes shifts directly). If the deploy fails, do not apply B.
