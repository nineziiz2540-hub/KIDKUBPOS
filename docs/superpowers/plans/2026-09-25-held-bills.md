# Held Bills (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the cashier park an unpaid order under its queue number (optionally a customer name), take other orders, reopen it later to add/edit/pay, with a server-side audit trail, PIN-protected cancellation, and a shift-close warning.

**Architecture:** New `held_bills` + append-only `held_bill_events` tables, readable by tenant members, writable only by server actions via the admin client. `orders.held_bill_id` (UNIQUE, server-only via trigger) guarantees one payment per held bill. Item reductions are computed server-side by a pure diff helper. The POS keeps an `activeHeld` pointer while a held bill is loaded in the cart.

**Tech Stack:** Next.js 16 server actions + client components, Supabase Postgres/RLS, bcryptjs (PIN), Tailwind v4.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-25-held-bills-queue-notes-design.md` (Phase 3). Additions agreed while planning: held bills also store `order_type`; a BEFORE INSERT/UPDATE trigger lets only service_role set `orders.held_bill_id`.
- No INSERT/UPDATE/DELETE RLS policies on `held_bills` / `held_bill_events` for `authenticated`; all writes through server actions with `createAdminClient()` after `getProfile()` tenant scoping.
- Items are validated with `priceCartItems` on every hold/update/pay (client prices never trusted).
- Reductions (`items_reduced`) are diffed server-side, including on pay.
- Cancel = reason + Manager/Owner PIN (bcrypt, same as `voidOrder`).
- Optimistic concurrency: `version` must match on update/pay; mismatch → "บิลนี้ถูกแก้ไขแล้ว กรุณาเปิดใหม่".
- Discount PIN/approver is never stored on a held bill; over-threshold discounts re-approve at payment.
- `customer_label` ≤ 40 chars; quick cancel reasons: "ลูกค้ายกเลิก", "พักบิลซ้ำ", "สั่งผิด".
- Touch sizing: controls ≥ 40px (primary 48–56px), text ≥ 16px.
- QA tenant only; no push without the user's request.

---

### Task 1: Schema

**Files:** Create `supabase/migrations/20260925210000_held_bills.sql`; modify `src/types/database.ts`.

- [ ] Migration:

```sql
create table public.held_bills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  queue_number int not null,
  business_date date not null,
  customer_label text check (customer_label is null or char_length(customer_label) <= 40),
  customer_id uuid references public.customers(id) on delete set null,
  order_type text not null default 'dine_in' check (order_type in ('dine_in', 'take_away')),
  items jsonb not null,
  discount_type text check (discount_type is null or discount_type in ('percent', 'amount')),
  discount_value numeric,
  discount_reason text,
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  version int not null default 1,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  cancelled_by uuid references public.profiles(id),
  cancelled_approved_by uuid references public.profiles(id),
  cancel_reason text,
  cancelled_at timestamptz
);
create index held_bills_tenant_open_idx on public.held_bills (tenant_id) where status = 'open';
alter table public.held_bills enable row level security;
create policy held_bills_select on public.held_bills
  for select to authenticated using (tenant_id = public.auth_tenant_id());

