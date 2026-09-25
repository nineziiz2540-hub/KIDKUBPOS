# Held Bills, Queue Numbers & Per-Item Notes — Design

Date: 2026-09-25 · Status: approved direction, awaiting spec review

## Context

The shop runs one iPad (always landscape) at the counter. Most customers **order first, sit and
wait, then pay** — so the cashier needs to take the next order while earlier ones are unpaid.
Some orders also arrive in advance via chat. The shop has **no table numbers**; staff identify
orders by a queue number, optionally with the customer's name. Customers often ask for small
per-cup requests that the modifier system doesn't cover.

Decisions made with the owner (2026-09-25):

| Question | Decision |
|---|---|
| Where held bills live | Database, with an audit trail of who did what (not device storage — an unpaid bill must not vanish, and deleting one must leave a trace) |
| How staff find a held bill | Auto queue number, optional free-text customer name |
| Queue number scope | **Every** order (pay-now and held), resets daily |
| Reducing/removing items in a held bill | Allowed without PIN, but every reduction is logged server-side |
| Cancelling a whole held bill | Reason + Manager/Owner PIN (same as voiding a paid bill) |
| Unpaid held bills at shift close | Clear warning with the list and total; closing is still allowed |
| Quick notes | ไม่ใส่หลอด, แยกน้ำแข็ง, น้ำแข็งน้อย, ใส่แก้วลูกค้า (+ free text) |
| Storage approach | **A: separate `held_bills` table.** Rejected B (an "unpaid" status on `orders`) because 13 revenue queries in `dal.ts` would each need to exclude it; one miss silently corrupts sales figures |

Delivered in three independently shippable phases, in this order.

---

## Phase 1 — Per-item notes

### Data
- `order_items.note text null`, CHECK `char_length(note) <= 200`.
- `CartItem` gains `note: string | null`.

### Cart-line identity
Today a direct tap merges into the line keyed `product.id`; modifier items always get a fresh
key. New rule: a direct tap merges only into the line with key `product.id` (no modifiers,
**no note**). When a note is added to that line, its key is re-issued as
`${product.id}-${Date.now()}` so later taps start a fresh, note-less line. Result: cups with
different notes are always separate lines.

### UI
- `NoteEditor` block (shared): 4 quick-note chips (toggleable, multiple allowed, joined with
  ", ") + a free-text input, 200-char limit.
- Shown at the bottom of the modifier modal (for products with modifiers).
- In the cart, tapping an item's name area opens a small **Note modal** using the same editor —
  this is how notes get onto direct-add items and how any note is edited/cleared.
- Cart line shows the note under the modifiers in accent-colored 14px text with a 📝 icon.
- Order detail page shows each item's note under its name.

### Server
`createOrder` trims the note, stores `null` when empty, rejects > 200 chars.

---

## Phase 2 — Queue number on every order

### Data
- `tenant_queue_counters (tenant_id uuid, business_date date, last_number int, PK (tenant_id, business_date))`.
- `next_queue_number(p_tenant_id uuid) returns int` — `SECURITY DEFINER`, same caller-tenant guard
  as `generate_order_number`, business date = `(now() at time zone 'Asia/Bangkok')::date`,
  atomic `insert … on conflict do update set last_number = last_number + 1 returning`.
  EXECUTE revoked from anon.
- `orders.queue_number int null` (null for historical orders).

### Behaviour
- `createOrder` (pay-now) calls `next_queue_number` **after** all validation (like the order
  number, a rejected attempt must not burn a queue number).
- Held bills get their queue number when first held (Phase 3); paying one reuses it.
- After a successful checkout the cart's success panel shows **"คิว 12"** at 48px above the
  change amount — the number the cashier calls out.
- Orders list and order detail show the queue number next to the order number.
- The **table-number field is removed** from the cart (shop has no tables). The
  `orders.table_number` column stays for history; new orders write null.

---

## Phase 3 — Held bills

### Data

`held_bills`
| column | notes |
|---|---|
| `id uuid pk`, `tenant_id` | |
| `queue_number int`, `business_date date` | assigned at first hold via `next_queue_number` |
| `customer_label text null` | optional name, ≤ 40 chars |
| `customer_id uuid null` | linked member |
| `items jsonb` | `CartItem[]` snapshot (incl. notes) |
| `discount_type`, `discount_value`, `discount_reason` | **no PIN / approver stored** — an over-threshold discount must be re-approved when the bill is paid |
| `status text` | `open` / `paid` / `cancelled` |
| `version int` | optimistic concurrency, +1 on every save |
| `created_by`, `created_at`, `updated_by`, `updated_at` | |
| `cancelled_by`, `cancelled_approved_by`, `cancel_reason`, `cancelled_at` | |

`held_bill_events` — append-only audit log
`(id, held_bill_id, tenant_id, actor_id, event_type, detail jsonb, created_at)`, `event_type` in
`held`, `updated`, `items_reduced`, `paid`, `cancelled`. `items_reduced.detail` lists each line
whose quantity dropped or that disappeared: `{name, modifiers, note, from_qty, to_qty}`.

