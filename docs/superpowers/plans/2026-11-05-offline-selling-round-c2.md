# Round C2 — Selling While Offline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the shop's internet drops, the POS keeps selling. Bills are kept on the iPad (with queue number, real sale time, seller and shift), shown under a red bar with a count, and sent by themselves when the connection is back. A bill the server refuses is kept for the manager to "record as charged" with a PIN. Nothing is ever lost or recorded twice.

**Architecture:**
- **Database.** A new service-role function `order_record` replaces `order_create`. It has the same online behaviour, plus an optional `p_offline` object. That object:
  - keeps the device's queue number, raising that day's counter
  - uses the sale time
  - uses the recorded shift
  - flags the bill `sold_offline`
  - may log an `offline_override` adjustment

  A small `queue_counter_raise` function reserves the numbers of refused bills. `order_create` is dropped after the deploy (two-phase).
- **Server.**
  - `createOrder` gains `offline` and `override` inputs, and returns a machine-readable `outcome` (`retry` / `review` / `refused`).
  - The heartbeat also returns the open shift and today's last queue number.
- **Device.**
  - An IndexedDB **outbox** holds every payment attempt, with states `attempt` → `check-only` / `pending` → `review`.
  - A single **sender** (Web Locks) sends `pending` bills oldest first, with backoff.
  - A **device snapshot** keeps the latest shift, queue and PromptPay info.
  - A **cart draft** survives reloads.
  - Pure rules live in `src/lib/offline/*.ts` and are unit-tested. Browser glue lives in hooks.
- **Service worker.** A dedicated `/pos` page cache: NetworkFirst with a 4 s timeout, no expiry, and never a redirect. Plus an `/offline.html` fallback for other pages.