create table public.held_bill_events (
  id uuid primary key default gen_random_uuid(),
  held_bill_id uuid not null references public.held_bills(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  event_type text not null check (event_type in ('held', 'updated', 'items_reduced', 'paid', 'cancelled')),
  detail jsonb,
  created_at timestamptz not null default now()
);
create index held_bill_events_bill_idx on public.held_bill_events (held_bill_id);
alter table public.held_bill_events enable row level security;
create policy held_bill_events_select on public.held_bill_events
  for select to authenticated using (tenant_id = public.auth_tenant_id());

alter table public.orders
  add column held_bill_id uuid unique references public.held_bills(id);

create or replace function public.prevent_direct_held_bill_link()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.held_bill_id is not null
     and (tg_op = 'INSERT' or new.held_bill_id is distinct from old.held_bill_id)
     and auth.uid() is not null then
    raise exception 'Linking an order to a held bill requires a service-role write';
  end if;
  return new;
end;
$$;
create trigger prevent_direct_held_bill_link_trigger
  before insert or update on public.orders
  for each row execute function public.prevent_direct_held_bill_link();
```

- [ ] Patch `database.ts` (both tables, `orders.held_bill_id`). DB check (rolled back): authenticated member can SELECT own tenant's held bills, cannot INSERT/UPDATE/DELETE them or events, cannot insert an order with `held_bill_id`; second order with the same `held_bill_id` fails UNIQUE. Commit.

### Task 2: Pure diff helper

**Files:** Create `src/lib/held-bill-diff.ts`.

- [ ] `lineIdentity(item: CartItem): string` = `productId|sorted optionIds|note ?? ""`; `diffReductions(before: CartItem[], after: CartItem[]): Reduction[]` where `Reduction = { name: string; options: string[]; note: string | null; fromQty: number; toQty: number }` — aggregate quantities per identity, emit every identity whose qty dropped (toQty 0 when gone). Node script checks: removed line, decreased qty, split lines of same identity, note change counts as reduce+add, pure additions → []. Commit.

### Task 3: Server actions

**Files:** Create `src/app/actions/held-bills.ts`; modify `src/app/actions/orders.ts`, `src/types/app.ts`; add `getOpenHeldBills`, `getCancelledHeldBillsToday`, `getHeldBillHistory` to `src/lib/dal.ts`.

- [ ] `holdBill(input: HeldBillInput)` → `{ id, queueNumber, version } | { error }`. `HeldBillInput = { items: CartItem[]; orderType; customerId: string | null; customerLabel: string; discountType: DiscountType | null; discountValue: number | null; discountReason: string }`. Validate items (`priceCartItems`), label (trim, ≤40, empty→null), discount (same rules as createOrder, reason optional here), queue via `next_queue_number` (user client), insert via admin, event `held` `{ total }`.
- [ ] `updateHeldBill(id, version, input)` → `{ version } | { error }`: admin load scoped by tenant, must be `open` & version match; validate; `diffReductions(stored, new)`; conditional update `.eq('id').eq('version', version).eq('status','open')` setting version+1, `updated_by/at`; 0 rows → conflict error; events `items_reduced` (if any) then `updated`.
- [ ] `cancelHeldBill(id, reason, pin)` → `{ success } | { error }`: reason required; PIN 6 digits; bcrypt against tenant owner/manager (same loop as `voidOrder`); conditional update open→cancelled with cancelled_* fields; event `cancelled { reason }`.
- [ ] `createOrder`: optional `heldBillId`, `heldBillVersion`. When set: admin-load held bill (tenant, open, version) else error; reuse its `queue_number` (skip RPC); insert order via admin with `held_bill_id`; on `23505` → "บิลนี้ชำระไปแล้ว"; after items insert succeeds: log `items_reduced` (diff stored vs paid items) + mark held bill `paid` + event `paid { order_id, order_number }` (best-effort, logged on failure).
- [ ] dal: `getOpenHeldBills(tenantId)` returns `HeldBillSummary[]` (id, version, queueNumber, customerLabel, customerId, customerPhone, orderType, items, discount fields, total via `computeDiscount`, createdAt), excluding any id already present in `orders.held_bill_id`; `getCancelledHeldBillsToday(tenantId)`; `getHeldBillHistory(heldBillId)` → events with actor names.
- [ ] tsc/eslint clean; commit.

### Task 4: POS UI

**Files:** Create `src/components/pos/held-bills-panel.tsx`, `hold-bill-modal.tsx`, `cancel-held-bill-modal.tsx`; modify `pos-screen.tsx`, `smart-cart.tsx`, `pos-header.tsx`, `src/app/(shell)/pos/page.tsx`.

- [ ] Page loads `heldBills` + `cancelledHeldToday` and passes them to `PosScreen`.
- [ ] `PosScreen` state: `activeHeld: { id; version; queueNumber; customerLabel } | null`, `loadedSnapshot: string | null` (JSON of items at load, for dirty check), `lastHeld: { queueNumber; customerLabel } | null`. Customer becomes parent-controlled (`customer: { id; phone } | null`) so a resumed bill shows its member.
- [ ] Footer: `[พักบิล | บันทึกบิลพัก]` (h-14, outline, ~1/3 width) + `[ชำระ ฿…]`. New cart → `HoldBillModal` (optional name ≤40 + confirm). Resumed → `updateHeldBill` directly. Success clears the cart and shows "พักบิลแล้ว · คิว N" in the empty-cart panel; `router.refresh()`.
- [ ] Cart banner when `activeHeld`: "บิลพัก · คิว N · label" + `[ปิด]` (confirm if dirty). "ล้างทั้งหมด" hidden while a held bill is loaded.
- [ ] Header `บิลพัก (n)` → `HeldBillsPanel` modal: cards oldest first (คิว large, label, item count, total, "พักไว้ X นาที"), tap to open (if cart dirty/non-empty unsaved → confirm "ทิ้งรายการในตะกร้า?" with a "พักตะกร้านี้ก่อน" option), `ยกเลิกบิล` → `CancelHeldBillModal` (quick reasons + text + PinPad); collapsed "ยกเลิกวันนี้ (n)".
- [ ] Paying a resumed bill passes `heldBillId/heldBillVersion`; success clears `activeHeld`, refreshes.
- [ ] tsc/eslint; commit.

### Task 5: Order history + shift warning

- [ ] Order detail: when `held_bill_id` set, "ประวัติบิลพัก" section from `getHeldBillHistory` (time, actor, event, reductions "ชาไทย 2 → 1").
- [ ] Shifts page passes open held bills count/total; `ShiftPanel` shows "บิลค้างจ่าย n บิล · ฿x" and on close requires a second confirm listing them.
- [ ] tsc/eslint; commit.

### Task 6: Live verification (QA tenant, 1180×740)

- [ ] Hold new cart with name → list shows คิว + name + total; queue number continues the day's sequence.
- [ ] Reopen → add item → save → version bumps, `updated` event; reduce qty → save → `items_reduced` event with from/to.
- [ ] Reopen → remove item → pay immediately → `items_reduced` + `paid` logged; order carries the held queue number and `held_bill_id`; bill disappears from list.
- [ ] Double-pay (two direct calls with same heldBillId) → exactly one order.
- [ ] Stale version update → conflict error.
- [ ] Cancel with wrong PIN → rejected; right PIN → cancelled, shows under "ยกเลิกวันนี้".
- [ ] Data API as authenticated: insert/update/delete held_bills, insert event, insert order with held_bill_id → all blocked.
- [ ] Held bill with over-threshold discount → re-approval required at payment.
- [ ] Shift page warning + double confirm; console clean; delete QA tenant.
