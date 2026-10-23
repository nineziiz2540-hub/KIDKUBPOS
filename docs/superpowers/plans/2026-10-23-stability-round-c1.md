# Round C1 — Reliable Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One tap on pay always ends clearly. The QR is drawn on the iPad with no network. A bill is saved in one database transaction, and its client-generated `client_ref` makes every retry return the same bill. The POS shows an "internet down" banner and a "new version" banner. The money maths gets unit tests.

**Architecture:**
- **New database function.** `order_create` is plpgsql, SECURITY INVOKER and service-role only. In one transaction it:
  - serialises on `client_ref`
  - returns any existing bill for that `client_ref`
  - checks the held bill
  - resolves the open shift
  - allocates the order number and queue number
  - inserts the order and its items
  - closes out the held bill
- **`createOrder` keeps the checks in TypeScript** (re-pricing, discount, cash, PIN) and then calls the function through the admin client.
- **The POS client changes in three ways:**
  - it keeps one `client_ref` per payment attempt, and the payment windows offer a safe retry
  - it asks the server whether a bill was saved when an attempt ended uncertain
  - it polls a small `/api/heartbeat` route that drives the connectivity banner, the version banner and the PromptPay ID refresh

**Tech Stack:** Next.js 16.2.9 App Router (webpack), React 19.2, Supabase (Postgres plpgsql, RLS), Serwist service worker, `promptpay-qr` + `qrcode`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-23-stability-round-c1-design.md`. Read it before starting. The spec governs where this plan is silent.

## Global Constraints

- **Next.js 16.** This is NOT the Next.js in your training data. Read the relevant guide in `node_modules/next/dist/docs/` before using a Next API.
- **One Supabase database for dev and production** (`khgahdjfkzpgsvbhfrqx`). A migration is live the moment it is applied.
  - Migration `20261023120000_order_create.sql` is additive only, and must not change anything today's deployed code reads or writes.
  - There is no restrictive migration in C1.
- **Database functions follow the round B pattern.**
  - plpgsql, `security invoker`, `set search_path = public`
  - `revoke all … from public, anon, authenticated; grant execute … to service_role`
  - called from server actions via `createAdminClient()`
- **Errors** are raised as `raise exception '<code>'` with short snake_case codes, and mapped to Thai in TypeScript.
- **Security rules unchanged:**
  - server re-pricing: `priceCartItems` must still reject a client `totalPrice` that differs from the database
  - manager PIN for large discounts
  - held-bill version check
  - cash needs an open shift: `guard_order_drawer` stays SECURITY DEFINER and keeps firing on the insert
  - tenant isolation
- **DB tests** are `supabase/tests/*.sql` DO blocks that end with `raise exception 'RESULT %'`, so everything rolls back. Run them with the Supabase MCP `execute_sql`, never with `apply_migration`.
- **Unit tests** run with `npm test` (`node --test "src/**/*.test.ts"`). A tested module and everything it imports must use relative imports with a `.ts` extension (as `src/lib/shift-math.ts` does), never `@/`, and no React or Next.
- **Regenerate types.** After applying the migration, regenerate `src/types/database.ts` with `generate_typescript_types` before running `tsc`.
- **Test data.** Test only on disposable QA tenants and delete them afterwards. Never touch the tenant "The Connect Brew&Bar". The QA flow is in memory `project_pending_backlog` §8.
- **UI.**
  - Verify live in the Browser pane at 1180×740.
  - Use element refs (`find`) for clicks.
  - Copy is Thai, short and plain.
- **Exact copy:**
  - Offline banner (C1): `⚠ เน็ตหลุด — ยังชำระเงินไม่ได้ชั่วคราว · แจ้งผู้จัดการ`
  - Update banner: `ระบบมีอัปเดตใหม่` with the button `แตะเพื่อรีเฟรช`
  - Retry button in both payment windows: `ลองอีกครั้ง`
  - Payment-window connection error: `การเชื่อมต่อสะดุด · กดลองอีกครั้งได้เลย ระบบจะไม่บันทึกบิลซ้ำ`
  - Last-resort warning, kept from today: `เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบหน้ารายการบิลก่อนกดชำระซ้ำ`
  - Old-tab message (request without `clientRef`): `กรุณารีเฟรชหน้า POS แล้วลองใหม่ (ระบบเพิ่งอัปเดต)`
- **The auto-reload never happens with anything in progress.** It needs an empty cart, no held bill loaded, no dialog open, and no payment attempt unresolved.
- **Push** only when the user says so. After a push, confirm a Vercel deployment started for that commit.

## Review Focus