**Tech Stack:** Next.js 16.2.9 App Router (webpack), React 19.2, Supabase (plpgsql, RLS), Serwist 9.5 (`@serwist/next`, `serwist`), IndexedDB (no new dependency), Web Locks API, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-05-offline-selling-round-c2-design.md`. Read it first: it governs wherever this plan is silent. Its "Claude's calls" are numbered, and this plan cites them as **(call N)**.

**Already done:** spec goal 1, the reload-on-online fix. It shipped as `480b7ca` on 2026-11-05 (`reloadOnOnline: false` in `next.config.ts`). Do not undo it.

## Global Constraints

- **Next.js 16.** This is NOT the Next.js in your training data. Read the relevant guide in `node_modules/next/dist/docs/` before using a Next API.
- **One Supabase database for dev and production** (`khgahdjfkzpgsvbhfrqx`). A migration is live the moment it is applied.
  - Task 1's migration is **additive only**. Today's deployed code keeps calling `order_create` and must keep working.
  - The drop of `order_create` is a separate migration, applied **only after** the C2 deploy is live (Task 12).
- **No function overloads.** Never create a second signature under an existing function name. This was a past production bug: PostgREST named-argument ambiguity.
- **Database functions:**
  - plpgsql, `security invoker`, `set search_path = public`
  - `revoke all … from public, anon, authenticated; grant execute … to service_role`
  - called from server actions via `createAdminClient()`
  - errors raised as `raise exception '<snake_code>'` and mapped in TypeScript
- **Security rules unchanged:**
  - server re-pricing (`priceCartItems` still rejects a client `totalPrice` that differs from the database)
  - manager PIN for large discounts
  - held-bill version check
  - cash needs an open shift (`guard_order_drawer` stays SECURITY DEFINER and fires on every insert)
  - tenant isolation

  The **only** exception is `override`. It needs a bcrypt-verified owner/manager PIN and writes an `order_adjustments` row.
- **The manager PIN is never stored on the device**: not in the outbox, not in the cart draft, not in `localStorage`.
- **No new runtime dependencies.** IndexedDB goes through a small wrapper, `src/lib/offline/idb.ts`.
- **Unit tests** run with `npm test` (`node --test "src/**/*.test.ts"`). A tested module and everything it imports use relative `.ts` imports, never `@/`, and no React, Next or browser globals.
- **DB tests** are `supabase/tests/*.sql` DO blocks ending with `raise exception 'RESULT %'`, so everything rolls back. Run them with the Supabase MCP `execute_sql`, never `apply_migration`.
- **Regenerate** `src/types/database.ts` with `generate_typescript_types` after each migration, before `tsc`.
- **Offline is verified on a production build.**
  - Serwist is disabled in `npm run dev`. Stop any dev server, run `npm run build`, then start the Browser-pane config `kidkubpos-prod-local` (`npm run start`, port 3000).
  - "Internet down" = stop that server (`preview_stop`). "Back" = start it again.
  - `npm run build` while a server runs clashes on `.next`, so stop it first.
- **Test data.** Use disposable QA tenants only, and delete them afterwards. Never touch "The Connect Brew&Bar". The QA flow and clean-up are in memory `project_pending_backlog` §8.
- **UI.** Verify in the Browser pane at 1180×740, and use element refs (`find`) for clicks.
- **Exact copy** (Thai, verbatim):
  - Red bar: `⚠ เน็ตหลุด — บิลจะถูกเก็บไว้ในเครื่องก่อน · แจ้งผู้จัดการ`, and at the right `ค้างส่ง N บิล`
  - Yellow bar: `⟳ เน็ตกลับมาแล้ว — กำลังส่งบิลขึ้นระบบ…`, and at the right `S / T`
  - Green bar: `✓ ส่งบิลครบแล้ว T บิล`. It hides after 5 s.
  - Offline sale result: `คิว Q` · `บันทึกไว้ในเครื่องแล้ว ✓` · `รอส่งขึ้นระบบเมื่อเน็ตกลับมา` · `เลขบิลจะได้หลังส่งขึ้นระบบ`
  - Disabled reasons:
    - offline: `ใช้ไม่ได้ตอนเน็ตหลุด`
    - online but bills still pending: `รอส่งบิลค้างให้ครบก่อน`
  - Payment-window button: `บันทึกไว้ในเครื่อง`
  - Review bar: `บิลส่งไม่ผ่าน N บิล · ให้ผู้จัดการตรวจ`
  - Review action: `บันทึกตามยอดที่เก็บจริง`
  - Review reasons:
    - `menu_changed` → `ราคาหรือเมนูมีการเปลี่ยนแปลงระหว่างเน็ตหลุด`
    - `held_bill_stale` → the existing held-bill message
    - `shift_closed` → `กะที่เปิดอยู่ตอนขายถูกปิดไปแล้ว`
    - `needs_approval` → `ส่วนลดนี้ต้องให้ผู้จัดการอนุมัติ`
    - `seller_inactive` → `พนักงานที่ขายบิลนี้ถูกปิดใช้งานแล้ว`
    - `product_missing` → `มีเมนูในบิลที่ถูกลบไปแล้ว บันทึกไม่ได้`
    - `other` → the server's message
  - Close-shift block: `ยังมีบิลค้างส่ง N บิล · รอส่งให้ครบก่อนปิดกะ`
  - Logout warning: `ยังมีบิลค้างส่ง N บิลในเครื่องนี้ · บิลยังอยู่ในเครื่อง และจะส่งเมื่อเข้าสู่ระบบร้านนี้อีกครั้ง`
  - Cart restored: `กู้ตะกร้าที่ค้างไว้`
  - History label: `ขายตอนเน็ตหลุด`
- **Push** only when the user says so. After a push, confirm a Vercel deployment started for that commit.

## Review Focus

These are the inputs and failures the spec implies that are most likely to bite. Each has a test in the task named.

1. **A crash or reload in the middle of an online payment.** On the next start the leftover `attempt` entry must become `check-only` and be resolved. It must never be sent as a new bill, and never silently dropped. → Task 3 `startupRecovery` tests, Task 7 live check.
2. **An offline sale at 23:58 that syncs at 00:05.** Its queue number belongs to the *sale* day. The server raises the counter of the sale's business date, not today's, and the device's own counter resets at Bangkok midnight. → Task 1 DB test `offline_midnight`, Task 3 `nextDeviceQueue` tests.
3. **Two app tabs open (iPad and PC) when the connection returns.** Exactly one sender runs, and the same `client_ref` never makes two bills even if both send. → Task 1 `replay_offline`, Task 7 Web Locks + live two-tab check.
4. **A different shop signs in on the same iPad while bills are pending.** Nothing is sent to the wrong shop and nothing is deleted. → Task 2 `wrong_tenant` test, Task 7 sender filters by tenant.
5. **A refused bill's queue number clashing with later online numbers.** After the refusal, `queue_counter_raise` lifts the counter, so the next server number is higher. → Task 1 `raise_counter` test, Task 7 live check.

---

### Task 1: Database — `order_record`, `queue_counter_raise`, `sold_offline`, `offline_override`

**Files:**
- Create: `supabase/migrations/20261105120000_order_record.sql`
- Create: `supabase/tests/order_record_test.sql`
- Modify: `src/types/database.ts` (regenerated)

**Interfaces:**
- Produces:
  - `order_record(p_tenant_id uuid, p_actor_id uuid, p_client_ref uuid, p_order jsonb, p_items jsonb, p_held_bill_id uuid, p_held_bill_version int, p_held_reductions jsonb, p_offline jsonb)`. It returns the same table as `order_create`: `(order_id, order_number, queue_number, cash_received, change_amount, created boolean)`.
  - `p_offline` is either null (online) or:

    ```
    { "sold_at": timestamptz text, "queue_number": int, "shift_id": uuid|null,
      "override": null | { "approver_id": uuid, "reason": text,
                           "server_total": numeric|null, "charged_total": numeric } }
    ```

  - `queue_counter_raise(p_tenant_id uuid, p_actor_id uuid, p_business_date date, p_queue_number int) returns void`
  - Column `orders.sold_offline boolean not null default false`
  - `order_adjustments.kind` also allows `'offline_override'`
  - New error code `offline_shift_closed`

- [ ] **Step 1: Write the migration.**
  - **`orders.sold_offline`.** Add the column, with a comment.
  - **The `order_adjustments_kind_check` constraint.** Drop it and re-add it with the 4 kinds. This widens it only, so it stays additive.
  - **`order_record`.** It starts as a copy of `order_create`'s body (migration `20261023120000`). When `p_offline` is null the behaviour is byte-for-byte the same. When it isn't:
    - **Replay** stays first and is unchanged.
    - **Held-bill check** is unchanged. A held bill's queue number still wins over `queue_number`.
    - **Shift.** Read the recorded `shift_id` `FOR SHARE`, and use it only if it is the same tenant and `status='open'`. Otherwise use null. Raise `offline_shift_closed` if the result is null and `payment_method='cash'` (call 5).
      - Exception: when `override` is set and the bill is cash, use the currently open shift instead (`FOR SHARE`). If there is none, raise `no_open_shift`.
    - **Created time.** `v_created := case when sold_at > now() + interval '5 minutes' then now() else sold_at end` (call 4). Insert `created_at = v_created` and `sold_offline = true`.
    - **Queue number.** Unless a held bill is loaded, use `queue_number`. Then upsert `tenant_queue_counters`:
      - key `(tenant_id, (v_created at time zone 'Asia/Bangkok')::date)`
      - `last_number = greatest(c.last_number, queue_number)`, inserting `queue_number` when the row is new
    - **Order number.** `generate_order_number` as today.
    - **Override.** If `override` is set, after the insert add an `order_adjustments` row:
      - `kind='offline_override'`
      - `from_value = coalesce(server_total::text, '-')`
      - `to_value = charged_total::text`
      - `reason`
      - `actor_id = p_actor_id`
      - `approver_id = override.approver_id`
  - **`queue_counter_raise`.** It calls `shift_assert_actor`, then does the same `greatest` upsert for `p_business_date`.
  - **Grants.** Both functions: revoke from public, anon and authenticated; grant to service_role.

- [ ] **Step 2: Write `supabase/tests/order_record_test.sql`.** Follow the pattern of `supabase/tests/order_create_test.sql`: a QA tenant, an owner and a staff member inside the block, and a result object with one key per check. Each key must be `true`:
  - `online_same_as_create`: with `p_offline` null, two calls with the same ref give one bill. `created=false` on the second, and `sold_offline=false`.
  - `offline_keeps_queue`: offline bill with `queue_number 7` → the bill has `queue_number=7`, and the counter is ≥7.
  - `offline_counter_not_lowered`: counter at 9, then an offline bill with 4 → the counter stays 9 and the bill has 4.
  - `offline_midnight`: `sold_at` 23:58 Bangkok yesterday, `queue_number 40` → yesterday's counter is ≥40, and today's counter is untouched.
  - `offline_created_at`: `sold_at` 40 minutes ago → `created_at` equals it. `sold_at` 1 day in the future → `created_at` ≈ now() (within 1 minute).
  - `offline_shift_recorded`: a cash bill with the open shift's id → the bill's `shift_id` is that shift.
  - `offline_cash_shift_closed`: a cash bill with a closed shift's id → raises `offline_shift_closed`, and no row is written.
  - `offline_transfer_shift_closed`: the same for a transfer → saved with `shift_id` null.
  - `replay_offline`: the same ref sent twice offline → one bill, the same `order_number`, `created=false`.
  - `override_logs`: override with an approver → one `order_adjustments` row, `kind='offline_override'`, with the approver set.
  - `override_cash_current_shift`: override, cash, recorded shift closed and another open → the bill is in the open shift.
  - `raise_counter`: `queue_counter_raise` to 15 → counter 15. Raising to 3 afterwards → still 15.
  - `seller_inactive`: actor deactivated → raises `forbidden`.
  - `held_offline`: an offline bill paying a held bill → the held bill is `paid`, and the bill has the held bill's queue number.

- [ ] **Step 3: Apply the migration** with `apply_migration`, then run the test with `execute_sql`.
  - Expected: `RESULT {…}` with every key true.
  - Also re-run `supabase/tests/order_create_test.sql`. It must still pass, because `order_create` is untouched.

- [ ] **Step 4: Regenerate the types.**
  - Run `generate_typescript_types` and write the result to `src/types/database.ts`.
  - Run `npx tsc --noEmit`. It must pass.
  - Run `get_advisors` (security). It must show no new warnings for these functions.

- [ ] **Step 5: Commit.**

  ```bash
  git add supabase/migrations/20261105120000_order_record.sql supabase/tests/order_record_test.sql src/types/database.ts
  git commit -m "feat(db): order_record — offline bills keep queue number, sale time and shift; queue_counter_raise"
  ```

---

### Task 2: Server — `createOrder` offline/override, outcomes, heartbeat fields

**Files:**
- Create: `src/lib/offline/sync-outcome.ts`, `src/lib/offline/sync-outcome.test.ts`
- Modify:
  - `src/lib/order-pricing-core.ts`, `src/lib/order-pricing-core.test.ts`
  - `src/lib/order-pricing.ts`
  - `src/types/app.ts`
  - `src/app/actions/orders.ts`
  - `src/app/api/heartbeat/route.ts`
  - `src/lib/connectivity.ts`, `src/lib/connectivity.test.ts`

**Interfaces:**
- Consumes: Task 1 `order_record`, `queue_counter_raise`.
- Produces:
  - `src/types/app.ts`:
    - `export type SavedOrder = { orderId: string; orderNumber: string; queueNumber: number; cashReceived: number | null; changeAmount: number | null }`. Move it here from `orders.ts`, because the hooks need it.
    - `CreateOrderInput` gains:
      - `offline?: OfflineSale`
      - `override?: { approverPin: string; reason: string }`
    - `export type OfflineSale = { tenantId: string; sellerId: string; soldAt: string /* ISO */; queueNumber: number; shiftId: string | null }`
  - `createOrder` failure type:

    ```ts
    { error: string; outcome: "retry" | "review" | "refused"; reviewCode?: ReviewCode; mayHaveSaved?: true }
    ```

  - `sync-outcome.ts`:
    - `export type ReviewCode = "menu_changed" | "held_bill_stale" | "shift_closed" | "needs_approval" | "seller_inactive" | "product_missing" | "other"`
    - `export const REVIEW_MESSAGES: Record<ReviewCode, string>`
    - `export function classifyRecordError(raw: string, ctx: { offline: boolean }): { outcome: "retry" | "review" | "refused"; reviewCode?: ReviewCode }`
  - `order-pricing-core.ts`:
    - `export function priceLinesAsCharged(items: CartItemInput[], catalog: PricingCatalog): { lines: PricedLine[]; subtotal: number; serverSubtotal: number | null } | { error: "product_missing" }`
    - It uses the device's `totalPrice` and the catalog's names. `serverSubtotal` is null when any line can't be priced from the catalog.
  - `src/app/actions/orders.ts`: `export async function raiseQueueCounter(businessDate: string, queueNumber: number): Promise<{ ok: true } | { error: string }>`
  - Heartbeat JSON gains:
    - `shiftId?: string | null` (present when read)
    - `queue?: { date: string; last: number }`, where `date` is the Bangkok `YYYY-MM-DD` and `last` is 0 when there is no row
  - `parseHeartbeatBody` returns `{ version, promptpayId, shiftId: string | null | undefined, queue: { date: string; last: number } | undefined }`

- [ ] **Step 1: Write the failing tests.**
  - `sync-outcome.test.ts`:
    - `classifyRecordError("… offline_shift_closed …", {offline:true})` → `{outcome:"review", reviewCode:"shift_closed"}`
    - `"held_bill_stale"` → review `held_bill_stale` when offline, `refused` when online
    - `"forbidden"` when offline → review `seller_inactive`
    - `'violates foreign key constraint "order_items_product_id_fkey"'` → review `product_missing`
    - a network-looking string such as `"fetch failed"` → `retry`
    - `"no_open_shift"` when online → `refused`
    - every `REVIEW_MESSAGES` value equals the Global Constraints copy
  - `order-pricing-core.test.ts`:
    - `priceLinesAsCharged` with a product whose price changed → `subtotal` is the device total and `serverSubtotal` the catalog total
    - a product absent from the catalog → `{error:"product_missing"}`
    - an archived product → still prices: names from the catalog, `serverSubtotal` null
  - `connectivity.test.ts`: `parseHeartbeatBody({version:"v", shiftId:null, queue:{date:"2026-11-05", last:12}})` returns them. A body without the keys → `shiftId` undefined, `queue` undefined. `queue` with a non-number `last` → undefined.

- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL (missing exports).

- [ ] **Step 3: Implement.**
  - **`sync-outcome.ts`.** Messages exactly as in Global Constraints. `held_bill_stale` reuses the text from `order-create-errors.ts`; import it relatively.
  - **`priceLinesAsCharged`.** Same catalog lookups as `priceLines`, but it never rejects on a price mismatch.
  - **`createOrder` changes**, in this order:
    1. **Replay lookup first** (unchanged).
    2. **If `data.offline` is set:**
       - `offline.tenantId !== profile.tenant_id` → `{error:"บิลนี้เป็นของร้านอื่น", outcome:"retry"}` (call 7)
       - validate `sellerId` (UUID), `soldAt` (a parseable ISO date), `queueNumber` (an integer 1–9999) and `shiftId` (UUID or null); any invalid value → `review`/`other`
       - the actor for `order_record` = `sellerId`
    3. **If `data.override` is set:**
       - require `data.offline` (otherwise `refused`)
       - verify the PIN like the discount PIN loop, restricted to owner/manager with `deactivated_at is null`; a wrong PIN → `{error:"PIN ไม่ถูกต้อง", outcome:"refused"}`
       - require a reason of 1–500 characters
       - price with `priceLinesAsCharged`; `product_missing` → review `product_missing`
       - skip the discount-approval PIN check, because the override approver covers it
       - pass `override {approver_id, reason, server_total, charged_total}`
    4. **Otherwise** pricing, discount and cash work exactly as today. Their existing error returns gain:
       - `outcome: data.offline ? "review" : "refused"`
       - `reviewCode`: `menu_changed` for the pricing `STALE`, `needs_approval` for a missing or wrong approval PIN when offline
    5. **Call `order_record`**, with `p_offline` built from `data.offline` (null when absent).
    6. **Error mapping** goes through `classifyRecordError`. The existing `createFailureOutcome` recheck stays: `maybe` → `{…, outcome:"retry", mayHaveSaved:true}`.
    7. **"Signed out"** (`กรุณาเข้าสู่ระบบก่อน`) and `OLD_TAB_MESSAGE` → `outcome:"retry"`.
  - **`raiseQueueCounter`.** `getProfile`, then validate the date with `isValidDateString` from `src/lib/bangkok-time.ts` and the number (1–9999), then call `admin.rpc("queue_counter_raise", …)`.
  - **Heartbeat route.**
    - It adds `shiftId` from `getActiveShift(profile.tenant_id)`, omitted on a read error.
    - It adds `queue` from `tenant_queue_counters` for `bangkokToday()`, read with the admin client and filtered by tenant.
    - Both run in parallel with `Promise.all`.

- [ ] **Step 4: Run** `npm test`, `npx tsc --noEmit` and `npm run lint`. Expected: all pass, and the C1 tests are still green.

- [ ] **Step 5: Live check on a QA tenant** (dev server is fine here).
  - An online payment on `/pos` still works as in C1, and the bill has `sold_offline=false`.
  - The offline path is exercised end-to-end from the UI in Task 8. Here, run a throwaway `node` script in the scratchpad, using the service key from `.env.local`, that calls `order_record` with `p_offline`. That proves the SQL wiring and the types. Delete the script afterwards.

- [ ] **Step 6: Commit.**

  ```bash
  git commit -am "feat(orders): createOrder records offline bills and manager overrides; outcomes for the sender; heartbeat sends shift and queue"
  ```

---

### Task 3: Pure device rules — queue, outbox states, gates, backoff

**Files:**
- Create:
  - `src/lib/offline/device-queue.ts`, `src/lib/offline/device-queue.test.ts`
  - `src/lib/offline/outbox-rules.ts`, `src/lib/offline/outbox-rules.test.ts`
  - `src/lib/offline/feature-gates.ts`, `src/lib/offline/feature-gates.test.ts`

**Interfaces:**
- Produces:
  - `device-queue.ts`:
    - `export type QueueState = { date: string; last: number }`
    - `export function observeQueue(s: QueueState | null, date: string, n: number): QueueState`. On a different date it returns `{date, last:n}`, otherwise the max.
    - `export function nextDeviceQueue(s: QueueState | null, date: string): { number: number; state: QueueState }`. A new date starts at 1.

    The date comes from `bangkokToday(new Date(ms))` (import `../bangkok-time.ts`).
  - `outbox-rules.ts`:
    - ```ts
      export type OutboxState = "attempt" | "check-only" | "pending" | "review"
      export type OutboxEntry = {
        clientRef; tenantId; sellerId; state: OutboxState; createdAt: number;
        input: Omit<CreateOrderInput, "approverPin" | "override">;
        offline: OfflineSale | null;
        display: { total: number; itemCount: number; itemsText: string; paymentMethod: "cash"|"transfer";
                   queueNumber: number | null; cashReceived: number | null; changeAmount: number | null };
        tries: number; nextTryAt: number; lastError: string | null;
        reviewCode: ReviewCode | null; serverQueueNumber: number | null;
      }
      ```
    - `export function startupRecovery(entries: OutboxEntry[]): OutboxEntry[]`: every `attempt` becomes `check-only`, and nothing else changes.
    - `export function sendable(entries, now: number, tenantId: string): OutboxEntry[]`: the `pending` entries of that tenant with `nextTryAt <= now`, sorted by `createdAt` ascending.
    - `export function deviceNumberedMode(entries, tenantId: string, online: boolean): boolean`: `!online` or any `pending` entry for the tenant. `review` and `check-only` do not count (spec call 2, builder-check answer).
    - `export function backoffMs(tries: number): number`: 5000, 10000, 20000, 40000, then 60000 at most.
    - `export const MAX_GENERIC_TRIES = 20`
    - `export function afterFailure(e: OutboxEntry, res: {outcome, reviewCode?, error}, now): OutboxEntry`:
      - `retry` → `tries+1` and `nextTryAt = now + backoffMs`
      - `review` or `refused` → `state:"review"`
      - a `retry` with error `"บันทึกออเดอร์ไม่สำเร็จ"` once `tries >= MAX_GENERIC_TRIES` → review `other`
    - `export function counts(entries, tenantId): { pending: number; review: number; checkOnly: number }`
  - `feature-gates.ts`:
    - `export type Gate = { enabled: true } | { enabled: false; reason: string }`
    - `export function gate(feature: "pin_discount"|"hold"|"resume_held"|"member"|"shift"|"switch_user"|"navigate"|"save_to_device", s: { online: boolean; pendingCount: number; attemptHasPinDiscount?: boolean }): Gate`:
      - offline → reason `ใช้ไม่ได้ตอนเน็ตหลุด`
      - online with pending > 0 → `รอส่งบิลค้างให้ครบก่อน` (for every feature except `navigate` and `switch_user`, which are allowed online)
      - `save_to_device` is disabled when `attemptHasPinDiscount` (call 6b), with reason `ส่วนลดที่ใช้ PIN ต้องรอเน็ต`

- [ ] **Step 1: Write the failing tests.** The cases are:
  - **Queue:**
    - `observeQueue(null,"2026-11-05",12)` → `{date,last:12}`
    - `observeQueue({date:"2026-11-05",last:12},"2026-11-05",9)` → last 12
    - `nextDeviceQueue({date:"2026-11-04",last:40},"2026-11-05")` → number 1
    - `nextDeviceQueue({date:"2026-11-05",last:12},"2026-11-05")` → 13
  - **Outbox rules:**
    - `startupRecovery` turns `attempt`s into `check-only`, and leaves `pending` and `review` alone
    - `sendable` excludes another tenant's entries, `review`, `check-only` and future `nextTryAt`, and is oldest first
    - `deviceNumberedMode` is false online with only `review` entries
    - backoff sequence: 5000, 10000, 20000, 40000, 60000, 60000
    - `afterFailure` covers retry, review, refused and the generic cap
  - **Feature gates:** every feature offline; online with pending; online with none → enabled; `save_to_device` with a PIN discount.

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement the three modules.** Use relative `.ts` imports only. `OutboxEntry` imports types from `../../types/app.ts`, which is a type-only import and is allowed.

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Commit.**

  ```bash
  git commit -m "feat(offline): pure rules for device queue numbers, outbox states, feature gates"
  ```

---

### Task 4: IndexedDB wrapper and persistent storage

**Files:**
- Create: `src/lib/offline/idb.ts`

**Interfaces:**
- Produces:
  - `openKidkubDb()`: database `kidkub-pos`, version 1, with two object stores:
    - `outbox`, keyPath `clientRef`
    - `kv`, out-of-line keys
  - Outbox functions:
    - `outboxPut(e: OutboxEntry): Promise<void>`
    - `outboxDelete(clientRef: string): Promise<void>`
    - `outboxAll(): Promise<OutboxEntry[]>`
  - Key-value functions:
    - `kvGet<T>(key: string): Promise<T | undefined>`
    - `kvSet(key: string, value: unknown): Promise<void>`
    - `kvDelete(key: string): Promise<void>`
  - `requestPersistentStorage(): Promise<boolean>`: calls `navigator.storage?.persist?.()` once and stores the answer at kv `persist-asked` (call 13)
  - `onOutboxChange(cb: () => void): () => void`: a `BroadcastChannel("kidkub-outbox")`. Every write posts on it, so all tabs and hooks refresh.

- [ ] **Step 1: Implement** with the raw `indexedDB` API, as promises. Every write is its own `readwrite` transaction, and resolves on `oncomplete`, not on `onsuccess`, so the data is on disk before we report it saved.
  - On `QuotaExceededError` or a missing `indexedDB` (private mode), reject with `Error("storage_unavailable")`. Callers show `บันทึกในเครื่องไม่ได้` and fall back to C1 behaviour (online retry only).

- [ ] **Step 2: Live check** in the Browser pane on the dev server.
  - Temporarily assign the functions to `window.__kidkubIdb` inside `if (process.env.NODE_ENV === "development")` in the module, and call them with `javascript_tool`.
  - Put an entry, reload, run `outboxAll()` → the entry is still there. `kvSet`/`kvGet` round-trips. A second tab receives `onOutboxChange`.
  - Remove the assignment before committing. Task 12's grep checks for it.

- [ ] **Step 3: Commit.**

  ```bash
  git commit -m "feat(offline): IndexedDB outbox and key-value store with cross-tab change events"
  ```

---

### Task 5: Service worker — POS opens offline, offline fallback page

**Files:**
- Modify: `src/app/sw.ts`, `src/proxy.ts` (matcher)
- Create: `public/offline.html`

**Interfaces:**
- Produces:
  - cache `pos-shell`, holding the `/pos` document
  - `/offline.html`, precached

- [ ] **Step 1: Add a runtime rule before `...defaultCache`, after the heartbeat rule.**
  - Matcher: `sameOrigin && request.mode === "navigate" && url.pathname === "/pos"`.
  - Handler: `new NetworkFirst({ cacheName: "pos-shell", networkTimeoutSeconds: 4, plugins: [{ cacheWillUpdate: async ({ response }) => (response.status === 200 && !response.redirected ? response : null) }] })`.
  - No `ExpirationPlugin` (call 11).

- [ ] **Step 2: Add the fallback for other pages.**
  - Add `fallbacks: { entries: [{ url: "/offline.html", matcher: ({ request }) => request.destination === "document" }] }` to the `Serwist` options. Check the option name in `node_modules/serwist/dist/index.d.mts`.
  - Make sure `/offline.html` is precached: add `additionalPrecacheEntries` or confirm `globPublicPatterns` covers it.
  - `public/offline.html` is a self-contained Thai page with inline styles:
    - the heading `ไม่มีอินเทอร์เน็ต`
    - the line `หน้านี้เปิดไม่ได้ตอนเน็ตหลุด · หน้า POS ยังขายต่อได้`
    - a large link button `เปิดหน้า POS` → `/pos`
  - In `src/proxy.ts`, add `offline\\.html` to the matcher's exclusions. Otherwise the precache fetch of a signed-out device would store the `/login` redirect.

- [ ] **Step 3: Verify on a production build.**
  1. Stop the dev server, `npm run build`, then `preview_start kidkubpos-prod-local`.
  2. Sign in a QA owner and open `/pos` once.
  3. `preview_stop`.
  4. Reload `/pos`. The POS renders with its menu. The tab shows no browser error page.
  5. Navigate to `/orders` by URL → the offline page shows, and its button opens `/pos`.
  6. **Stale-build check.**
     - With the server running, open `/pos`.
     - Change one visible string temporarily, then `npm run build` again and restart.
     - Load any page so the new SW installs and activates. Leave `/pos` open without reloading it.
     - Stop the server and reload `/pos`. It must still render (old or new build, but working, with no chunk 404s in the console).
     - If it fails, fix it, for example by re-fetching `/pos` into `pos-shell` in the SW `activate` event. Then revert the temporary string.
  7. **Redirect check.** Sign out, then visit `/pos` online: it redirects to `/login`. In `caches.open("pos-shell")` the `/pos` entry must still be the signed-in page, or absent, and never the login page.

- [ ] **Step 4: Commit.**

  ```bash
  git commit -m "feat(pwa): /pos opens offline from its own cache; offline page for other pages"
  ```

---

### Task 6: Device snapshot — latest shift, queue and PromptPay

**Files:**
- Modify:
  - `src/components/pos/use-heartbeat.ts`
  - `src/app/(shell)/pos/page.tsx`
  - `src/components/pos/pos-screen.tsx` (props only, here)
- Create: `src/components/pos/use-device-snapshot.ts`

**Interfaces:**
- Consumes: the Task 2 heartbeat fields, Task 3 `observeQueue`, Task 4 `kvGet`/`kvSet`.
- Produces:
  - `PosScreen` props gain `tenantId: string`, `sellerId: string` (`profile.id`), `renderedAt: number` (server `Date.now()`), `todayQueueLast: number` and `todayQueueDate: string`.
  - `useHeartbeat()` also returns `shiftId: string | null | undefined`, `queue: QueueState | undefined` and `lastSuccessAt: number | null`. `lastSuccessAt` is set on every successful answer, and Task 7 uses it to wake the sender.
  - `useDeviceSnapshot({ tenantId, page: { at: number; shiftId: string | null; promptpayId: string | null; queue: QueueState }, heartbeat })` returns `{ shiftId: string | null; promptpayId: string | null; queue: QueueState | null; observe(n: number): void; takeNext(): Promise<number> }`.
    - It stores kv `snapshot:<tenantId>` = `{ at, shiftId, promptpayId, queue }`.
    - On load it uses whichever of page or stored has the larger `at`. Every heartbeat answer overwrites it with `at = Date.now()`.
    - `observe(n)` raises the queue.
    - `takeNext()` allocates the next device queue number and persists it **before** resolving.
    - A takeNext that fails to persist rejects, and the sale must not proceed.

- [ ] **Step 1: Implement.**
  - The page reads today's counter with the admin client: `tenant_queue_counters` for `bangkokToday()`, defaulting to 0. It passes it alongside `renderedAt`.
  - Replace the C1 `currentPromptpayId` logic with `snapshot.promptpayId`. Behaviour is the same online.
  - Every successful online sale, and every held bill created, calls `observe(queueNumber)`.

- [ ] **Step 2: Live check** (dev server, QA tenant).
  - After a sale with queue 3, kv `snapshot:<tenant>` holds `queue.last ≥ 3`.
  - Opening a shift elsewhere, then the next heartbeat, updates `shiftId`.

- [ ] **Step 3: Commit.**

  ```bash
  git commit -am "feat(pos): device snapshot keeps the latest shift, queue and PromptPay for offline use"
  ```

---

### Task 7: Outbox hook and sender

**Files:**
- Create: `src/components/pos/use-outbox.ts`

**Interfaces:**
- Consumes:
  - Task 2: `createOrder` outcomes, `raiseQueueCounter`, `checkOrderSaved`
  - Task 3: `startupRecovery`, `sendable`, `afterFailure`, `counts`, `deviceNumberedMode`
  - Task 4: the idb functions
- Produces: `useOutbox({ tenantId, online: boolean, paused: boolean, onSynced(e: OutboxEntry, saved: SavedOrder): void, onChecked(clientRef: string, saved: SavedOrder | null): void })` returns:

  ```ts
  { entries: OutboxEntry[]; counts: { pending; review; checkOnly }; deviceNumbered: boolean;
    progress: { sent: number; total: number } | null;   // null when not sending
    justFinished: number | null;                          // count for the green bar, null after 5 s
    put(e: OutboxEntry): Promise<void>; remove(clientRef: string): Promise<void>;
    markCheckOnly(clientRef: string): Promise<void>; finalize(clientRef: string, offline: OfflineSale): Promise<void> }
  ```

- [ ] **Step 1: Implement the hook.**
  - **On mount:** load `outboxAll()`, apply `startupRecovery`, and write any changes back. Subscribe to `onOutboxChange`.
  - **Sender loop.**
    - It runs only while `online && !paused`, inside `navigator.locks.request("kidkub-outbox-sender", { ifAvailable: true }, …)`. If the lock isn't available, another tab is sending, so this tab only listens.
    - It takes the next `sendable` entry and calls `createOrder({...e.input, clientRef: e.clientRef, offline: e.offline})` with C1's `withDeadline(…, PAYMENT_DEADLINE_MS)`.
    - **Success:** `outboxDelete`, then `onSynced`. If `saved.queueNumber !== e.offline.queueNumber`, keep that for the summary (call 15).
    - **Failure:** apply `afterFailure`. If the entry goes to `review`, also call `raiseQueueCounter(bangkokToday(new Date(e.createdAt)), e.offline.queueNumber)`; a failure there is retried on the next loop.
    - A throw or timeout counts as `{outcome:"retry"}`.
  - **`check-only` entries** are resolved with `checkOrderSaved`:
    - saved → delete, then `onChecked(ref, saved)`
    - not saved → delete, then `onChecked(ref, null)`
    - no answer → keep
  - **Progress** counts the bills sent in this burst against the pending total at the start of the burst. `justFinished` is set when a burst empties `pending`, and cleared after 5 s.
  - **Retry timing.** Re-run the loop on every `online` change to true, every heartbeat success (have `useHeartbeat` expose `lastSuccessAt`), and a 5 s interval while pending.
  - The deadline must not leave the loop stuck: one bill at a time.

- [ ] **Step 2: Live check on a production build** (QA tenant).
  1. **Crash mid-payment.** Put an `attempt` entry by hand, then reload → it becomes `check-only` and resolves to deleted, because it was not saved.
  2. **Two tabs.** Open two `/pos` tabs with 3 pending entries made by Task 8's flow (or put by hand with valid inputs) and go online. The server has exactly 3 new bills, and `navigator.locks.query()` shows one holder.
  3. **Refusal.** A pending bill with a price edited via the menu page meanwhile → `review`, and `tenant_queue_counters.last_number ≥` its queue number.

- [ ] **Step 3: Commit.**

  ```bash
  git commit -m "feat(pos): outbox sender — one tab sends pending bills oldest first, refusals kept for review"
  ```

---

### Task 8: POS integration — offline sales, banners, disabled features, บันทึกไว้ในเครื่อง

**Files:**
- Modify:
  - `src/components/pos/pos-screen.tsx`
  - `src/components/pos/status-banners.tsx`
  - `src/components/pos/smart-cart.tsx`
  - `src/components/pos/pos-header.tsx`
  - `src/components/pos/cash-payment-modal.tsx`, `src/components/pos/qr-payment-modal.tsx`
  - `src/components/pos/no-shift-dialog.tsx`, `src/components/pos/held-bills-panel.tsx`
- Create: `src/components/pos/offline-sale-result.tsx`

**Interfaces:**
- Consumes: Tasks 3, 6 and 7.
- Produces:
  - `StatusBanners` props become `{ offline: boolean; pendingCount: number; progress: {sent;total} | null; justFinished: number | null; reviewCount: number; onOpenReview(): void; updateAvailable: boolean; onRefresh(): void }`.
  - Bar priority:
    1. red (offline)
    2. yellow (progress)
    3. green (justFinished)
    4. update

    The review bar shows under any of them while `reviewCount > 0`.

- [ ] **Step 1: The sale path.**
  - **The C1 online flow** is kept. Before calling `createOrder`, `put` an `attempt` entry: input without `approverPin`, `offline: null`.
    - On success → `remove`.
    - On a definite refusal → `remove`.
    - On no answer → keep it as `attempt`.
    - When the window closes and C1's `resolveUncertain` gives `"unknown"` → `markCheckOnly`. C1's `unresolvedRef` now comes from the `check-only` entries for this tenant.
  - **When `deviceNumbered` is true** at confirm:
    - Don't call the server. `takeNext()` the queue number, and build `offline = {tenantId, sellerId, soldAt: new Date().toISOString(), queueNumber, shiftId: snapshot.shiftId}`.
    - `put` a `pending` entry. Only after it has resolved, clear the cart and show `OfflineSaleResult` with the queue number and, for cash, the received amount and change.
    - If `takeNext` or `put` rejects, keep the cart and show `บันทึกในเครื่องไม่ได้` in the window.
  - **บันทึกไว้ในเครื่อง** shows in both payment windows only when `uncertain`, and when `gate("save_to_device", …)` is enabled.
    - It calls `finalize(clientRef, offline)` with a fresh `takeNext()` number. That turns the existing `attempt` into a `pending` entry with the same `clientRef`.
    - Then it shows `OfflineSaleResult`.
  - **Cash in device-numbered mode** needs `snapshot.shiftId !== null`. Otherwise `NoShiftDialog` shows, with its open-shift button disabled and the reason `ใช้ไม่ได้ตอนเน็ตหลุด`. Pay by transfer stays enabled.
  - **The sender pauses** while a payment window is open (`paused = showCashModal || showQrModal`).
  - **On mount**, the POS calls `requestPersistentStorage()` (Task 4, call 13).
  - `onSynced` shows nothing per bill; the bars carry it.

- [ ] **Step 2: Disabled features** via `gate(…)`, each showing its reason in the mockup's grey style:
  - the discount button, for discounts needing a PIN: still openable, but applying one that needs approval shows the reason
  - the hold button
  - `held-bills-panel` resume buttons (a held bill already loaded can still be paid)
  - the member button
  - the header shift link
  - the payment `NoShiftDialog` shift button

- [ ] **Step 3: Banners.** Use the exact copy from Global Constraints and keep C1's no-crying-wolf rule (2 failures).

- [ ] **Step 4: Live check on a production build** (QA tenant, 1180×740), screenshotting each mockup state.
  1. Open a shift online. `preview_stop`. Wait for the red bar (≤ about 70 s, or trigger `checkNow` through two heartbeat failures).
  2. Sell a cash bill and a transfer bill offline: result `คิว N`, and the red bar shows `ค้างส่ง 2 บิล`.
  3. Reload while offline → the page opens, and the count is still 2.
  4. Start the server again → yellow `1 / 2`, `2 / 2`, then green `✓ ส่งบิลครบแล้ว 2 บิล`, gone after 5 s.
  5. In the DB, check both bills:
     - `sold_offline=true`
     - `created_at` = sale time (not send time)
     - queue numbers as shown
     - cash bill `shift_id` = the open shift
     - `created_by` = the seller
  6. **บันทึกไว้ในเครื่อง.**
     - Add a temporary `await new Promise(r => setTimeout(r, Number(process.env.C2_TEST_DELAY_MS ?? 0)))` at the top of `createOrder`, then build and start with `C2_TEST_DELAY_MS=20000`.
     - Pay → after 15 s the button shows. Tap it → the result shows. After the sender runs, exactly one bill exists for that `client_ref`.
     - Remove the delay before committing. Task 12's grep checks for it.
  7. The disabled features show their reasons offline, and `รอส่งบิลค้างให้ครบก่อน` shows online while pending.

- [ ] **Step 5: Commit.**

  ```bash
  git commit -am "feat(pos): sell offline into the outbox; red/yellow/green bars; disabled features show why; save-to-device after no answer"
  ```

---

### Task 9: Review list and "record as charged"

**Files:**
- Create: `src/components/pos/review-panel.tsx`
- Modify: `src/components/pos/pos-screen.tsx`

**Interfaces:**
- Consumes:
  - Task 2: `createOrder` with `override`, `REVIEW_MESSAGES`
  - Task 7: `entries`, `remove`
  - the existing manager-PIN pad component used by the discount approval (reuse it; find it in `smart-cart.tsx`)
- Produces: `ReviewPanel({ entries: OutboxEntry[]; onRecorded(clientRef: string, saved: SavedOrder): void; onClose(): void })`

- [ ] **Step 1: Implement.**
  - One card per `review` entry, showing:
    - time (`formatDateTime` from `src/lib/bangkok-time.ts`)
    - `คิว N`
    - `display.itemsText`
    - total and method
    - the reason, from `REVIEW_MESSAGES[reviewCode]`, or `lastError` for `other`
  - The button `บันทึกตามยอดที่เก็บจริง` (online only, otherwise disabled with `ใช้ไม่ได้ตอนเน็ตหลุด`). Tapping it:
    1. opens the PIN pad
    2. calls `createOrder({...input, clientRef, offline, override: {approverPin, reason: REVIEW_MESSAGES[reviewCode]}})`
    3. on success, `remove`s the entry and shows `บันทึกแล้ว (KK.xxx)`
  - `product_missing` cards have no button. They show the reason only (call 9).
  - Cash and shift closed with no shift open now → the server's `no_open_shift` message, and the card stays.
  - There is no discard control anywhere (call 10).
  - The panel opens from the review bar.

- [ ] **Step 2: Live check** (QA tenant, production build).
  - A review entry from a price change → wrong PIN gives `PIN ไม่ถูกต้อง`, and the card stays.
  - The right PIN → a bill at the charged total, plus one `order_adjustments` row of kind `offline_override` with the approver.

- [ ] **Step 3: Commit.**

  ```bash
  git commit -am "feat(pos): review list for refused offline bills; manager records them as charged"
  ```

---

### Task 10: Cart draft survives reloads

**Files:**
- Create: `src/lib/offline/cart-draft.ts`, `src/lib/offline/cart-draft.test.ts`, `src/components/pos/use-cart-draft.ts`
- Modify: `src/components/pos/pos-screen.tsx`

**Interfaces:**
- Produces:
  - `cart-draft.ts`:
    - `export type CartDraft = { v: 1; tenantId; sellerId; savedAt: number; items: CartItem[]; orderType; paymentMethod; customer: {id; phone} | null; activeHeld: {id; version; queueNumber; customerLabel} | null; discount: { type; value: string; reason: string } | null }`
    - `export function toDraft(state, ids): CartDraft | null`: null when the cart is empty and no held bill is loaded. It never includes the PIN.
    - `export function restorable(d: unknown, ids: {tenantId; sellerId}): CartDraft | null`: null on a wrong version, tenant or seller, or a malformed shape.
  - kv key: `cart:<tenantId>:<sellerId>`

- [ ] **Step 1: Write the failing tests.**
  - The round trip keeps items, order type, method, customer, held bill and discount.
  - The output never has `approverPin`, even if it is passed in.
  - Another seller or tenant → null.
  - Garbage → null.
  - An empty cart → `toDraft` gives null.

- [ ] **Step 2: Run** `npm test`. Expected: FAIL. **Implement** the module. **Run** again. Expected: PASS.

- [ ] **Step 3: Wire it up** with `useCartDraft`.
  - Save, debounced 300 ms, on every cart change.
  - Delete on `applySuccess`, `clearCart`, a park, and an offline sale.
  - Restore once on mount when the draft is restorable and the cart is empty, and show `กู้ตะกร้าที่ค้างไว้` in the cart notice slot.
  - A restored discount that needs approval falls back to C1's re-approval flow.

- [ ] **Step 3b: Live check.** Add 3 items and a note, reload → the cart is back with the notice. Pay → reload → the cart is empty.

- [ ] **Step 4: Commit.**

  ```bash
  git commit -m "feat(pos): the cart in progress comes back after a reload"
  ```

---

### Task 11: Shell and history — offline nav, shift-close block, logout warning, label

**Files:**
- Create: `src/lib/offline/status-store.ts`
- Modify:
  - `src/components/shell/sidebar-shell.tsx`, `src/components/shell/bottom-nav.tsx`
  - `src/components/shell/logout-button.tsx`, `src/components/shell/switch-worker-button.tsx`
  - `src/components/shifts/close-shift-flow.tsx`
  - `src/components/orders/history-row.tsx`, `src/app/(shell)/orders/[id]/page.tsx`
  - the query in `src/lib/dal.ts` that feeds the history, which must select `sold_offline`

**Interfaces:**
- Consumes: Task 4 `outboxAll` / `onOutboxChange`, Task 3 `counts`.
- Produces:
  - `status-store.ts`: `setPosOnline(online: boolean)` and `usePosOnline(): boolean` (`useSyncExternalStore`, default `true`). The POS calls `setPosOnline` from the heartbeat.
  - `usePendingCount(tenantId?)` (in the same file or a hook file): returns `{pending, review}` from the outbox, live across tabs.

- [ ] **Step 1: Offline navigation.** While `usePosOnline()` is false, sidebar and bottom-nav links other than `/pos`, plus switch-user, render disabled with the tooltip or label `ใช้ไม่ได้ตอนเน็ตหลุด`.

- [ ] **Step 2: Close-shift block.** `close-shift-flow.tsx`'s `ปิดกะ` button is disabled while `pending + review > 0` on this device, with the copy `ยังมีบิลค้างส่ง N บิล · รอส่งให้ครบก่อนปิดกะ`.
  - Review bills count too: their cash belongs to the drawer being closed (goal 9).

- [ ] **Step 3: Logout warning.** When pending > 0, the logout button first shows a confirm dialog with the logout-warning copy and the buttons `ออกจากระบบ` / `ยกเลิก`. Nothing is deleted.

- [ ] **Step 4: History label.**
  - `ขายตอนเน็ตหลุด` as a small badge in the history row and the bill detail when `sold_offline`.
  - The bill detail's adjustment list renders `offline_override` as `บันทึกตามยอดที่เก็บจริง: ฿from → ฿to`, with the reason and the approver. Follow how `payment_method_change` is rendered.

- [ ] **Step 5: Live check.**
  - Offline → the nav is disabled with the reason.
  - 1 pending bill → close-shift is disabled with the copy, and logout warns.
  - After the sync, close works, and an offline bill shows the label in `/orders`.

- [ ] **Step 6: Commit.**

  ```bash
  git commit -am "feat(shell): offline nav guard, no shift close with unsent bills, logout warning, offline label in history"
  ```

---

### Task 12: Phase two, full verification and clean-up

**Files:**
- Create: `supabase/migrations/20261105130000_drop_order_create.sql` (written now, applied only after the deploy)
- Modify: `src/types/database.ts` (regenerated after phase two)

- [ ] **Step 1: Write the phase-two migration.** `drop function public.order_create(uuid, uuid, uuid, jsonb, jsonb, uuid, int, jsonb);`, with a header comment saying "apply only after the C2 deploy is live". **Do not apply yet.**

- [ ] **Step 2: Full run on a production build** (QA tenant), in mockup order. Keep a screenshot of each state:
  1. online sale (C1 unchanged)
  2. offline + red bar
  3. offline cash and transfer sales
  4. reload while offline
  5. back online: yellow → green
  6. DB fields checked
  7. a price changed during the outage → review → record as charged
  8. close-shift blocked → unblocked
  9. midnight logic (unit + DB tests cover it; no live wait)
  10. a cart draft restored

- [ ] **Step 3: Run the suites.**
  - `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`: all pass.
  - DB suites: `order_record_test`, `order_create_test`, `order_adjustments_test`: all pass.
  - `get_advisors`: nothing new.

- [ ] **Step 4: Clean-up.** Delete the QA tenants and users with the purge loop in memory §8. Afterwards `0` QA tenants remain. Remove any temporary test hooks (Task 4, Task 8): `git grep -n "__kidkub\|C2_TEST"` must return nothing.

- [ ] **Step 5: Commit.** Then **stop**. The push waits for the user.

  ```bash
  git commit -am "chore(c2): phase-two migration to drop order_create (apply after deploy)"
  ```

- [ ] **Step 6: After the user says push.**
  1. Push, and confirm the Vercel deploy is READY.
  2. Apply `20261105130000_drop_order_create.sql`.
  3. Regenerate the types, commit and push.
  4. Ask the user to refresh the iPad POS tab once, and test on the iPad: Wi-Fi off → sell 2 bills → reload → Wi-Fi on → bills sent.
