# Order History Round A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn ประวัติบิล into a day-based, searchable history with a transfer-check view, a "ไม่ได้รับเงิน" status (reversible), PIN-approved payment-method changes, people shown on the bill, and Bangkok time everywhere.

**Architecture:** One migration adds the `unpaid` status, current-state columns on `orders`, an append-only `order_adjustments` table, guard triggers, and service-role-only plpgsql functions. Each function updates the order and appends its history row in one transaction. Server actions verify the manager PIN (existing bcrypt pattern), then call those functions through the admin client. Pure logic (Bangkok time, day summary, search, error messages) lives in alias-free modules tested with Node's built-in test runner. Revenue queries switch from a status denylist to an allowlist so `unpaid` can't leak into any figure.

**Tech Stack:** Next.js 16 (server components + server actions), Supabase Postgres/RLS, Tailwind v4, `node --test` (Node 24 runs `.ts` directly).

**Spec:** `docs/superpowers/specs/2026-10-20-order-history-round-a-design.md`

## Global Constraints

- Shared DB (`khgahdjfkzpgsvbhfrqx`): migrations go live at once and must keep the deployed code working. Only QA tenants may ever hold `unpaid` before this ships.
- Never touch the real tenant "The Connect Brew&Bar". Test on disposable QA tenants, then delete them.
- Writes to `payment_method`, `status` transitions and the new columns go through the service role only. Every new state must be rejected for direct Data-API writes (`auth.uid() is not null`).
- Every bill action (void, refund, mark unpaid, restore, change method) needs an owner/manager PIN: a 6-digit pin, bcrypt-compared against owner/manager `pin_hash` in the tenant.
- Not-received: only `completed` + `transfer`. Restore: only `unpaid`. Method change: only `completed`, and only when `shift_id` is null or that shift's `status = 'open'`. No restock for unpaid/restore.
- The transfer tick is owner/manager only. Changing a bill's method to cash, or marking it unpaid, clears the tick. Restore leaves the tick unset.
- Day = Bangkok calendar day, `[YYYY-MM-DDT00:00:00+07:00, +24h)`. Every displayed date/time uses `timeZone: "Asia/Bangkok"`.
- iPad sizing (products round 2 standard): tap targets ≥ 44px (row/toggle ≥ 48px), body text ≥ 15px, no overflow at 1180×740 with the sidebar at 224px and at 64px.
- Thai copy, exact strings: chips `ทั้งหมด`, `เงินสด`, `โอน`, `ยกเลิก / คืนเงิน`, `ไม่ได้รับเงิน`. Summary labels: `ยอดขายสุทธิ`, `เงินสด`, `โอน`, `ไม่ได้รับเงิน`. Toggle: `เจอเงินแล้ว`. Buttons: `แก้ช่องทางชำระ`, `ไม่ได้รับเงิน`, `ได้รับเงินแล้ว`. Status badge `ไม่ได้รับเงิน`.
- Read `node_modules/next/dist/docs/` before touching routing/searchParams (AGENTS.md).

## Review Focus

1. A bill at 00:30 Bangkok (17:30 UTC the previous day) must show on the right day with time 00:30 when the server clock is UTC. Pinned in Task 1 tests.
2. Two managers act on the same bill at once (double mark, or mark while another changes the method). The second call gets a clear "state changed" message and nothing is applied twice. Pinned by row locks + SQL keys in Task 3.
3. A method change sent from a page opened before the shift closed must be rejected server-side with a clear message. SQL key in Task 3.
4. A searched queue number that only exists on another day shows "ไม่พบคิว N ในวันที่เลือก", not an empty list without explanation. Pinned in Task 6 tests.
5. An `unpaid` bill must not leak into any revenue figure (Dashboard, reports, shift summary, customer totals, POS today counter). Grep check in Task 4, plus the equality check in Task 8.

---

### Task 1: Test runner + Bangkok time module

**Files:**
- Modify: `package.json` (script `"test": "node --test \"src/**/*.test.ts\""`), `tsconfig.json` (`"allowImportingTsExtensions": true`)
- Create: `src/lib/bangkok-time.ts`, `src/lib/bangkok-time.test.ts`