`orders.held_bill_id uuid null` with a **UNIQUE** constraint → the database itself guarantees one
paid order per held bill.

### Security (same model as void/refund)
- RLS: tenant members may **SELECT** `held_bills` and `held_bill_events`. No INSERT/UPDATE/DELETE
  policies for `authenticated` — every write goes through server actions using the admin client,
  after `getProfile()` scopes it to the caller's tenant.
- Reductions are computed **server-side** by diffing the stored snapshot against the incoming
  items — never trusted from the client.
- Cancelling requires reason + a Manager/Owner PIN, verified with bcrypt exactly like
  `voidOrder`.

### Server actions (`src/app/actions/held-bills.ts`)
- `holdBill({items, customerId, customerLabel, discount…})` → new row, queue number, `held` event.
- `updateHeldBill({id, version, items, …})` → rejects if not `open` or version mismatch
  ("บิลนี้ถูกแก้ไขจากที่อื่น กรุณาเปิดใหม่"); logs `items_reduced` when anything dropped, then
  `updated`.
- `cancelHeldBill({id, reason, pin})` → PIN check, `open → cancelled` (conditional update),
  `cancelled` event.
- `createOrder` gains optional `heldBillId` + `heldBillVersion`:
  1. load the held bill (tenant-scoped, must be `open`, version must match);
  2. diff the stored items against the cart being paid and log `items_reduced` if needed
     (so "remove a cup, then pay immediately" is still audited);
  3. insert the order with `held_bill_id` + the held bill's `queue_number` — a concurrent second
     payment fails on the UNIQUE constraint and gets "บิลนี้ชำระไปแล้ว";
  4. mark the held bill `paid` + `paid` event. If step 4 fails the order still exists; the
     open-bills query excludes any held bill that has an order, so it can't be charged twice.

### UI
- **Cart footer:** `[พักบิล]` (secondary, 56px) beside `[ชำระ ฿…]`.
  - Empty cart → disabled.
  - New cart → small modal: optional customer name + "พักบิล" → success toast
    "พักบิลแล้ว · คิว 12", cart clears.
  - Cart holding a resumed bill → the button reads **"บันทึกบิลพัก"** and saves changes.
- **Resumed-bill banner** at the top of the cart: "คิว 12 · พี่ส้ม — บิลพัก" with a `ปิด` action
  (returns the bill to the list unchanged; replaces "ล้างทั้งหมด" while a held bill is loaded).
- **POS header:** `บิลพัก (3)` button with a count badge → **Held Bills panel** (modal):
  - cards sorted oldest first: queue number (large), name, item count, total, "พักไว้ 25 นาที";
  - tap a card → loads into the cart. If the cart already has unsaved items, ask
    "พักบิลปัจจุบันก่อน?" [พักบิล] [ทิ้งรายการในตะกร้า] [ยกเลิก];
  - each card has `ยกเลิกบิล` → reason + PIN step;
  - a collapsed "ยกเลิกวันนี้ (n)" section lists today's cancelled held bills with who approved
    and why (visible to everyone; reinforces that cancellations are seen).
- **Order detail:** if the order came from a held bill, a "ประวัติบิลพัก" section lists its
  events (held by, reductions with item/qty, paid by).
- **Shift close:** the shift panel shows "บิลค้างจ่าย n บิล · ฿x" when any are open; pressing
  close shows a confirm dialog listing them; closing is still allowed.
- Stock is still deducted only at payment. A held bill cancelled after the drink was made does
  not deduct stock (accepted; noted as a known limitation).

### Data freshness
Single device: the POS page loads open held bills server-side; every held-bill action calls
`revalidatePath('/pos')` and the client `router.refresh()`es. No realtime subscription needed.

---

## Testing (per phase, live on a disposable QA tenant only)
- Phase 1: note on modifier item and direct item; same product with/without note → two lines;
  note persisted to `order_items`; 201-char note rejected server-side.
- Phase 2: queue numbers 1,2,3 in order; rejected checkout doesn't burn a number; counter resets
  on a new Bangkok date (simulate by seeding yesterday's counter row).
- Phase 3: hold → list → resume → add → save → pay (queue number carried, event log correct);
  reduce then pay → `items_reduced` logged; concurrent double-pay → exactly one order;
  version conflict rejected; cancel with wrong/right PIN; direct Data-API INSERT/UPDATE on
  `held_bills` by an authenticated user is blocked; shift-close warning lists open bills;
  over-threshold discount on a held bill must be re-approved at payment.

## Out of scope
Kitchen display / printing, realtime multi-device sync, owner-editable quick-note list, moving a
held bill between shifts' cash (it isn't cash until paid), server-side re-pricing of cart items
(pre-existing: `createOrder` trusts client line prices — tracked separately).