1. **The cashier edits the cart after an uncertain attempt** that the check couldn't resolve. The cart changes, so the `client_ref` changes and a duplicate becomes possible. Expected: the last-resort warning stays visible in the cart until the next successful sale or a clear. Test: `payment-attempt` unit test that the fingerprint changes and the warning flag survives. The live check is in Task 8.
2. **The iPad sleeps and timers freeze.** Expected: on wake (`visibilitychange` to visible), a heartbeat runs at once and the banner reflects reality within one check. Test: `connectivity` unit test, where the `visible` event yields a `check-now` action.
3. **The session expired.** The heartbeat is redirected to `/login` (an HTML 200, or 3xx). Expected: no red "internet down" banner, because the network is fine. Test: `classifyHeartbeat` unit test on a non-JSON or redirected response returning `online`.
4. **A held-bill payment is replayed after its response was lost.** The held bill is now `paid`. Expected: the replay returns the same order, never "บิลพักถูกแก้ไข…". Tests: a DB test in Task 3 and a TS ordering check in Task 4.
5. **Two requests with the same `client_ref` race.** This can come from a double tap that slips past `submittingRef`, or a retry while the first is still in flight. Expected: exactly one bill, and both responses carry the same order number. Tests: a DB test of the lock path in Task 3, and a live parallel call in Task 8.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/cart-math.ts` (new) + test | Pure cart line/subtotal maths now inlined in `pos-screen.tsx` |
| `src/lib/cash.test.ts`, `src/lib/discount.test.ts` (new) | Tests for existing money modules |
| `src/lib/order-pricing-core.ts` (new) + test | Pure re-pricing over an already-fetched catalog; `order-pricing.ts` keeps the fetching |
| `src/lib/promptpay.ts` (new) + test | `buildPromptPayPayload` (client-safe) |
| `supabase/migrations/20261023120000_order_create.sql` (new) | `orders.client_ref` + unique index + `order_create` function |
| `supabase/tests/order_create_test.sql` (new) | Rolled-back DB test |
| `src/lib/order-create-errors.ts` (new) + test | Maps `order_create` error codes to Thai |
| `src/app/actions/orders.ts` (modify) | `createOrder` via `order_create`; new `checkOrderSaved` |
| `src/lib/payment-attempt.ts` (new) + test | Attempt fingerprint, so the `client_ref` lifecycle is testable |
| `src/lib/connectivity.ts` (new) + test | Pure connectivity state machine + heartbeat response classifier + `canAutoReload` |
| `src/app/api/heartbeat/route.ts` (new) | `GET` → `{ version, promptpayId }`, no-store |
| `src/lib/build-version.ts` (new) | One place that reads the build id (server + client) |
| `src/components/pos/use-heartbeat.ts` (new) | Hook: interval + events → connectivity + version + PromptPay ID |
| `src/components/pos/status-banners.tsx` (new) | Offline (red) and update (navy) bars |
| `src/components/pos/qr-payment-modal.tsx`, `cash-payment-modal.tsx`, `pos-screen.tsx`, `src/app/(shell)/pos/page.tsx` (modify) | Wiring |
| `src/app/sw.ts`, `next.config.ts` (modify) | Heartbeat is NetworkOnly; build id exposed to the client |
| `src/app/actions/payment.ts` (delete) | Replaced by local QR |

---

### Task 0: Reproduce the two failures on a QA tenant (no code)

**Purpose:** The spec requires proving each fix against the real failure. Record the results in the progress ledger.

- [ ] **Step 1:** Create a QA tenant using the QA flow:
  1. auth user
  2. `create_tenant_and_owner`
  3. PIN 246810
  4. a `promptpay_id`
  5. one category and two products (฿55, ฿50)
  6. an open shift with opening cash ฿1000

  Get a session cookie and log in on `kidkubpos-dev` (localhost:3000) in the Browser pane at 1180×740.
- [ ] **Step 2: QR hang.** Run this in the page with `javascript_tool`:
  ```js
  window.__realFetch = window.fetch; window.fetch = (u, o) => (o && o.method === 'POST') ? Promise.reject(new TypeError('Failed to fetch')) : window.__realFetch(u, o)
  ```
  Then add a product, choose โอน and press ชำระ. Expected (bug): the modal stays on `กำลังสร้าง QR…` for at least 30 s with no error and no retry. Screenshot it. Restore with `window.fetch = window.__realFetch`.
- [ ] **Step 3: Duplicate on retry.** Wrap fetch so the action POST reaches the server but its response is thrown away:
  ```js
  window.fetch = async (u, o) => { const r = await window.__realFetch(u, o); if (o && o.method === 'POST' && !window.__dropped) { window.__dropped = true; throw new TypeError('Failed to fetch') } return r }
  ```
  Pay a cash bill, see the connection warning, then pay the same cart again. Count the rows with SQL:
  ```sql
  select count(*) from orders where tenant_id = '<qa>'
  ```
  Expected (bug): 2 bills for one sale.
- [ ] **Step 4:** Keep the QA tenant for Tasks 2, 6 and 8. Delete it at the end of Task 8.

---

### Task 1: Money maths under test

**Files:**
- Create: `src/lib/cart-math.ts`, `src/lib/cart-math.test.ts`, `src/lib/cash.test.ts`, `src/lib/discount.test.ts`, `src/lib/order-pricing-core.ts`, `src/lib/order-pricing-core.test.ts`
- Modify: `src/lib/order-pricing.ts` (fetch, then delegate), `src/components/pos/pos-screen.tsx` (use `cart-math`), and `src/lib/notes.ts` (only if it has `@/` imports)

**Interfaces:**
- Produces:
  - `unitPrice(basePrice: number, modifiers: { priceDelta: number }[]): number`
  - `lineTotal(basePrice: number, modifiers: { priceDelta: number }[], quantity: number): number`
  - `cartSubtotal(items: { totalPrice: number }[]): number`

  All three compute in satang and return baht.
- Produces: `priceLines(items: CartItem[], catalog: PricingCatalog): { lines: PricedLine[]; subtotal: number } | { error: string }`, where:
  - `PricingCatalog = { products: Map<string, CatalogProduct>; linkedModifiers: Map<string, Set<string>>; modifiers: Map<string, CatalogModifier>; options: Map<string, CatalogOption> }`
  - the `Catalog*` row shapes are exactly the row shapes `priceCartItems` uses today
- `PricedLine`, `MAX_LINES`, `MAX_QTY`, `MAX_OPTIONS_PER_LINE` and the `STALE` message move to `order-pricing-core.ts`. `order-pricing.ts` re-exports `PricedLine`.
- `priceCartItems(supabase, tenantId, items)` keeps its signature and behaviour. It validates the input shape, fetches the same four queries, builds the catalog and calls `priceLines`.

- [ ] **Step 1: Write the failing tests.** These are the exact cases. Use the `node:test` + `assert/strict` style of `shift-math.test.ts`, and import with `./x.ts`.

  `cash.test.ts`
  - `computeChange(85.5, 100) === 14.5`
  - `computeChange(85.49999999999999, 85.5) === 0`
  - `computeChange(100, 99.99) === null`
  - `computeChange(10, 1_000_000.01) === null`
  - `computeChange(NaN, 100) === null`
  - `suggestCashAmounts(85)` deep-equals `[90, 100, 500, 1000]`
  - `suggestCashAmounts(135)` deep-equals `[140, 150, 200, 500]`
  - `suggestCashAmounts(1000)` deep-equals `[]`
  - `formatPrice(45.5) === "45.50"`
  - `formatPrice(85) === "85"`

  `discount.test.ts`
  - `computeDiscount(171, "percent", 10)` → `{ discountAmount: 17.1, requiresApproval: false, total: 153.9 }`. Compare `total` via `toSatang`.
  - `computeDiscount(100, "percent", 21).requiresApproval === true`
  - `computeDiscount(1000, "amount", 100).requiresApproval === false`
  - `computeDiscount(1000, "amount", 100.01).requiresApproval === true`
  - `computeDiscount(50, "amount", 80).discountAmount === 50`
  - `computeDiscount(50, "percent", 150).discountAmount === 50`
  - `computeDiscount(50, null, 10).discountAmount === 0`
  - `computeDiscount(50, "percent", -5).discountAmount === 0`

  `cart-math.test.ts`
  - `unitPrice(55, [{priceDelta:10},{priceDelta:-5}]) === 60`
  - `lineTotal(0.1, [{priceDelta:0.2}], 3) === 0.9`. This one fails with float maths and passes with satang maths.
  - `lineTotal(55, [], 2) === 110`
  - `cartSubtotal([{totalPrice:0.1},{totalPrice:0.2}]) === 0.3`

  `order-pricing-core.test.ts`. Build a catalog: a latte at ฿55, linked to the required single-select modifier "ขนาด" with options ใหญ่ +10 and เล็ก 0, plus an optional multi-select "ท็อปปิ้ง" with option ไข่มุก +5.
  - a valid line `qty 2`, options ใหญ่ + ไข่มุก, `totalPrice 140` → `subtotal 140`, `unitPrice 70`, snapshot of 2 entries
  - `totalPrice 139` → `{ error: STALE }`
  - a missing required "ขนาด" → STALE
  - both ใหญ่ and เล็ก (single-select) → `"ข้อมูลสินค้าในตะกร้าไม่ถูกต้อง"`
  - an option from an unlinked modifier → STALE
  - an archived product → STALE
  - a duplicate option id in one line → `"ข้อมูลสินค้าในตะกร้าไม่ถูกต้อง"`
  - a note of 201 characters → `"หมายเหตุไม่ถูกต้อง (ไม่เกิน 200 ตัวอักษร)"`
- [ ] **Step 2:** Run `npm test`. Expected: the new files FAIL (modules missing), and the existing suites pass.
- [ ] **Step 3: Implement.** Move the per-line loop of `priceCartItems` (`order-pricing.ts:107-162`) into `priceLines` unchanged. Replace the inline maths in `pos-screen.tsx` with `unitPrice`/`lineTotal`/`cartSubtotal`:
  - `addDirectToCart`, `updateQty`, `subtotal`, the held-bill panel `sub`
  - `repriceFromMenu`, if it does line maths
  - the modifier modal's line total, if it computes one in the same way

  **Changing the maths to satang must not change any whole-baht result.**
- [ ] **Step 4:** Run `npm test`, `npx tsc --noEmit` and `npm run lint`. Expected: all pass.
- [ ] **Step 5:** Commit: `test(money): unit tests for cash, discount, cart and re-pricing maths; pure pricing core`.

---

### Task 2: QR drawn on the iPad

**Files:**
- Create: `src/lib/promptpay.ts`, `src/lib/promptpay.test.ts`
- Modify: `src/components/pos/qr-payment-modal.tsx`, `src/components/pos/pos-screen.tsx`, `src/app/(shell)/pos/page.tsx`
- Delete: `src/app/actions/payment.ts`. Grep for other importers first; there should be none.

**Interfaces:**
- Produces: `buildPromptPayPayload(promptpayId: string, amount: number): string`. It wraps `promptpay-qr`'s default export and rounds the amount to satang first.
- `PosScreen` gains the prop `promptpayId: string | null`. In Task 6 it is held in state, so the heartbeat can update it.
- `QrPaymentModal` props become: `{ total: number; promptpayId: string | null; pending: boolean; error: string | null; onConfirm: () => void; onCancel: () => void }`
  - `pending` replaces the internal `isConfirming`. The parent owns it, so a failed confirm re-enables the button.
  - `error` shows under the QR, with the confirm button relabelled `ลองอีกครั้ง`. This is wired in Task 5. For this task, pass `pending={checkoutPending}` and `error={null}`.

- [ ] **Step 1: Failing test.**
  - `buildPromptPayPayload("0812345678", 160)` equals `generatePayload("0812345678", { amount: 160 })`.
  - `buildPromptPayPayload("0812345678", 85.49999999999999)` equals the payload for `85.5`.
  - The payload starts with `"000201"`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The modal builds the payload synchronously and calls `QRCode.toDataURL` in an effect, with a `.catch` that sets `{ status: "error", message: "สร้าง QR ไม่สำเร็จ" }`.
  - With `promptpayId === null`, it renders `ร้านยังไม่ได้ตั้งค่า PromptPay ID กรุณาไปที่หน้าตั้งค่า` at once.
  - There is no server call anywhere in the modal.
  - `page.tsx` loads `getTenantPromptPayId(profile.tenant_id)` inside the existing `Promise.all`.
- [ ] **Step 4:** Run `npm test` and `npx tsc --noEmit`. Then **repeat the Task 0 Step 2 simulation**. Expected: the QR image appears within 1 s while POSTs are blocked. Screenshot it.
- [ ] **Step 5:** Commit: `fix(pos): draw the PromptPay QR on the device — no server round trip, no endless spinner`.

---

### Task 3: `order_create` — one transaction, idempotent on `client_ref`

**Files:**
- Create: `supabase/migrations/20261023120000_order_create.sql`, `supabase/tests/order_create_test.sql`
- Modify: `src/types/database.ts` (regenerated)

**Interfaces:**
- **Column.**
  - `orders.client_ref uuid null`, with the comment `'Client-generated id of the payment attempt; a retry with the same id returns this order.'`
  - Index: `create unique index orders_tenant_client_ref on public.orders (tenant_id, client_ref) where client_ref is not null;`
- **Function signature:**
  ```
  order_create(
    p_tenant_id uuid,
    p_actor_id uuid,
    p_client_ref uuid,
    p_order jsonb,
    p_items jsonb,
    p_held_bill_id uuid,
    p_held_bill_version int,
    p_held_reductions jsonb
  )
  returns table (order_id uuid, order_number text, queue_number int, cash_received numeric, change_amount numeric, created boolean)
  ```
- **`p_order` keys:**
  - `payment_method`, `order_type`
  - `subtotal`, `total`, `cash_received`, `change_amount`
  - `discount_type`, `discount_value`, `discount_amount`, `discount_reason`, `discount_approved_by`
  - `customer_id`, `note`
- **`p_items`** is an array of `{ product_id, product_name, unit_price, quantity, subtotal, category_name, modifiers_snapshot, note }`.
- **`p_held_reductions`:**
  - a jsonb array; `[]` when none
  - ignored when `p_held_bill_id` is null
- **Error codes:**
  - `forbidden`: from `shift_assert_actor(p_tenant_id, p_actor_id)`; reuse it
  - `invalid_client_ref`: when `p_client_ref` is null
  - `held_bill_stale`: not found in the tenant, not `open`, or the version differs
  - `no_open_shift` / `shift_closed`: raised by `guard_order_drawer` unchanged
  - any other failure (a foreign key or check violation) aborts the whole call

**Body order** (this is the contract):
1. `shift_assert_actor`.
2. `perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || p_client_ref::text, 0))`.
3. If an order with `(p_tenant_id, p_client_ref)` exists, return it with `created = false`. Run no other check.
4. Held bill. When `p_held_bill_id` is not null: `select … for update` the row, then check its tenant, `status = 'open'` and version.
5. Open shift: `select id from shifts where tenant_id = p_tenant_id and status = 'open' for share`. It may be null; the guard decides for cash.
   - `for share` makes a concurrent `shift_close` wait for this transaction. That removes the round B race where a transfer was refused with `shift_closed`. Note this in the commit message.
6. Order number via `generate_order_number(p_tenant_id)`. Queue number is the held bill's `queue_number`, otherwise `next_queue_number(p_tenant_id)`.
7. Insert the order, with `created_by = p_actor_id`, `shift_id`, `held_bill_id = p_held_bill_id`, `client_ref = p_client_ref`, and the values from `p_order`. Then insert the `order_items` rows from `p_items`.
8. Held bill close-out:
   - update the held bill to `status = 'paid'`, `updated_by = p_actor_id`, `updated_at = now()`
   - insert `held_bill_events`: an `items_reduced` event with `{ reductions, at_payment: true }` when the reductions are non-empty, then a `paid` event with `{ order_id, order_number, total }`
9. Return the row with `created = true`.

- [ ] **Step 1: Failing DB test** `order_create_test.sql`. Follow the structure of `supabase/tests/shift_management_test.sql`: a throwaway tenant and owner made inside the DO block, and results collected into a jsonb that is raised at the end. Keys and expected values:
  - `first_created = true`
  - `replay_created = false`
  - `replay_same_number = true`
  - `replay_items_not_doubled = true`: the item count after the replay equals the count after the first call
  - `replay_after_shift_closed = true`: close the shift by direct update with `clock_timestamp()`, then replay a cash ref; it returns the same order
  - `held_paid = true`
  - `held_events = 'items_reduced,paid'`
  - `held_queue_kept = true`
  - `held_replay_ok = true`: replay the held-bill ref after the bill is paid; same order, no exception
  - `held_stale = 'held_bill_stale'`
  - `cash_no_shift = 'no_open_shift'`
  - `bad_item_rolls_back = true`: an item with an unknown `product_id` makes the call fail, and no order row with that ref exists afterwards
  - `same_ref_other_tenant_created = true`
  - `actor_other_tenant = 'forbidden'`
  - `null_ref = 'invalid_client_ref'`
  - `authenticated_cannot_execute = true`: check with `has_function_privilege('authenticated', 'public.order_create(uuid,uuid,uuid,jsonb,jsonb,uuid,int,jsonb)', 'execute') = false`, and the same for `anon`
- [ ] **Step 2:** Run the test with `execute_sql`. Expected: an error, because the function does not exist.
- [ ] **Step 3:** Write the migration. Its header comment must say three things: it is additive; today's deployed code never sends `client_ref`, and a null `client_ref` never conflicts; and there is no restrictive follow-up. Apply it with `apply_migration`, then regenerate the types.
- [ ] **Step 4:** Run the test. Expected: `RESULT {…}` with every key at its expected value. Run `shift_management_test.sql` and `order_adjustments_test.sql` too; they must still be green. Run `get_advisors` (security); nothing new is expected.
- [ ] **Step 5:** Commit: `feat(db): order_create — one-transaction, idempotent bill write keyed by client_ref`.

---

### Task 4: `createOrder` through `order_create`, plus `checkOrderSaved`

**Files:**
- Create: `src/lib/order-create-errors.ts`, `src/lib/order-create-errors.test.ts`
- Modify: `src/app/actions/orders.ts`, `src/types/app.ts`

**Interfaces:**
- Consumes: `order_create` (Task 3), `priceCartItems` (Task 1).
- `CreateOrderInput` gains `clientRef: string`.
- `createOrder` keeps its return type. Success adds nothing new, so the client can't tell a replay from a first save; that is intended.
- Produces:
  ```
  checkOrderSaved(clientRef: string): Promise<
    | { saved: true; orderNumber: string; queueNumber: number; cashReceived: number | null; changeAmount: number | null }
    | { saved: false }
    | { error: string }
  >
  ```
  It uses the user's RLS client, `orders` `where tenant_id = profile.tenant_id and client_ref = clientRef`, and `maybeSingle`. It returns `{ saved: false }` for a malformed uuid.
- Produces: `orderCreateErrorMessage(dbMessage: string): string | null`. It returns:
  - `held_bill_stale` → `"บิลพักนี้ถูกแก้ไข ชำระ หรือยกเลิกไปแล้ว กรุณาเปิดรายการบิลพักใหม่"`
  - `forbidden` → `"ไม่มีสิทธิ์ทำรายการนี้"`
  - `invalid_client_ref` → the old-tab message
  - for `no_open_shift` / `shift_closed`, it delegates to the existing `orderInsertShiftError`
  - `null` for anything else

**New order of `createOrder`:**
1. `getProfile`.
2. Validate `clientRef` with the uuid regex `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`. If it fails, return the old-tab message.
3. **Replay first:** the admin client selects `id, order_number, queue_number, cash_received, change_amount` where `tenant_id` and `client_ref` match. If found, return it as success; no other check runs.
4. Re-price, then discount, then cash, then PIN, as today. Read the held bill only to compute `diffReductions`, and drop today's version check, because the function owns it.
5. Call `createAdminClient().rpc("order_create", …)`. On error, map it with `orderCreateErrorMessage`; otherwise return `"บันทึกออเดอร์ไม่สำเร็จ"`.
6. If `created` is true: `deduct_stock_for_order` with the **user's** client, best-effort and logged as today. Then `revalidatePath("/pos")` if this was a held bill, and `revalidatePath("/orders")`.
7. Remove the hand-written rollback and the `mayHaveSaved` server paths. The `mayHaveSaved` field stays in the type for the client catch.

- [ ] **Step 1: Failing test** `order-create-errors.test.ts`. Each code maps to its exact string. An unknown message returns `null`. A Postgres message such as `"held_bill_stale"`, embedded the way PostgREST returns it, still maps.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement as above. Grep for every other caller of `createOrder` and keep each one compiling. The only caller should be `pos-screen.tsx`, which passes `clientRef` in Task 5. Until then, pass `crypto.randomUUID()` at the call site so the build stays green.
- [ ] **Step 4:** Run `npm test`, `npx tsc --noEmit` and `npm run lint`. Live on the QA tenant, check four things:
  1. A cash sale, then a transfer sale. Both are saved with items, number, queue and shift.
  2. Replay. Call `createOrder` twice from the page with the same `clientRef` by running the action through the UI twice with the ref fixed in devtools, or call it in a small `javascript_tool` harness. Expect the same `orderNumber` and one row.
  3. Price tamper. Edit a cart line's `totalPrice` in React state via devtools and pay. Expect the STALE message and no row.
  4. A held bill paid through the new path is closed, with a `paid` event.
- [ ] **Step 5:** Commit: `feat(orders): createOrder writes through order_create; replays return the saved bill; checkOrderSaved`.

---

### Task 5: POS payment attempts — one `client_ref`, safe retry, check on close

**Files:**
- Create: `src/lib/payment-attempt.ts`, `src/lib/payment-attempt.test.ts`
- Modify: `src/components/pos/pos-screen.tsx`, `src/components/pos/qr-payment-modal.tsx`, `src/components/pos/cash-payment-modal.tsx`

**Interfaces:**
- Consumes: `createOrder` with `clientRef`, and `checkOrderSaved` (Task 4).
- Produces: `attemptFingerprint(input: { items: CartItem[]; paymentMethod: string; orderType: string; customerId: string | null; discountType: string | null; discountValue: string; heldBillId: string | null; heldBillVersion: number | null }): string`. It is a stable JSON of exactly these fields.
- `CashPaymentModal` gains `retryable: boolean`. When true, it shows the payment-window connection error and relabels confirm as `ลองอีกครั้ง`. `QrPaymentModal` uses its `error` prop the same way.

**Behaviour:**
- **The ref.** `PosScreen` keeps `attemptRef = useRef<{ fingerprint: string; clientRef: string } | null>(null)`.
  - `submitOrder` computes the fingerprint. It reuses `attemptRef.current.clientRef` if the fingerprint matches; otherwise it makes a new `crypto.randomUUID()`.
  - The ref is cleared on success and in `clearCart`.
- **A thrown createOrder** (network) keeps the window open with `retryable = true`. This replaces today's "close and warn" for cash. Retry calls `submitOrder` again, which reuses the same ref.
- **A returned error** (validation, PIN, held stale, no shift) behaves as today.
- **Cancelling** a window while `retryable` is set:
  1. Call `checkOrderSaved(clientRef)`.
  2. If saved, apply the exact success path. Extract today's success branch into `applySuccess(result)` and use it for both.
  3. If not saved, close the window and keep the cart and the ref.
  4. If the check throws, close, keep the cart, and set the cart `error` to the last-resort warning with `mayHaveSaved`.
- **The last-resort warning** stays until the next success or `clearCart`. Today, `submitOrder` clears `error` at its start; keep that, because a new attempt with the same ref is safe.
- **QR confirm** no longer closes the window on failure. `handleQrConfirm` closes only on success, or on a returned (non-network) error, as today.

- [ ] **Step 1: Failing test** `payment-attempt.test.ts`:
  - the same input gives the same fingerprint
  - changing any one field (an item quantity, the payment method, the discount value, the held version) changes it
  - item order matters, since `cartItems` order is stable
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, `npx tsc --noEmit` and `npm run lint`. **Repeat Task 0 Step 3** (drop the first response):
  - Expected: the window stays open with the connection message. `ลองอีกครั้ง` then shows the success state with the **same** order number, and SQL shows 1 bill.
  - Repeat with cancel instead of retry. Expected: the check finds the bill, success is shown, and the cart is cleared.
  - Repeat on the QR window.

  Screenshot each.
- [ ] **Step 5:** Commit: `fix(pos): payment retries reuse one client_ref; closing an uncertain payment checks whether it saved`.

---

### Task 6: Heartbeat, connectivity and version banners, PromptPay refresh

**Files:**
- Create: `src/lib/build-version.ts`, `src/lib/connectivity.ts`, `src/lib/connectivity.test.ts`, `src/app/api/heartbeat/route.ts`, `src/components/pos/use-heartbeat.ts`, `src/components/pos/status-banners.tsx`
- Modify: `next.config.ts`, `src/app/sw.ts`, `src/components/pos/pos-screen.tsx`

**Interfaces:**
- **`build-version.ts`.**
  - `BUILD_VERSION: string = process.env.NEXT_PUBLIC_BUILD_VERSION ?? "dev"`
  - `next.config.ts` sets `env: { NEXT_PUBLIC_BUILD_VERSION: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" }`, so the server and the client of one build carry the same value
  - Check `node_modules/next/dist/docs` for `env` and `deploymentId` first. If Next 16 already exposes the deployment id to the client in a supported way, use that instead and note it in the commit.
- **Heartbeat route.** `GET /api/heartbeat` returns `{ version: BUILD_VERSION, promptpayId: string | null }`.
  - headers: `Cache-Control: no-store`
  - `promptpayId` is null when there is no profile
  - `export const dynamic = "force-dynamic"`, if Next 16 still uses it (check the docs)
- **Service worker.** `sw.ts` puts `{ matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname === "/api/heartbeat", handler: new NetworkOnly() }` **before** `...defaultCache`. Without it, Serwist's NetworkFirst would answer an offline heartbeat from the cache, and the banner would never show.
- **`connectivity.ts`** (pure). It produces:
  - `type Connectivity = { status: "online" | "offline"; failures: number }`
  - `const OFFLINE_AFTER_FAILURES = 2`, `HEARTBEAT_INTERVAL_MS = 30_000`, `HEARTBEAT_TIMEOUT_MS = 5_000`
  - `nextConnectivity(state: Connectivity, event: "success" | "failure" | "browser-offline"): Connectivity`. `browser-offline` goes offline immediately. `failure` goes offline at `failures + 1 >= OFFLINE_AFTER_FAILURES`. `success` resets to online with 0 failures.
  - `classifyHeartbeat(res: { ok: boolean; redirected: boolean; contentType: string | null }): "online" | "signed-out" | "failure"`. These run only for a fetch that resolved:
    - `redirected`, or a non-JSON content type → `signed-out`, which counts as `success` for connectivity
    - `!ok` with 5xx → `failure`
    - otherwise → `online`
  - `canAutoReload(s: { cartCount: number; heldLoaded: boolean; anyDialogOpen: boolean; paymentUnresolved: boolean }): boolean`
- **`use-heartbeat.ts`.** It produces `useHeartbeat(): { connectivity: Connectivity; newVersionAvailable: boolean; promptpayId: string | null | undefined }`. Here `undefined` means "no answer yet", so the caller keeps its server-rendered value.
  - It checks on mount, every `HEARTBEAT_INTERVAL_MS` while `document.visibilityState === "visible"`, immediately on `visibilitychange` to visible, and on `online`.
  - `offline` feeds `browser-offline`.
  - Each fetch has an `AbortController` timeout of `HEARTBEAT_TIMEOUT_MS`.
  - `newVersionAvailable` is set when the response `version` differs from `BUILD_VERSION` and neither is `"dev"`.
  - It exposes `checkNow()` for the POS to call after a thrown `createOrder`.
- **`StatusBanners({ offline: boolean; updateAvailable: boolean; onRefresh: () => void })`.**
  - Offline is the red bar with the exact C1 copy. It takes priority: when offline, the update bar is hidden.
  - Update is the navy bar with the button.
  - Both are full width at the top of the POS content, above the menu and cart. They must not cover the cart's pay button at 1180×740 or on mobile.
- **`PosScreen`:**
  - holds `promptpayId` in state, initialised from the prop and updated when the hook returns a string or null
  - auto-reloads with `window.location.reload()` when `newVersionAvailable && canAutoReload(...)`, re-evaluated whenever its inputs change
  - `anyDialogOpen` covers every modal or panel flag: QR, cash, hold, held panel, no-shift, modifier, mobile cart, discount modal, note editor and approval pad. Grep `useState(false)` and the child dialogs to make the list complete.

- [ ] **Step 1: Failing test** `connectivity.test.ts`:
  - one failure stays online
  - two failures go offline
  - a success after offline goes online with 0 failures
  - `browser-offline` goes offline at once
  - `classifyHeartbeat({ok:true, redirected:true, contentType:"text/html"}) === "signed-out"`
  - `classifyHeartbeat({ok:false, redirected:false, contentType:"application/json"}) === "failure"`
  - `classifyHeartbeat({ok:true, redirected:false, contentType:"application/json; charset=utf-8"}) === "online"`
  - `canAutoReload` is true only for `{0, false, false, false}`, and false when any single field flips
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, `npx tsc --noEmit` and `npm run lint`. Live checks:
  1. Override `fetch` so that `/api/heartbeat` rejects. The red bar appears after 2 checks; temporarily lower the interval via devtools, or wait. It disappears after one success.
  2. A single injected failure shows no bar.
  3. Return a different `version` from a patched fetch. With an empty cart, the page reloads. With an item in the cart, only the bar shows, and tapping it reloads.
  4. Change the QA tenant's `promptpay_id` by SQL, then trigger `visibilitychange` (switch tabs). The next QR encodes the new id. Decode it by comparing `buildPromptPayPayload(newId, total)` with the payload the modal used.

  Screenshot the bars at 1180×740 and at 375×812.
- [ ] **Step 5:** Commit: `feat(pos): internet-down and new-version banners from a heartbeat; PromptPay ID stays current`.

---

### Task 7: Vercel auto-deploy and Supabase backups (investigate and report)

**Files:** none, unless the investigation finds a repo-side cause (for example a `vercel.json` or an ignored build step). Then make that fix with its own commit.

- [ ] **Step 1: Vercel.** Use the Vercel MCP:
  - `get_project kidkubpos` (team `the-connect-pos-projects`): look at the git link, the production branch, and `commandForIgnoringBuildStep`
  - `get_deployment dpl_D3ce7rdyUWs9BXwyVtAcd2YUFgVU`: what triggered it? It is the second deployment of `ae9c703`, created 974 s after the manual one. Compare its `source` and `meta` with `dpl_GXc7vBF6NJVupSykTdehYKAUnmws`.

  Decide which it is: the auto-deploy is **delayed** (queued or slow), **missing**, or a **repo-side** problem. Changing a Vercel or GitHub setting is an account-settings change, so write the exact steps for the user and do **not** change it yourself.
- [ ] **Step 2: Backups.** Use `search_docs` on Supabase for the FREE plan's backups, point-in-time recovery and restore. Check `get_project` / `get_organization` for the plan. Write down:
  - what exists today
  - what is lost if the database is damaged
  - the options: a paid tier, or a scheduled `pg_dump` the user owns
- [ ] **Step 3:** Put both findings in the progress ledger. They are reported to the user in Thai at the end of C1, with a recommendation for each. Nothing is changed without the user's yes.

---

### Task 8: Whole-round verification and clean-up

- [ ] **Step 1:** Run `npm test`, `npx tsc --noEmit` and `npm run lint`. Then run `npm run build`: stop the preview first, and restart it afterwards. All must pass.
- [ ] **Step 2: DB suites:** `order_create_test.sql`, `shift_management_test.sql`, `order_adjustments_test.sql`, `shift_lockdown_test.sql`. All must be green.
- [ ] **Step 3: Live, on the QA tenant, at 1180×740.** Check each of these:
  1. Normal cash and transfer sales, then a held-bill payment, then a discount needing the PIN.
  2. The Task 0 Step 2 simulation: the QR appears.
  3. The Task 0 Step 3 simulation: one bill, via retry and via cancel.
  4. **Review Focus 5:** two `createOrder` calls in parallel with the same `clientRef`, using `Promise.all` from the page. Both return the same order number, and SQL shows 1 row.
  5. **Review Focus 1:** an uncertain attempt where the check is also blocked. The warning stays after editing the cart, and clears on the next success.
  6. **Review Focus 3:** expire the session by clearing the auth cookie. No red bar appears.
  7. The round B shift close still matches the expected cash, including the new bills.
- [ ] **Step 4:** Delete the QA tenant: the purge loop with `kidkub.allow_purge`, then profiles, the tenant and `auth.users`. Confirm that nothing with the QA tenant id remains.
- [ ] **Step 5:** Final whole-branch review on the most capable model (`superpowers:requesting-code-review`). Fix Critical and Important findings, and record Minor ones in memory.
- [ ] **Step 6:** Update memory: a new `project_stability_round_c1.md`, `project_pending_backlog.md` and `MEMORY.md`. Report to the user in Thai:
  - what changed
  - the proof
  - the Vercel and backups findings with a recommendation
  - that this is ready for their push go-ahead and the iPad test

  Do not push until the user says so.