**Interfaces:**
- **Produces:** `src/lib/bangkok-time.ts` (no `@/` imports, no `server-only`):
  - `BANGKOK_TZ = "Asia/Bangkok"`
  - `bangkokToday(now?: Date): string` returns `YYYY-MM-DD`
  - `isValidDateString(s: string): boolean`: a real calendar date in `YYYY-MM-DD`
  - `shiftDate(date: string, days: number): string`
  - `bangkokDayRange(date: string): { start: string; end: string }` (UTC ISO strings)
  - `formatTime(iso: string): string` (`HH:MM`, 24h)
  - `formatDate(iso: string, style?: "medium" | "long"): string`
  - `formatDateTime(iso: string, style?: "medium" | "long"): string`
  - `formatDayLabel(date: string, today: string): string`: `วันนี้ · อ. 20 ต.ค. 2569` for today, `เมื่อวาน · …` for yesterday, otherwise weekday + date.
  - All `format*` use `Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK_TZ, … })`.

- [ ] **Step 1: Write failing tests** (`node:test` + `node:assert/strict`, import from `"./bangkok-time.ts"`):
  - `formatTime("2026-10-20T03:15:00Z") === "10:15"`
  - `formatTime("2026-10-19T17:30:00Z") === "00:30"`, and `bangkokToday(new Date("2026-10-19T17:30:00Z")) === "2026-10-20"`
  - `bangkokDayRange("2026-10-20")` deep-equals `{ start: "2026-10-19T17:00:00.000Z", end: "2026-10-20T17:00:00.000Z" }`
  - `shiftDate("2026-10-31", 1) === "2026-11-01"`, `shiftDate("2026-03-01", -1) === "2026-02-28"`
  - `isValidDateString("2026-02-30") === false`, `("2026-10-20") === true`, `("20-10-2026") === false`
  - `formatDayLabel("2026-10-20", "2026-10-20")` starts with `"วันนี้"`; with today `"2026-10-21"` it starts with `"เมื่อวาน"`
  - `formatDateTime("2026-10-20T03:15:00Z")` contains `"10:15"`
- [ ] **Step 2: Run them and watch them fail.** Run `npm test`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `src/lib/bangkok-time.ts`.** Do the date arithmetic on `Date.UTC` parts, never the local clock.
- [ ] **Step 4: Check it passes under both clocks.** Run `npm test`, then `TZ=UTC npm test` in Git Bash. Expected: PASS both times. Also run `npx tsc --noEmit`. Expected: 0 errors.
- [ ] **Step 5: Commit.** Message: `test: node test runner; feat: Bangkok time helpers`

### Task 2: Bangkok time sweep

**Files:** Modify: `src/app/(shell)/orders/page.tsx`, `src/app/(shell)/orders/[id]/page.tsx`, `src/app/(shell)/customers/[id]/page.tsx`, `src/components/pos/held-bills-panel.tsx`, `src/components/pos/pos-header.tsx`, `src/components/products/archived-products-section.tsx`, `src/components/settings/deactivated-members-section.tsx`, plus anything else the grep finds.

**Interfaces:** **Consumes:** Task 1 `formatTime`, `formatDate`, `formatDateTime`.

- [ ] **Step 1: List every date/time display.** Run: `grep -rnE "toLocale(Date|Time)?String\(" src --include=*.tsx --include=*.ts`. Keep only the date/time calls; number formatting such as `amount.toLocaleString("th-TH")` stays.
- [ ] **Step 2: Swap each date/time call** for the matching helper, keeping the current `dateStyle`/`timeStyle` look. `pos-header.tsx` renders "today" on the client, so it uses `formatDate(new Date().toISOString(), "long")` to stay Bangkok on both the server and the client render.
- [ ] **Step 3: Verify.** Rerun the Step 1 grep. Expected: no date/time hits left. Run `npx tsc --noEmit` and `npm run lint`. Expected: 0 errors.
- [ ] **Step 4: Commit.** Message: `fix(time): show every date/time in Bangkok time regardless of server clock`

### Task 3: Migration — unpaid status, adjustments, guards, functions

