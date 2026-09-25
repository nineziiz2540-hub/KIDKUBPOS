# Queue Numbers (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every order gets a daily queue number (1, 2, 3… resetting each Bangkok day) that the cashier calls out; show it after checkout and in the orders list/detail; remove the unused table-number field.

**Architecture:** A per-tenant, per-business-date counter table incremented atomically by a `SECURITY DEFINER` RPC `next_queue_number`. `createOrder` calls it after all validation (like `generate_order_number`) and stores `orders.queue_number`. Held bills (Phase 3) will call the same RPC when first held.

**Tech Stack:** Next.js 16 server actions, Supabase Postgres (plpgsql), Tailwind v4.

## Global Constraints

- Business date = `(now() at time zone 'Asia/Bangkok')::date`; numbering starts at 1 each day per tenant.
- A rejected checkout must not consume a queue number (call the RPC after validation).
- RPC: `SECURITY DEFINER`, `search_path = public`, caller must belong to `p_tenant_id` when `auth.uid()` is set; EXECUTE revoked from `public`/`anon`, granted to `authenticated`, `service_role`.
- Historical orders keep `queue_number = null` and must still render.
- `orders.table_number` column is kept; new orders write null. The cart no longer shows a table field.
- Success panel shows "คิว N" at 48px (`text-5xl`).
- QA tenant only; no push without the user's request.

---

### Task 1: Counter table, RPC, column

**Files:** Create `supabase/migrations/20260925190000_queue_numbers.sql`; modify `src/types/database.ts`.

- [ ] **Step 1: Migration**

```sql
create table public.tenant_queue_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  business_date date not null,
  last_number int not null default 0,
  primary key (tenant_id, business_date)
);
-- Only reachable through next_queue_number (SECURITY DEFINER); no policies = no direct access.
alter table public.tenant_queue_counters enable row level security;

alter table public.orders add column queue_number int;

create or replace function public.next_queue_number(p_tenant_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number int;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.profiles where id = auth.uid() and tenant_id = p_tenant_id
  ) then
    raise exception 'p_tenant_id must match the caller''s own tenant';
  end if;

  insert into public.tenant_queue_counters as c (tenant_id, business_date, last_number)
  values (p_tenant_id, (now() at time zone 'Asia/Bangkok')::date, 1)
  on conflict (tenant_id, business_date)
  do update set last_number = c.last_number + 1
  returning last_number into v_number;

  return v_number;
end;
$$;

-- Unlike generate_order_number, anon must not reach this at all (its uid-only guard lets an
-- unauthenticated caller through).
revoke execute on function public.next_queue_number(uuid) from public, anon;
grant execute on function public.next_queue_number(uuid) to authenticated, service_role;
```

Apply via `apply_migration` (`queue_numbers`), then regenerate/patch `src/types/database.ts`: add the `tenant_queue_counters` table, `orders.queue_number: number | null` (Row) / optional (Insert/Update), and `next_queue_number: { Args: { p_tenant_id: string }; Returns: number }`.

- [ ] **Step 2: DB checks (rolled-back DO block)** as an authenticated QA owner: three calls return 1,2,3; calling with another tenant's id raises; after seeding yesterday's row with `last_number=40`, today's call still returns the next of today's sequence (not 41); `set role anon` → `permission denied`.
- [ ] **Step 3: Commit** — `feat(db): daily per-tenant queue number counter`

### Task 2: createOrder + UI

**Files:** `src/app/actions/orders.ts`, `src/components/pos/pos-screen.tsx`, `src/components/pos/smart-cart.tsx`, `src/types/app.ts`, `src/app/(shell)/orders/page.tsx`, `src/app/(shell)/orders/[id]/page.tsx`.

- [ ] **Step 1: createOrder** — right after `generate_order_number` succeeds:

```ts
  const { data: queueNumber, error: queueError } = await supabase.rpc("next_queue_number", {
    p_tenant_id: profile.tenant_id,
  });
  if (queueError || typeof queueNumber !== "number") return { error: "สร้างเลขคิวไม่สำเร็จ" };
```

insert `queue_number: queueNumber`, stop writing `table_number` (`table_number: null`), and add `queueNumber: number` to the success result type and return value.

- [ ] **Step 2: pos-screen** — remove `tableNumber` state, its reset calls, the `tableNumber` field in the `createOrder` payload, and the `tableNumber`/`onTableNumberChange` props; add `const [lastQueueNumber, setLastQueueNumber] = useState<number | null>(null)`, set it on success, clear it wherever `lastOrderNumber` is cleared; pass `lastQueueNumber` to both SmartCarts.
- [ ] **Step 3: smart-cart** — drop the table input and its props; add `lastQueueNumber: number | null`; in the empty-cart success panel render above the order line:

```tsx
{lastOrderNumber && lastQueueNumber !== null && (
  <div className="mb-2">
    <p className="text-sm font-medium text-muted-foreground">คิว</p>
    <p className="text-5xl font-bold text-accent tabular-nums leading-none">{lastQueueNumber}</p>
  </div>
)}
```

- [ ] **Step 4: `CreateOrderInput`** — remove `tableNumber?`.
- [ ] **Step 5: orders list** — select `queue_number`; when non-null render a pill `คิว {n}` (`text-xs font-semibold bg-accent/10 text-accent rounded-full px-2 py-0.5`) next to the order number.
- [ ] **Step 6: order detail** — select `queue_number`; when non-null render `คิว {n}` under the heading's order number.
- [ ] **Step 7:** `npx tsc --noEmit -p .`, `npx eslint src` → clean (pre-existing `<img>` warnings only).
- [ ] **Step 8: Commit** — `feat(pos): queue number on every order, drop table field`

### Task 3: Live verification (QA tenant, 1180×740)

- [ ] Three sales → success panel shows คิว 1, 2, 3; DB `queue_number` 1,2,3.
- [ ] A rejected checkout (direct action with a tampered price) → next real sale still gets the next number (no gap).
- [ ] Orders list and order detail show the queue pill; an old order without a number renders without a pill.
- [ ] Cart has no table field; dine-in/take-away still saved.
- [ ] Console clean in a fresh tab; delete the QA tenant.