**Files:**
- Create: `supabase/migrations/20261021120000_order_adjustments.sql`
- Modify: `src/types/database.ts` (regenerate with `generate_typescript_types`; keep the file's header and formatting)

**Interfaces:**
- **Produces:**
  - `orders` columns: `unpaid_at timestamptz`, `unpaid_by uuid`, `unpaid_approved_by uuid`, `unpaid_reason text`, `transfer_verified_at timestamptz`, `transfer_verified_by uuid` (uuid FKs → `profiles(id)`).
  - `orders_status_check`: `completed, cancelled, refunded, unpaid`. Drop `voided` only if `select count(*) from orders where status='voided'` is 0. Otherwise keep it.
  - Table `order_adjustments(id uuid pk default gen_random_uuid(), tenant_id uuid not null → tenants, order_id uuid not null → orders on delete restrict, kind text not null check in ('payment_method_change','mark_unpaid','restore_paid'), from_value text not null, to_value text not null, reason text not null check (char_length(btrim(reason)) between 1 and 500), actor_id uuid → profiles, approver_id uuid → profiles, created_at timestamptz not null default now())`. Index `(order_id, created_at)`. RLS on. Select policy `tenant_id = auth_tenant_id()`. Revoke insert/update/delete from `anon, authenticated`.
  - Functions, all `language plpgsql security invoker set search_path = public`. Revoke execute from `public, anon, authenticated`; grant to `service_role`. Each one does `select … from orders where id = p_order_id and tenant_id = p_tenant_id for update` first.
    - `order_mark_unpaid(p_tenant_id uuid, p_order_id uuid, p_actor_id uuid, p_approver_id uuid, p_reason text) returns void`: requires `completed` + `transfer`. Sets `status='unpaid'`, the four `unpaid_*` columns, and clears `transfer_verified_*`. Appends `mark_unpaid` with from `completed`, to `unpaid`.
    - `order_restore_paid(same params) returns void`: requires `unpaid`. Sets `status='completed'`, nulls `unpaid_*` and `transfer_verified_*`. Appends `restore_paid` with from `unpaid`, to `completed`.
    - `order_change_payment_method(p_tenant_id uuid, p_order_id uuid, p_to_method text, p_actor_id uuid, p_approver_id uuid, p_reason text) returns void`: `p_to_method` must be in `('cash','transfer')` else `invalid_method`. Requires `completed` (else `invalid_state`) and a method different from the current one (else `same_method`). `shift_id` must be null or its shift `status = 'open'` (else `shift_closed`). Updates `payment_method`; when the new method is `cash`, also clears `transfer_verified_*`. Appends `payment_method_change` with from/to the methods. `cash_received`/`change_amount` are untouched.
    - `order_set_transfer_verified(p_tenant_id uuid, p_order_id uuid, p_actor_id uuid, p_verified boolean) returns void`: requires `completed` + `transfer`. Sets `now()`/actor, or nulls both. No history row.
  - **Raised messages:** `order_not_found`, `invalid_state`, `same_method`, `shift_closed`, `invalid_method`, `reason_required` (when the reason is blank after trim).
  - Guard trigger `prevent_direct_order_adjustment`, BEFORE INSERT OR UPDATE on `orders`, raises when `auth.uid() is not null` and any of these is true:
    - status enters or leaves `unpaid`
    - any `unpaid_*` or `transfer_verified_*` column changes (on INSERT: is non-null)
- **Error codes consumed by Task 5:** the six messages above.

- [ ] **Step 1: Write the DB test first.**
  - Location: `supabase/tests/order_adjustments_test.sql`. It is one `DO` block that ends in `raise exception 'RESULT %', <jsonb of keys>`, so everything rolls back. Actor switching: `set_config('role','authenticated',true)` plus `set_config('request.jwt.claims', json_build_object('sub',<uid>,'role','authenticated')::text, true)`. "As service" means switching back to `postgres` (`auth.uid()` null).
  - Setup: QA tenant A with an owner and a staff member, tenant B, an open shift S1 and a closed shift S0 in A. Orders:
    - `T1`: completed transfer in S1
    - `T2`: completed transfer in S0
    - `C1`: completed cash in S1
    - `C0`: completed cash in S0
    - `X1`: a cancelled order
  - Every key must be `true`:
    - `mark_ok`: service `order_mark_unpaid(A,T1,…,'ลูกค้าไม่ได้โอน')` → T1 is `unpaid`, `unpaid_*` set, and exactly 1 adjustment row `mark_unpaid`.
    - `mark_after_shift_closed_ok`: mark T2 (shift S0 closed) succeeds.
    - `mark_twice_rejected`: marking T1 again → `invalid_state`; adjustments for T1 still number 1.
    - `mark_cash_rejected`: mark C1 → `invalid_state`.
    - `mark_cancelled_rejected`: mark X1 → `invalid_state`.
    - `restore_ok`: restore T1 → `completed`, `unpaid_*` null, `transfer_verified_at` null, 2 adjustment rows in order (`mark_unpaid`, `restore_paid`).
    - `no_restock`: the `inventory_transactions` count for T1's materials is unchanged across mark+restore (seed one recipe so this means something).
    - `method_change_ok`: change C1 to `transfer` → `payment_method='transfer'`, with an adjustment from `cash` to `transfer`.
    - `method_same_rejected`: change C1 to `transfer` again → `same_method`.
    - `method_closed_shift_rejected`: change C0 → `shift_closed`; C0 is unchanged.
    - `method_bad_value_rejected`: `'card'` → `invalid_method`.
    - `tick_cleared_on_cash`: tick T1 (service `order_set_transfer_verified(…,true)`), change T1 to cash → `transfer_verified_at` null.
    - `blank_reason_rejected`: `'   '` → `reason_required`.
    - `foreign_tenant_rejected`: `order_mark_unpaid(B, T1, …)` → `order_not_found`.
    - `staff_direct_status_blocked`: as staff, `update orders set status='unpaid' where id=<a completed transfer>` → raises.
    - `staff_direct_tick_blocked`: as staff, update `transfer_verified_at` → raises.
    - `staff_rpc_denied`: as staff, `perform order_mark_unpaid(…)` → 42501.
    - `staff_adjustment_insert_denied`: as staff, insert into `order_adjustments` → 42501.
    - `staff_can_read_own_adjustments`: as staff, `select count(*) from order_adjustments where order_id = C1` → ≥ 1. Tenant B's owner sees 0.
- [ ] **Step 2: Run it before the migration.** Run: paste into `execute_sql`. Expected: an error on the missing functions/table (RED).
- [ ] **Step 3: Write and apply the migration.** Run `apply_migration` with name `order_adjustments`. Then rerun the test. Expected: RESULT with every key `true`. Run `get_advisors` (security). Expected: no new findings for these objects.
- [ ] **Step 4: Update the types.** Regenerate `src/types/database.ts`, then run `npx tsc --noEmit`. Expected: 0 errors.
- [ ] **Step 5: Commit.** Message: `feat(orders): unpaid status, append-only adjustments, guarded service-only adjustment functions`

### Task 4: Revenue allowlist

**Files:** Modify: `src/lib/dal.ts` (`getOrderItemsInRange` ~164, `getOrdersInRange` ~212, `getShiftSummary` ~1001, `getCustomers` ~1083, `getCustomerById` ~1140), `src/app/(shell)/pos/page.tsx` (~105), `src/app/(shell)/customers/[id]/page.tsx` (status label).

- [ ] **Step 1: Switch to an allowlist.**
  - Replace every `.neq("…status","cancelled").neq("…status","refunded")` pair with `.eq(<same column>,"completed")`.
  - In `getShiftSummary`, replace `.neq("status","cancelled")` with `.in("status",["completed","refunded"])` and keep the existing comment about refunded.
  - The customer page shows `ไม่ได้รับเงิน` (red) for `unpaid` rows.
- [ ] **Step 2: Verify.**
  - Run `grep -rnE "neq\(\"(orders\.)?status\"" src`. Expected: no hits.
  - Run `npx tsc --noEmit` and `npm run lint`. Expected: 0 errors.
- [ ] **Step 3: Commit.** Message: `fix(reports): count only completed bills as revenue so new statuses can't leak in`

### Task 5: Server actions + shared PIN check

**Files:**
- Create: `src/lib/manager-pin.ts` (server-only), `src/lib/order-adjustment-errors.ts` + `.test.ts`, `src/app/actions/order-adjustments.ts`
- Modify: `src/app/actions/orders.ts`. `voidOrder`/`refundOrder` use `verifyManagerPin`, and both reject `unpaid` up front with `บิลนี้ถูกแจ้งว่าไม่ได้รับเงิน`.

**Interfaces:**
- **Consumes:** the Task 3 functions and error codes.
- **Produces:**
  - `verifyManagerPin(tenantId: string, pin: string): Promise<string | null>`: returns the approver id. It moves the existing bcrypt loop out unchanged.
  - `adjustmentErrorMessage(code: string): string` (pure):
    - `order_not_found` → `ไม่พบบิลนี้`
    - `invalid_state` → `สถานะบิลเปลี่ยนไปแล้ว กรุณารีเฟรชหน้า`
    - `same_method` → `บิลนี้เป็นช่องทางนี้อยู่แล้ว`
    - `shift_closed` → `แก้ช่องทางชำระได้เฉพาะบิลในกะที่ยังเปิดอยู่`
    - `invalid_method` → `ช่องทางชำระไม่ถูกต้อง`
    - `reason_required` → `กรุณาระบุเหตุผล`
    - Any other code → `ทำรายการไม่สำเร็จ`
    - It also matches a code embedded in a longer Postgres message.
  - `type AdjustOrderState = { error?: string; success?: boolean } | undefined`
  - `markOrderUnpaid(prev: AdjustOrderState, formData: FormData): Promise<AdjustOrderState>` with fields `order_id, reason, pin`
  - `restoreOrderPaid(prev, formData)` with the same fields
  - `changePaymentMethod(prev, formData)` with fields `order_id, to_method, reason, pin`
  - `setTransferVerified(orderId: string, verified: boolean): Promise<{ error?: string }>`: owner/manager by `profile.role`, else `เฉพาะเจ้าของร้านหรือผู้จัดการ`. No PIN.
  - Each action: `getProfile`, then validate (6-digit pin, non-blank reason), then `verifyManagerPin`, then `createAdminClient().rpc(<fn>, …)`, mapping errors through `adjustmentErrorMessage`, then `revalidatePath("/orders")` and the detail path. `p_actor_id = profile.id`, `p_approver_id` = the verified approver.

- [ ] **Step 1: Write failing tests** for `adjustmentErrorMessage`: each code maps to its string; `'P0001: shift_closed'` → the shift_closed string; `'boom'` → `ทำรายการไม่สำเร็จ`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the mapper, `verifyManagerPin`, the actions, and the void/refund refactor plus the unpaid message.
- [ ] **Step 4: Verify.** Run `npm test`. Expected: PASS. Run `npx tsc --noEmit` and `npm run lint`. Expected: 0 errors.
- [ ] **Step 5: Commit.** Message: `feat(orders): PIN-approved mark-unpaid, restore, payment-method change and transfer tick actions`

### Task 6: Day-based history list

**Files:**
- Create:
  - `src/lib/order-history.ts` + `.test.ts` (pure, no `@/` imports)
  - `src/components/orders/day-nav.tsx`
  - `src/components/orders/history-search.tsx`
  - `src/components/orders/history-chips.tsx`
  - `src/components/orders/day-summary.tsx`
  - `src/components/orders/transfer-check-toggle.tsx`
  - `src/components/orders/history-row.tsx`
- Modify: `src/lib/dal.ts` (add the two fetchers), `src/app/(shell)/orders/page.tsx` (rewrite)
- Delete: `src/components/orders/orders-filter.tsx`

**Interfaces:**
- **Consumes:** Task 1 helpers; Task 5 `setTransferVerified`.
- **Produces** in `order-history.ts`:
  - `type HistoryFilter = "all" | "cash" | "transfer" | "reversed" | "unpaid"`
  - `type HistoryRow = { id: string; orderNumber: string | null; queueNumber: number | null; paymentMethod: string; status: string; total: number; createdAt: string; transferVerified: boolean; itemNames: string[] }`
  - `parseHistoryParams(sp: { date?: string; filter?: string; q?: string }, today: string): { date: string; filter: HistoryFilter; q: string }`: an invalid date becomes today; an unknown filter becomes `"all"`.
  - `filterRows(rows: HistoryRow[], filter: HistoryFilter): HistoryRow[]`:
    - `cash`/`transfer` = `completed` with that method
    - `reversed` = `cancelled` or `refunded`
    - `unpaid` = `unpaid`
  - `searchKind(q: string): "none" | "queue" | "bill"`: empty → `none`; `/^\d{1,4}$/` → `queue`; else `bill`.
  - `matchQueue(rows: HistoryRow[], q: string): HistoryRow[]`
  - `summarizeDay(rows: HistoryRow[]): { counts: Record<HistoryFilter, number>; netSales: number; cash: number; transfer: number; unpaid: number; transferChecked: number; transferTotal: number; refundedTransfer: { count: number; total: number } }`
  - `itemSummary(names: string[], max = 2): string`: `"ลาเต้เย็น, ครัวซองต์"`; with 4 names → `"ลาเต้เย็น, ครัวซองต์ +2"`.
- **Produces** in `dal.ts`:
  - `getOrdersForDay(tenantId: string, date: string): Promise<HistoryRow[]>`: paginated with `.range()` like `getOrdersInRange`, across `bangkokDayRange(date)`, newest first, embedding `order_items(product_name)`.
  - `findOrdersByNumber(tenantId: string, q: string): Promise<HistoryRow[]>`: `order_number ilike q%`, newest first, limit 20.

- [ ] **Step 1: Write failing tests** on a 7-row fixture:
  - completed cash 100 and 50
  - completed transfer 85 (verified) and 60
  - refunded transfer 85
  - cancelled cash 40
  - unpaid transfer 65

  Expect:
  - `counts` = `{all:7, cash:2, transfer:2, reversed:2, unpaid:1}`
  - `netSales` 295, `cash` 150, `transfer` 145, `unpaid` 65
  - `transferChecked` 1, `transferTotal` 2
  - `refundedTransfer` = `{count:1,total:85}`

  Also:
  - `parseHistoryParams({date:"2026-02-30",filter:"x"}, "2026-10-20")` → `{date:"2026-10-20",filter:"all",q:""}`
  - `searchKind("27")` is `"queue"`, `searchKind("TCB.123")` is `"bill"`
  - `matchQueue` for `"27"` returns only queue 27
  - `itemSummary` for both cases above
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `order-history.ts`, then the fetchers, components and page.
  - Page layout follows the mockup `.superpowers/brainstorm/947-1792511222/content/orders-layout.html`:
    - date bar: ◀ / label / ▶ / `📅 เลือกวัน` (native `<input type="date">`); ▶ is disabled when the selected day is today
    - search box with placeholder `พิมพ์เลขคิว หรือเลขบิล`
    - chips with counts
    - 4 summary tiles; the `ไม่ได้รับเงิน` tile is red only when it isn't 0
  - The `โอน` view adds:
    - the progress line `ตรวจยอดโอนแล้ว {checked} จาก {total} บิล · เหลือ {total-checked} บิล`
    - the refunded-transfer note `บิลโอนที่คืนเงินแล้ววันนี้ {n} บิล ฿{x} (เงินเคยเข้าบัญชี)` when n > 0
    - the toggle on each row, shown only to owner/manager. Staff see a read-only ✓ when the bill is ticked.
  - Search behaviour:
    - Queue search narrows within the day. When there's no match, show `ไม่พบคิว {q} ในวันที่เลือก`.
    - Bill search lists `findOrdersByNumber` results with their own dates.
  - Rows:
    - time `formatTime`, `text-xl font-bold tabular-nums`
    - `คิว N` (or the bill number when there's no queue) and the item summary
    - amount
    - badge only for non-completed statuses
    - `min-h-16`, each row links to `/orders/{id}?back=<current query>`
  - URL params `date`, `filter`, `q` are the only state. The toggle is optimistic and rolls back on error, showing the error text.
- [ ] **Step 4: Verify.** Run `npm test`. Expected: PASS. Run `npx tsc --noEmit` and `npm run lint`. Expected: 0 errors.
- [ ] **Step 5: Commit.** Message: `feat(orders): day-based history with search, counts, summary and transfer check`

### Task 7: Bill detail — people, adjustments, new actions

**Files:**
- Create:
  - `src/components/orders/pin-reason-dialog.tsx`
  - `src/components/orders/mark-unpaid-button.tsx`
  - `src/components/orders/restore-paid-button.tsx`
  - `src/components/orders/change-method-button.tsx`
- Modify: `src/lib/dal.ts` (add `getPeopleNames`, `getOrderAdjustments`), `src/app/(shell)/orders/[id]/page.tsx`

**Interfaces:**
- **Consumes:** Task 5 actions and Task 6 `transfer-check-toggle.tsx`.
- **Produces:**
  - `getPeopleNames(tenantId: string, ids: string[]): Promise<Record<string, string>>`: uses the admin client with `.eq("tenant_id", tenantId)`, so deactivated members still resolve. A missing name shows as `—`.
  - `getOrderAdjustments(tenantId: string, orderId: string): Promise<{ kind: string; fromValue: string; toValue: string; reason: string; actorId: string | null; approverId: string | null; createdAt: string }[]>`
  - `PinReasonDialog` props: `{ title: string; confirmLabel: string; action: (prev: AdjustOrderState, fd: FormData) => Promise<AdjustOrderState>; orderId: string; extraFields?: React.ReactNode; tone?: "danger" | "default" }`. It reuses `PinPad` and the 5-wrong-PIN lockout behaviour of `void-order-button.tsx`, requires a reason, and has a 48px trigger button.

- [ ] **Step 1: Build the page parts.**
  - Header: bill number, queue, `formatDateTime(created_at,"long")`. The back link uses `?back=` when present, so the user returns to the same day, filter and search.
  - People section: `ขายโดย`, `อนุมัติส่วนลดโดย`, `ยกเลิกโดย` / `คืนเงินโดย` / `แจ้งไม่ได้รับเงินโดย`, each with `· อนุมัติโดย …`, and `ลูกค้า` linking to `/customers/{id}`. Show only the lines whose ids are set.
  - Status `unpaid` shows red `ไม่ได้รับเงิน`, with its reason and time.
  - Adjustment history list (`แก้ช่องทางชำระ เงินสด → โอน`, `แจ้งไม่ได้รับเงิน`, `ได้รับเงินแล้ว`), each with the reason, who, approver and time.
  - Hide the cash-tendered lines when `payment_method` is `transfer`.
  - Actions:
    - `completed`: existing void/refund, plus `แก้ช่องทางชำระ` (a 2-option choice for the other method). The button is disabled with the note `กะของบิลนี้ปิดแล้ว แก้ช่องทางชำระไม่ได้` when `shift_id` is set and isn't the active shift.
    - `completed` + transfer: `ไม่ได้รับเงิน` (danger tone) and the transfer toggle (owner/manager).
    - `unpaid`: `ได้รับเงินแล้ว`.
- [ ] **Step 2: Verify.** Run `npx tsc --noEmit`, `npm run lint` and `npm test`. Expected: 0 errors, all pass.
- [ ] **Step 3: Commit.** Message: `feat(orders): bill detail shows people and adjustment history; not-received, restore and method-change actions`

### Task 8: Live verification (QA tenant, Browser pane 1180×740, server clock UTC)

- [ ] **Step 1: Set up.**
  - Start the dev server with `TZ=UTC`: add a launch config `dev-utc` with `runtimeExecutable` `cmd`, args `["/c","set TZ=UTC&& npm run dev"]` (or an equivalent that actually sets TZ on Windows), port 3000.
  - Create a QA tenant using the known flow (SQL users + `create_tenant_and_owner`, PIN 246810, magic-link session cookie). Add a staff user.
  - Seed today's bills covering every status, including one at 00:30 Bangkok, plus a bill yesterday with the same queue number as one today.
- [ ] **Step 2: Check times.** List and detail times match Bangkok (the 00:30 bill shows 00:30 on today's page). The held-bill and customer pages are also Bangkok.
- [ ] **Step 3: Check day navigation.** Date navigation, chips/counts, search (queue hit, queue miss message, bill-number search) and back-link state all work.
- [ ] **Step 4: Check the transfer flow.**
  - Ticking survives a reload.
  - Mark unpaid with a wrong PIN, then the right one: totals move and the badge shows.
  - Restore: the bill is back and unticked.
  - Method change: allowed in the open shift, disabled for a closed shift. The shift page's expected cash follows the change.
- [ ] **Step 5: Check totals.** The Dashboard today total equals the history's `ยอดขายสุทธิ`. The customer total excludes the unpaid bill. The POS today counter excludes it too.
- [ ] **Step 6: Check permissions.** As staff: no toggle and no new action buttons. Direct server-action calls (taking IDs from the page chunks) return errors, and direct Data-API PATCHes are rejected.
- [ ] **Step 7: Check layout.** No horizontal overflow at sidebar 224px and 64px. Screenshot the list (transfer view) and the detail for the user.
- [ ] **Step 8: Clean up.** Delete the QA tenants and users. Confirm the real tenant is untouched (`select count(*) from orders where status='unpaid'` = 0 outside QA).
- [ ] **Step 9: Final review.** Run one whole-branch review on the most capable model. Fix Critical/Important findings and record the minors.
