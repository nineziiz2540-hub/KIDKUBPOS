# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full Dashboard redesign approved in
`docs/superpowers/specs/2026-08-27-dashboard-redesign-design.md` — an always-visible
"today" section (Part 1), a period-selectable section below it (Part 2), a
payment-method cleanup prerequisite, and moving the Pricing Calculator to its own
nav page.

**Architecture:** Two new reusable `dal.ts` functions (`getCostProfit`,
`getMenuProfitBreakdown`) plus one fixed one (`getTopProducts` gains a date range)
back every new/changed widget; a single `CostProfitCard` and a single
`BestSellersList` component are shared between Part 1 and Part 2 (different props,
not different components) exactly as the spec calls for; `CategoryPerformanceChart`
gets a deterministic per-category-name color instead of index-cycled colors, so it
needs no changes at all to be reused as-is between Part 1 and Part 2. The date-math
bug found during research (`getSalesByCategory`'s week/month branches) is fixed by
deleting its internal (buggy) range computation and having it accept the same
`startDate`/`endDate` strings every other range-aware function already accepts —
removing duplicated logic, not adding an abstraction.

**Tech Stack:** Next.js 16 Server Components, Supabase, Recharts (already used by
`CategoryPerformanceChart`/`SalesTrendChart`/`PeakHoursChart`), `@base-ui/react/dialog`
(already used by `src/components/job-level/job-level-picker.tsx` — reuse that
exact modal pattern, including its backdrop-dismiss-by-click-target-check fix, for
the per-menu-profit "ดูทั้งหมด" modal).

## Global Constraints

- **No historical cost snapshot.** Every cost/profit figure in this plan uses
  *today's* `product_recipes` × `raw_materials.cost_per_unit` applied to
  historical `order_items` quantities — this is an accepted, spec'd limitation,
  not a bug to fix here.
- **A product with zero `product_recipes` rows costs ฿0.** Every function that
  computes cost must track and surface whether this happened (`hasUnrecipedItems`)
  rather than silently showing a misleadingly-low cost with no indication.
- **Order inclusion/exclusion**: every revenue/cost query in this plan must exclude
  `status = "cancelled"` and `status = "refunded"` orders — the exact same two
  `.neq()` calls already used identically by `getDashboardStats`, `getTopProducts`,
  `getSalesByDay`, `getSalesByMonth`, `getHourlyPattern`, and `getSalesSummary`.
  Do not invent different inclusion rules for any new function.
- **Bangkok date math**: any new date-boundary computation must follow the
  pattern already used correctly throughout `dal.ts` — `new Date(\`${dateStr}T00:00:00+07:00\`)`
  for a Bangkok-midnight boundary, end-exclusive ranges via `+24h` on the end
  boundary. Do not introduce a new date-math style; do not use `now - N*24h` (that
  is exactly the bug being fixed).
- **Per-menu profit does NOT include any `fixed_cost_monthly` allocation** — pure
  `revenue − ingredientCost`, per the spec's explicit final decision. Do not add a
  fixed-cost split to the per-menu table under any circumstance.
- **Category color is derived from the category NAME string** (via a deterministic
  hash into a fixed palette), not the category id — `order_items.category_name` is
  the only category identifier available at the point this data is aggregated
  (`order_items` has no `category_id` column, only a denormalized name snapshot;
  confirmed by reading `src/types/database.ts`). This is a deliberate, spec-
  compatible implementation refinement (the spec's prose said "id", the schema
  only offers the name at this join point) — same category **name** always
  produces the same color, which is what the spec's actual requirement was ("no
  hardcoded English category names", "same category always the same color").
- **No DB migrations in this plan.** Every new column need identified during
  research (a cost column, a unit column, a `categories.color` column) was
  explicitly rejected in the spec's "Out of scope" section — do not add any.
- This project has no automated test runner configured — verify every task live
  in the Browser pane against disposable QA data, matching this session's
  established practice throughout.

---

### Task 1: Remove "card" as a payment method, end to end

**Files:**
- Modify: `src/types/app.ts`
- Modify: `src/components/pos/pos-screen.tsx`
- Modify: `src/components/pos/smart-cart.tsx`
- Modify: `src/components/orders/refund-order-button.tsx`
- Modify: `src/app/actions/orders.ts`
- Modify: `src/components/orders/orders-filter.tsx`
- Modify: `src/app/(shell)/orders/page.tsx`
- Modify: `src/lib/dal.ts` (shift-close reconciliation function, ~line 700-790)
- Modify: `src/components/shifts/shift-panel.tsx`

**Interfaces:**
- Produces: `PosOrderInput.paymentMethod`, `PaymentMethod` (smart-cart.tsx),
  `RefundMethod`, and both `FilterValue` types narrow from `"cash" | "transfer" |
  "card"` to `"cash" | "transfer"` (or, for the `FilterValue` types which also
  include non-payment values, simply drop `"card"` from the union) — consumed by
  every later task that touches payment method data, so this task must land first.

This task is independent of every other task in this plan — do it in any order,
but before Task 6 (Payment Method card), since that task's dal function should
only ever need to handle two buckets.

- [ ] **Step 1: `src/types/app.ts`**

Find:
```ts
  paymentMethod: "cash" | "transfer" | "card";
```
Replace with:
```ts
  paymentMethod: "cash" | "transfer";
```

- [ ] **Step 2: `src/components/pos/pos-screen.tsx`**

Find:
```ts
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer" | "card">("cash");
```
Replace with:
```ts
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer">("cash");
```

- [ ] **Step 3: `src/components/pos/smart-cart.tsx`**

Find:
```ts
type PaymentMethod = "cash" | "transfer" | "card";
```
Replace with:
```ts
type PaymentMethod = "cash" | "transfer";
```

Find:
```ts
const PAYMENT_METHODS: PaymentMethod[] = ["cash", "transfer", "card"];
```
Replace with:
```ts
const PAYMENT_METHODS: PaymentMethod[] = ["cash", "transfer"];
```

Read the file's label lookup near these lines (around line 11-19 per prior
research — labels map `cash → "เงินสด"`, `transfer → "โอน"`, `card → "บัตร"") and
remove the `card: "บัตร"` entry from that lookup object as well, keeping only
`cash`/`transfer`.

- [ ] **Step 4: `src/components/orders/refund-order-button.tsx`**

Find:
```ts
type RefundMethod = "cash" | "transfer" | "card";
```
Replace with:
```ts
type RefundMethod = "cash" | "transfer";
```

Find and remove this line entirely (it defines the "บัตร" option in the refund
method selector's options array):
```ts
  { value: "card", label: "บัตร" },
```

- [ ] **Step 5: `src/app/actions/orders.ts`**

Find (around line 321-327):
```ts
  if (
    refundMethod !== "cash" &&
    refundMethod !== "transfer" &&
    refundMethod !== "card"
  ) {
    return { error: "กรุณาเลือกวิธีคืนเงิน" };
  }
```
Replace with:
```ts
  if (refundMethod !== "cash" && refundMethod !== "transfer") {
    return { error: "กรุณาเลือกวิธีคืนเงิน" };
  }
```

- [ ] **Step 6: `src/components/orders/orders-filter.tsx`**

Find:
```ts
type FilterValue = "all" | "cash" | "transfer" | "card" | "cancelled" | "refunded";
```
Replace with:
```ts
type FilterValue = "all" | "cash" | "transfer" | "cancelled" | "refunded";
```

Find and remove this line entirely (the "บัตร" filter option):
```ts
  { value: "card", label: "บัตร" },
```

- [ ] **Step 7: `src/app/(shell)/orders/page.tsx`**

Find (line 8):
```ts
type FilterValue = "all" | "cash" | "transfer" | "card" | "cancelled" | "refunded";
```
Replace with:
```ts
type FilterValue = "all" | "cash" | "transfer" | "cancelled" | "refunded";
```

- [ ] **Step 8: `src/lib/dal.ts` — shift-close reconciliation**

Read the shift-close function (search for `totalCard` — it appears at the type
definition, the computation, and the return statement, roughly lines 705, 753-755,
785). Remove:
- the `totalCard: number;` line from the return type definition
- the entire `const totalCard = rows.filter((r) => r.payment_method === "card").reduce(...)` block
- `totalCard,` from the final returned object

Leave `totalCashGross`/`totalTransfer` and everything else in that function
untouched.

- [ ] **Step 9: `src/components/shifts/shift-panel.tsx`**

Find and remove the display row for `totalCard` (around line 113 — the pattern
is `฿{summary?.totalCard.toFixed(2) ?? "0.00"}` inside a labeled row, mirroring
the cash/transfer rows above it; remove that whole label+value row, leaving the
cash and transfer rows unchanged).

- [ ] **Step 10: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If a type error appears anywhere referencing `"card"` that
wasn't in this file list, that means the earlier codebase search missed a call
site — find and fix it; do not silence the error.)

- [ ] **Step 11: Live-verify**

Using the disposable-QA-tenant pattern established this session: confirm the POS
checkout screen shows only "เงินสด"/"โอน" buttons (no "บัตร"); confirm the refund
modal shows only two method options; confirm the Orders list filter dropdown has
no "บัตร" entry; confirm a shift-close summary shows no "บัตร" row. Delete QA data
after.

- [ ] **Step 12: Commit**

```bash
git add src/types/app.ts src/components/pos/pos-screen.tsx src/components/pos/smart-cart.tsx src/components/orders/refund-order-button.tsx src/app/actions/orders.ts src/components/orders/orders-filter.tsx "src/app/(shell)/orders/page.tsx" src/lib/dal.ts src/components/shifts/shift-panel.tsx
git commit -m "refactor(payments): remove unused card payment method end-to-end"
```

---

### Task 2: Fix Thai-calendar-aligned date math for week/month, remove the "day" tab from Part 2

**Files:**
- Modify: `src/lib/dal.ts` (`getSalesByCategory`)
- Modify: `src/app/(shell)/page.tsx` (date computation block, lines ~113-187)
- Modify: `src/components/dashboard/analytics-section.tsx` (`RANGE_TABS`, `Range` type)
- Modify: `src/components/dashboard/summary-cards.tsx` (`RANGE_LABELS`)

**Interfaces:**
- Produces: `Range` type narrows from `"day" | "week" | "month" | "year" |
  "custom"` to `"week" | "month" | "year" | "custom"` everywhere Part 2 touches
  it. `getSalesByCategory`'s signature changes from `(tenantId, range,
  customRange?)` to `(tenantId, startDate, endDate)` — consumed by Task 10's
  final page wiring, but must be correct before that task can be written.
- Consumes: nothing new.

This task must land before Task 10 (final integration), since Task 10 assumes the
week/month boundaries are already calendar-aligned and the "day" tab is already
gone.

- [ ] **Step 1: Simplify `getSalesByCategory` in `src/lib/dal.ts`**

Replace the entire function (currently lines 443-508):
```ts
export async function getSalesByCategory(
  tenantId: string,
  range: "day" | "week" | "month" | "year" | "custom",
  customRange?: { start: string; end: string } // "YYYY-MM-DD" Bangkok, required when range === "custom"
): Promise<{ category: string; total: number }[]> {
  const supabase = await createClient();
  const offsetMs = 7 * 60 * 60 * 1000;
  const now = new Date();
  const bangkokNow = new Date(now.getTime() + offsetMs);

  let rangeStart: Date;
  let rangeEndExclusive: Date | null = null;
  if (range === "custom" && customRange) {
    rangeStart = new Date(`${customRange.start}T00:00:00+07:00`);
    rangeEndExclusive = new Date(`${customRange.end}T00:00:00+07:00`);
    rangeEndExclusive.setTime(rangeEndExclusive.getTime() + 24 * 60 * 60 * 1000);
  } else if (range === "day") {
    const midnight = Date.UTC(
      bangkokNow.getUTCFullYear(),
      bangkokNow.getUTCMonth(),
      bangkokNow.getUTCDate()
    );
    rangeStart = new Date(midnight - offsetMs);
  } else if (range === "week") {
    rangeStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (range === "month") {
    rangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    // year — ตั้งแต่ 1 ม.ค. ของปีนี้ตาม Bangkok time
    rangeStart = new Date(`${bangkokNow.getUTCFullYear()}-01-01T00:00:00+07:00`);
  }

  let query = supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .neq("status", "refunded")
    .gte("created_at", rangeStart.toISOString());
  if (rangeEndExclusive) {
    query = query.lt("created_at", rangeEndExclusive.toISOString());
  }
  const { data: orders } = await query;

  if (!orders || orders.length === 0) return [];

  const orderIds = (orders as { id: string }[]).map((o) => o.id);

  const { data: items } = await supabase
    .from("order_items")
    .select("category_name, subtotal")
    .in("order_id", orderIds);

  const byCategory = new Map<string, number>();
  for (const item of (items ?? []) as {
    category_name: string | null;
    subtotal: number;
  }[]) {
    const cat = item.category_name ?? "ไม่มีหมวดหมู่";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + Number(item.subtotal));
  }

  return [...byCategory.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}
```
with:
```ts
export async function getSalesByCategory(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string    // "YYYY-MM-DD" Bangkok (inclusive)
): Promise<{ category: string; total: number }[]> {
  const supabase = await createClient();
  const rangeStart = new Date(`${startDate}T00:00:00+07:00`);
  const rangeEnd = new Date(`${endDate}T00:00:00+07:00`);
  rangeEnd.setTime(rangeEnd.getTime() + 24 * 60 * 60 * 1000);

  const { data: orders } = await supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .neq("status", "refunded")
    .gte("created_at", rangeStart.toISOString())
    .lt("created_at", rangeEnd.toISOString());

  if (!orders || orders.length === 0) return [];

  const orderIds = (orders as { id: string }[]).map((o) => o.id);

  const { data: items } = await supabase
    .from("order_items")
    .select("category_name, subtotal")
    .in("order_id", orderIds);

  const byCategory = new Map<string, number>();
  for (const item of (items ?? []) as {
    category_name: string | null;
    subtotal: number;
  }[]) {
    const cat = item.category_name ?? "ไม่มีหมวดหมู่";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + Number(item.subtotal));
  }

  return [...byCategory.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}
```
(This deletes the buggy `now - N*24h` week/month computation entirely — the
function now trusts its caller for the boundary, exactly like `getSalesByDay`/
`getSalesSummary` already do, which is what makes the boundaries consistent.)

**Note on `src/app/(shell)/page.tsx`**: that file also computes date ranges and
also calls `getSalesByCategory`, and will therefore show `tsc` errors after this
task's Step 1 alone (old 3-arg call against the new 3-arg-but-different-shape
signature, old `"day"`-inclusive `range` type). **Do not edit `page.tsx` in this
task** — Task 10 replaces the entire file in one shot (including the corrected,
calendar-aligned date math), so any edit made to it here would just be
overwritten there. Leave those `tsc` errors in place; Task 10's own type-check
step is where they get resolved.

- [ ] **Step 2: Narrow the `Range` type and tabs in `src/components/dashboard/analytics-section.tsx`**

Find:
```ts
type Range = "day" | "week" | "month" | "year" | "custom";

const RANGE_TABS: { value: Range; label: string }[] = [
  { value: "day", label: "วันนี้" },
  { value: "week", label: "7 วัน" },
  { value: "month", label: "30 วัน" },
  { value: "year", label: "ปีนี้" },
];
```
Replace with:
```ts
type Range = "week" | "month" | "year" | "custom";

const RANGE_TABS: { value: Range; label: string }[] = [
  { value: "week", label: "รายสัปดาห์" },
  { value: "month", label: "รายเดือน" },
  { value: "year", label: "รายปี" },
];
```

Find the sales-trend-chart conditional block (currently lines 109-118):
```ts
          {range === "day" && hourlyData !== null && (
            <SalesTrendChart range="day" data={hourlyData} />
          )}
          {(range === "week" || range === "month" || range === "custom") && dailyData !== null && (
            <SalesTrendChart range={range} data={dailyData} />
          )}
          {range === "year" && monthlyData !== null && (
            <SalesTrendChart range="year" data={monthlyData} />
          )}
```
Replace with:
```ts
          {(range === "week" || range === "month" || range === "custom") && dailyData !== null && (
            <SalesTrendChart range={range} data={dailyData} />
          )}
          {range === "year" && monthlyData !== null && (
            <SalesTrendChart range="year" data={monthlyData} />
          )}
```

Also update this component's `Props` type — find:
```ts
type Props = {
  range: Range;
  summary: SalesSummary;
  hourlyData: { hour: number; total: number }[] | null;
  dailyData: SalesByDay[] | null;
  monthlyData: SalesByMonth[] | null;
  peakHours: HourlyPattern[] | null;
  categoryData: { category: string; total: number }[];
};
```
Replace with (drop `hourlyData`, no longer used by this component now that "day"
is gone from Part 2 — Part 1's own trend chart, wired in Task 10, fetches its own
hourly data independently at the page level):
```ts
type Props = {
  range: Range;
  summary: SalesSummary;
  dailyData: SalesByDay[] | null;
  monthlyData: SalesByMonth[] | null;
  peakHours: HourlyPattern[] | null;
  categoryData: { category: string; total: number }[];
};
```
And remove `hourlyData` from the function's destructured parameters accordingly.

- [ ] **Step 3: Update `RANGE_LABELS` in `src/components/dashboard/summary-cards.tsx`**

Find:
```ts
const RANGE_LABELS: Record<string, string> = {
  day: "วันนี้",
  week: "7 วันล่าสุด",
  month: "30 วันล่าสุด",
  year: "ปีนี้",
};
```
Replace with:
```ts
const RANGE_LABELS: Record<string, string> = {
  week: "สัปดาห์นี้",
  month: "เดือนนี้",
  year: "ปีนี้",
};
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: errors confined entirely to `src/app/(shell)/page.tsx` (its
`getSalesByCategory` call and its `range`/`hourlyData` wiring are now stale
against this task's changes) — **do not fix `page.tsx` here**, Task 10 replaces
it whole. Confirm no error appears in any OTHER file — if one does, this task's
own changes have a real bug to fix before moving on.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dal.ts src/components/dashboard/analytics-section.tsx src/components/dashboard/summary-cards.tsx
git commit -m "fix(dashboard): align week/month ranges to Thai calendar boundaries"
```

(`src/app/(shell)/page.tsx` is untouched by this task on purpose — see the note
above Step 2 — so it is not part of this commit. It gets its matching date-math
rewrite, plus everything else, in Task 10's single full-file replacement.)

---

### Task 3: Category pie chart — deterministic per-name color

**Files:**
- Modify: `src/components/dashboard/category-performance-chart.tsx`

**Interfaces:**
- Consumes: `{ category: string; total: number }[]` — unchanged shape from
  `getSalesByCategory`.
- Produces: no new exports; internal rendering only. No changes needed anywhere
  else — Part 1 and Part 2 both already pass this same shape in, so this
  component is used as-is by Task 10's wiring on both sides.

Fully independent of every other task.

- [ ] **Step 1: Replace the color logic**

Replace the whole file:
```tsx
"use client";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";

const CATEGORY_PALETTE = [
  "#8b5e3c", // coffee brown
  "#22c55e", // green (matcha)
  "#f97316", // orange (Thai tea / non-coffee)
  "#eab308", // yellow (bakery / croissant)
  "#60a5fa", // blue
  "#f472b6", // pink
  "#a78bfa", // purple
  "#14b8a6", // teal
];
const UNCATEGORIZED_COLOR = "#4b5563"; // reserved dark gray, not part of the rotation
const UNCATEGORIZED_LABEL = "ไม่มีหมวดหมู่";

function colorForCategory(name: string): string {
  if (name === UNCATEGORIZED_LABEL) return UNCATEGORIZED_COLOR;
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length]!;
}

export function CategoryPerformanceChart({
  data,
}: {
  data: { category: string; total: number }[];
}) {
  const filtered = data.filter((d) => d.total > 0);

  if (filtered.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        ยังไม่มีข้อมูลการขายในช่วงนี้
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={filtered}
          dataKey="total"
          nameKey="category"
          cx="50%"
          cy="50%"
          outerRadius={80}
          innerRadius={40}
          paddingAngle={2}
        >
          {filtered.map((d) => (
            <Cell key={d.category} fill={colorForCategory(d.category)} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v: unknown, _name: unknown, entry: { payload?: { category?: string; total?: number } }) => {
            const total = Number(v ?? 0);
            const grandTotal = filtered.reduce((sum, d) => sum + d.total, 0);
            const pct = grandTotal > 0 ? ((total / grandTotal) * 100).toFixed(1) : "0.0";
            return [`฿${total.toFixed(2)} (${pct}%)`, entry.payload?.category ?? "ยอดขาย"] as [
              string,
              string
            ];
          }}
        />
        <Legend
          formatter={(value: string) => (
            <span className="text-xs text-sidebar">{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

(This also adds the "% of total" the spec calls for — "แบ่งยอดขายตามหมวดหมู่เป็น
%" — directly in the tooltip, which is the natural place for it on a pie chart;
the legend already shows category names via `nameKey="category"`.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Live-verify**

With any tenant that has 2+ categories with sales, load the dashboard and confirm:
each category slice has a distinct color; reloading the page gives the SAME
colors again (not re-randomized); a category with no name match (any real name)
still renders — it never crashes or falls back to `undefined` fill.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/category-performance-chart.tsx
git commit -m "feat(dashboard): deterministic per-category colors, tenant-agnostic"
```

---

### Task 4: Fix `getTopProducts` to accept a date range and correct unit labels; extract `BestSellersList`

**Files:**
- Modify: `src/lib/dal.ts` (`getTopProducts`, plus a new shared `classifyUnit` helper)
- Create: `src/components/dashboard/best-sellers-list.tsx`

**Interfaces:**
- Produces: `getTopProducts(tenantId, startDate, endDate, limit = 5):
  Promise<TopProduct[]>` where `TopProduct` gains a `unit: "แก้ว" | "ชิ้น" |
  "ขวด"` field; `classifyUnit(categoryName: string | null): "แก้ว" | "ชิ้น" |
  "ขวด"` — also consumed by Task 6 (Sales Quantity Summary), so define it once
  here, exported, and Task 6 imports it rather than redefining it.
- Produces: `BestSellersList({ products: TopProduct[] })` — a presentational
  component extracted from the inline JSX currently in `src/app/(shell)/page.tsx`
  lines 218-247, used twice by Task 10 (once for Part 1's today list, once for
  Part 2's period list).

- [ ] **Step 1: Add `classifyUnit` and rewrite `getTopProducts` in `src/lib/dal.ts`**

Replace the current function (lines 108-153):
```ts
export type TopProduct = {
  product_name: string;
  total_qty: number;
  total_sales: number;
};

export async function getTopProducts(
  tenantId: string,
  limit = 5
): Promise<TopProduct[]> {
  const supabase = await createClient();

  const { data: orderRows } = (await supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .neq("status", "refunded")) as { data: { id: string }[] | null };

  if (!orderRows || orderRows.length === 0) return [];

  const orderIds = orderRows.map((r) => r.id);

  const { data: items } = (await supabase
    .from("order_items")
    .select("product_name, quantity, subtotal")
    .in("order_id", orderIds)) as {
    data: { product_name: string; quantity: number; subtotal: number }[] | null;
  };

  if (!items) return [];

  const map = new Map<string, { total_qty: number; total_sales: number }>();
  for (const row of items) {
    const prev = map.get(row.product_name) ?? { total_qty: 0, total_sales: 0 };
    map.set(row.product_name, {
      total_qty: prev.total_qty + row.quantity,
      total_sales: prev.total_sales + Number(row.subtotal),
    });
  }

  return [...map.entries()]
    .map(([product_name, s]) => ({ product_name, ...s }))
    .sort((a, b) => b.total_qty - a.total_qty)
    .slice(0, limit);
}
```
with:
```ts
export type SoldUnit = "แก้ว" | "ชิ้น" | "ขวด";

const DRINK_KEYWORDS = [
  "coffee", "กาแฟ", "matcha", "มัทฉะ", "tea", "ชา",
  "non-coffee", "non coffee", "noncoffee",
];
const BAKERY_KEYWORDS = ["bakery", "เบเกอรี่", "ขนม", "cake", "เค้ก"];

export function classifyUnit(categoryName: string | null): SoldUnit {
  if (!categoryName) return "ขวด";
  const lower = categoryName.toLowerCase();
  if (DRINK_KEYWORDS.some((k) => lower.includes(k))) return "แก้ว";
  if (BAKERY_KEYWORDS.some((k) => lower.includes(k))) return "ชิ้น";
  return "ขวด";
}

export type TopProduct = {
  product_name: string;
  total_qty: number;
  total_sales: number;
  unit: SoldUnit;
};

export async function getTopProducts(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string,   // "YYYY-MM-DD" Bangkok (inclusive)
  limit = 5
): Promise<TopProduct[]> {
  const supabase = await createClient();
  const rangeStart = new Date(`${startDate}T00:00:00+07:00`);
  const rangeEnd = new Date(`${endDate}T00:00:00+07:00`);
  rangeEnd.setTime(rangeEnd.getTime() + 24 * 60 * 60 * 1000);

  const { data: orderRows } = (await supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .neq("status", "refunded")
    .gte("created_at", rangeStart.toISOString())
    .lt("created_at", rangeEnd.toISOString())) as { data: { id: string }[] | null };

  if (!orderRows || orderRows.length === 0) return [];

  const orderIds = orderRows.map((r) => r.id);

  const { data: items } = (await supabase
    .from("order_items")
    .select("product_name, category_name, quantity, subtotal")
    .in("order_id", orderIds)) as {
    data:
      | {
          product_name: string;
          category_name: string | null;
          quantity: number;
          subtotal: number;
        }[]
      | null;
  };

  if (!items) return [];

  const map = new Map<
    string,
    { total_qty: number; total_sales: number; category_name: string | null }
  >();
  for (const row of items) {
    const prev = map.get(row.product_name) ?? {
      total_qty: 0,
      total_sales: 0,
      category_name: row.category_name,
    };
    map.set(row.product_name, {
      total_qty: prev.total_qty + row.quantity,
      total_sales: prev.total_sales + Number(row.subtotal),
      category_name: prev.category_name ?? row.category_name,
    });
  }

  return [...map.entries()]
    .map(([product_name, s]) => ({
      product_name,
      total_qty: s.total_qty,
      total_sales: s.total_sales,
      unit: classifyUnit(s.category_name),
    }))
    .sort((a, b) => b.total_qty - a.total_qty)
    .slice(0, limit);
}
```

- [ ] **Step 2: Create `src/components/dashboard/best-sellers-list.tsx`**

```tsx
import type { TopProduct } from "@/lib/dal";

export function BestSellersList({ products }: { products: TopProduct[] }) {
  return (
    <div className="rounded-lg border bg-white divide-y divide-border">
      {products.length > 0 ? (
        products.map((p, i) => (
          <div key={p.product_name} className="flex items-center gap-4 px-4 py-3">
            <span className="text-sm font-bold text-muted-foreground w-5 text-center tabular-nums">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sidebar text-sm truncate">{p.product_name}</p>
              <p className="text-xs text-muted-foreground">
                {p.total_qty} {p.unit}
              </p>
            </div>
            <p className="text-sm font-semibold text-sidebar tabular-nums">
              ฿{p.total_sales.toFixed(2)}
            </p>
          </div>
        ))
      ) : (
        <p className="px-4 py-12 text-center text-muted-foreground text-sm">
          ยังไม่มีข้อมูลการขาย
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: errors only in `src/app/(shell)/page.tsx` (still calling
`getTopProducts(profile.tenant_id, 5)` with the old 2-arg signature, and still
containing the old inline best-sellers JSX) — resolved by Task 10, same as
Task 2's Step 6. Confirm no OTHER file has a stray `getTopProducts` call.

- [ ] **Step 4: Commit**

```bash
git add src/lib/dal.ts src/components/dashboard/best-sellers-list.tsx
git commit -m "fix(dashboard): scope getTopProducts to a date range, fix unit labels"
```

---

### Task 5: `getCostProfit` + `CostProfitCard` (shared by Part 1 and Part 2)

**Files:**
- Modify: `src/lib/dal.ts` (new `getCostProfit` function + `CostProfitSummary` type)
- Create: `src/components/dashboard/cost-profit-card.tsx`

**Interfaces:**
- Produces: `getCostProfit(tenantId, startDate, endDate, daysInPeriod):
  Promise<CostProfitSummary>` where
  `CostProfitSummary = { revenue: number; cogs: number; fixedCostShare: number;
  totalCost: number; profit: number; hasUnrecipedItems: boolean }`.
- Produces: `CostProfitCard({ current: CostProfitSummary; previous?:
  CostProfitSummary })` — when `previous` is supplied (Part 1's yesterday
  comparison), renders `TrendBadge`-style up/down/flat indicators on both
  numbers; when omitted (Part 2), renders just the two numbers with no badge.
- Consumes: `tenants.fixed_cost_monthly`, `product_recipes` × `raw_materials`,
  `order_items.product_id`/`quantity`, `orders.total`/`status`/`created_at` —
  all existing columns, no schema changes.

Independent of every other task except that it must land before Task 10.

- [ ] **Step 1: Add `getCostProfit` to `src/lib/dal.ts`**

Add this after `getSalesSummary` (after line 649):
```ts
// ─── Cost & Profit ────────────────────────────────────────────────────────────

export type CostProfitSummary = {
  revenue: number;
  cogs: number;
  fixedCostShare: number;
  totalCost: number;
  profit: number;
  hasUnrecipedItems: boolean;
};

export async function getCostProfit(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string,   // "YYYY-MM-DD" Bangkok (inclusive)
  daysInPeriod: number
): Promise<CostProfitSummary> {
  const supabase = await createClient();
  const rangeStart = new Date(`${startDate}T00:00:00+07:00`);
  const rangeEnd = new Date(`${endDate}T00:00:00+07:00`);
  rangeEnd.setTime(rangeEnd.getTime() + 24 * 60 * 60 * 1000);

  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("fixed_cost_monthly")
    .eq("id", tenantId)
    .single();
  const fixedCostMonthly = Number(
    (tenantRow as { fixed_cost_monthly: number } | null)?.fixed_cost_monthly ?? 0
  );
  const fixedCostShare = (fixedCostMonthly / 30) * daysInPeriod;

  const { data: orders } = await supabase
    .from("orders")
    .select("id, total")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .neq("status", "refunded")
    .gte("created_at", rangeStart.toISOString())
    .lt("created_at", rangeEnd.toISOString());

  const orderRows = (orders ?? []) as { id: string; total: number }[];
  const revenue = orderRows.reduce((sum, r) => sum + Number(r.total), 0);

  if (orderRows.length === 0) {
    return {
      revenue: 0,
      cogs: 0,
      fixedCostShare,
      totalCost: fixedCostShare,
      profit: -fixedCostShare,
      hasUnrecipedItems: false,
    };
  }

  const orderIds = orderRows.map((o) => o.id);

  const { data: items } = await supabase
    .from("order_items")
    .select("product_id, quantity")
    .in("order_id", orderIds);

  const qtyByProduct = new Map<string, number>();
  for (const item of (items ?? []) as { product_id: string | null; quantity: number }[]) {
    if (!item.product_id) continue;
    qtyByProduct.set(item.product_id, (qtyByProduct.get(item.product_id) ?? 0) + item.quantity);
  }
  const productIds = [...qtyByProduct.keys()];

  const { data: recipeRows } =
    productIds.length > 0
      ? await supabase
          .from("product_recipes")
          .select("product_id, quantity_used, raw_materials(cost_per_unit)")
          .in("product_id", productIds)
      : { data: [] as unknown[] };

  type RecipeRow = {
    product_id: string;
    quantity_used: number;
    raw_materials: { cost_per_unit: number } | null;
  };
  const costPerProduct = new Map<string, number>();
  for (const r of (recipeRows ?? []) as RecipeRow[]) {
    if (!r.raw_materials) continue;
    const lineCost = Number(r.quantity_used) * Number(r.raw_materials.cost_per_unit);
    costPerProduct.set(r.product_id, (costPerProduct.get(r.product_id) ?? 0) + lineCost);
  }

  let cogs = 0;
  let hasUnrecipedItems = false;
  for (const [productId, qty] of qtyByProduct) {
    const unitCost = costPerProduct.get(productId);
    if (unitCost === undefined) {
      hasUnrecipedItems = true;
      continue;
    }
    cogs += unitCost * qty;
  }

  const totalCost = cogs + fixedCostShare;

  return {
    revenue,
    cogs,
    fixedCostShare,
    totalCost,
    profit: revenue - totalCost,
    hasUnrecipedItems,
  };
}
```

- [ ] **Step 2: Create `src/components/dashboard/cost-profit-card.tsx`**

```tsx
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CostProfitSummary } from "@/lib/dal";

function TrendBadge({ current, previous }: { current: number; previous: number }) {
  if (current > previous)
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-green-600">
        <TrendingUp size={12} />
        ดีกว่าเมื่อวาน
      </span>
    );
  if (current < previous)
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-destructive">
        <TrendingDown size={12} />
        น้อยกว่าเมื่อวาน
      </span>
    );
  return (
    <span className="flex items-center gap-0.5 text-xs font-medium text-muted-foreground">
      <Minus size={12} />
      เท่าเมื่อวาน
    </span>
  );
}

export function CostProfitCard({
  current,
  previous,
}: {
  current: CostProfitSummary;
  previous?: CostProfitSummary;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">ต้นทุน</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-2xl font-bold text-sidebar tabular-nums">
              ฿{current.totalCost.toFixed(2)}
            </p>
            {previous && <TrendBadge current={previous.totalCost} previous={current.totalCost} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">กำไร</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p
              className={`text-2xl font-bold tabular-nums ${
                current.profit >= 0 ? "text-sidebar" : "text-destructive"
              }`}
            >
              ฿{current.profit.toFixed(2)}
            </p>
            {previous && <TrendBadge current={current.profit} previous={previous.profit} />}
          </CardContent>
        </Card>
      </div>
      {current.hasUnrecipedItems && (
        <p className="text-xs text-muted-foreground">
          มีสินค้าที่ยังไม่ได้ตั้งต้นทุนบางรายการ ตัวเลขอาจไม่ครบถ้วน
        </p>
      )}
    </div>
  );
}
```

Note the `TrendBadge` call for "ต้นทุน" (cost) intentionally passes
`current={previous.totalCost} previous={current.totalCost}` — reversed order —
because a HIGHER cost than yesterday should show as "worse" (red/down), which
this shared `TrendBadge`'s "higher = green up arrow" logic would otherwise get
backwards for a cost figure (unlike revenue/profit, where higher is always
better). Do not "fix" this to look symmetric with the profit badge — it is
deliberately inverted for correctness.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors (this file isn't wired into `page.tsx` until Task 10, so
it should compile standalone with no errors of its own).

- [ ] **Step 4: Commit**

```bash
git add src/lib/dal.ts src/components/dashboard/cost-profit-card.tsx
git commit -m "feat(dashboard): add cost/profit calculation and card"
```

---

### Task 6: Payment Method card (Part 1 only)

**Files:**
- Modify: `src/lib/dal.ts` (new `getPaymentMethodBreakdown`)
- Create: `src/components/dashboard/payment-method-card.tsx`

**Interfaces:**
- Produces: `getPaymentMethodBreakdown(tenantId, startDate, endDate):
  Promise<{ cash: number; transfer: number }>`.
- Produces: `PaymentMethodCard({ cash: number; transfer: number })`.
- Consumes: `orders.payment_method` — now only `"cash" | "transfer"` after
  Task 1.

Independent; only ordering constraint is it should land after Task 1 (so there's
definitely no `"card"` data path left to consider), and before Task 10.

- [ ] **Step 1: Add `getPaymentMethodBreakdown` to `src/lib/dal.ts`**

Add after the `getCostProfit` function from Task 5:
```ts
// ─── Payment Method Breakdown ───────────────────────────────────────────────

export async function getPaymentMethodBreakdown(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string    // "YYYY-MM-DD" Bangkok (inclusive)
): Promise<{ cash: number; transfer: number }> {
  const supabase = await createClient();
  const rangeStart = new Date(`${startDate}T00:00:00+07:00`);
  const rangeEnd = new Date(`${endDate}T00:00:00+07:00`);
  rangeEnd.setTime(rangeEnd.getTime() + 24 * 60 * 60 * 1000);

  const { data } = await supabase
    .from("orders")
    .select("total, payment_method")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .neq("status", "refunded")
    .gte("created_at", rangeStart.toISOString())
    .lt("created_at", rangeEnd.toISOString());

  const rows = (data ?? []) as { total: number; payment_method: string }[];
  return {
    cash: rows.filter((r) => r.payment_method === "cash").reduce((sum, r) => sum + Number(r.total), 0),
    transfer: rows
      .filter((r) => r.payment_method === "transfer")
      .reduce((sum, r) => sum + Number(r.total), 0),
  };
}
```

- [ ] **Step 2: Create `src/components/dashboard/payment-method-card.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PaymentMethodCard({ cash, transfer }: { cash: number; transfer: number }) {
  const total = cash + transfer;
  const cashPct = total > 0 ? ((cash / total) * 100).toFixed(0) : "0";
  const transferPct = total > 0 ? ((transfer / total) * 100).toFixed(0) : "0";

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">เงินสด</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-sidebar tabular-nums">
            ฿{cash.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">({cashPct}%)</span>
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">เงินโอน</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-sidebar tabular-nums">
            ฿{transfer.toFixed(2)} <span className="text-sm font-normal text-muted-foreground">({transferPct}%)</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/dal.ts src/components/dashboard/payment-method-card.tsx
git commit -m "feat(dashboard): add payment method breakdown card"
```

---

### Task 7: Sales Quantity Summary card ("สรุปจำนวนขาย", Part 1 only)

**Files:**
- Modify: `src/lib/dal.ts` (new `getSalesQuantitySummary`)
- Create: `src/components/dashboard/sales-quantity-summary.tsx`

**Interfaces:**
- Consumes: `classifyUnit` from Task 4 (import it, do not redefine it).
- Produces: `getSalesQuantitySummary(tenantId, startDate, endDate):
  Promise<{ category: string; unit: SoldUnit; qty: number }[]>` — one row per
  category name that had sales in range, plus `SalesQuantitySummary({ rows })`
  which renders the per-category rows and the totals line.

Must land after Task 4 (depends on `classifyUnit`/`SoldUnit` existing).

- [ ] **Step 1: Add `getSalesQuantitySummary` to `src/lib/dal.ts`**

Add after `getPaymentMethodBreakdown` from Task 6:
```ts
// ─── Sales Quantity Summary ─────────────────────────────────────────────────

export type CategoryQty = { category: string; unit: SoldUnit; qty: number };

export async function getSalesQuantitySummary(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string    // "YYYY-MM-DD" Bangkok (inclusive)
): Promise<CategoryQty[]> {
  const supabase = await createClient();
  const rangeStart = new Date(`${startDate}T00:00:00+07:00`);
  const rangeEnd = new Date(`${endDate}T00:00:00+07:00`);
  rangeEnd.setTime(rangeEnd.getTime() + 24 * 60 * 60 * 1000);

  const { data: orders } = await supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .neq("status", "refunded")
    .gte("created_at", rangeStart.toISOString())
    .lt("created_at", rangeEnd.toISOString());

  if (!orders || orders.length === 0) return [];

  const orderIds = (orders as { id: string }[]).map((o) => o.id);

  const { data: items } = await supabase
    .from("order_items")
    .select("category_name, quantity")
    .in("order_id", orderIds);

  const byCategory = new Map<string, number>();
  for (const item of (items ?? []) as { category_name: string | null; quantity: number }[]) {
    const cat = item.category_name ?? "ไม่มีหมวดหมู่";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + item.quantity);
  }

  return [...byCategory.entries()]
    .map(([category, qty]) => ({
      category,
      unit: classifyUnit(category === "ไม่มีหมวดหมู่" ? null : category),
      qty,
    }))
    .sort((a, b) => b.qty - a.qty);
}
```

- [ ] **Step 2: Add `classifyUnit`/`SoldUnit` to `dal.ts`'s exports (if not already exported by Task 4)**

Confirm Task 4's `classifyUnit` function and `SoldUnit` type both have the
`export` keyword — if Task 4 was implemented exactly as specified there, they
already do; this step is a check, not a new change.

- [ ] **Step 3: Create `src/components/dashboard/sales-quantity-summary.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CategoryQty } from "@/lib/dal";

export function SalesQuantitySummary({ rows }: { rows: CategoryQty[] }) {
  const totals = rows.reduce(
    (acc, r) => {
      if (r.unit === "แก้ว") acc.cups += r.qty;
      else if (r.unit === "ชิ้น") acc.pieces += r.qty;
      else acc.bottles += r.qty;
      return acc;
    },
    { cups: 0, pieces: 0, bottles: 0 }
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-sidebar">สรุปจำนวนขาย</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">ยังไม่มีข้อมูลการขาย</p>
        ) : (
          <>
            <div className="divide-y divide-border rounded-md border bg-white overflow-hidden">
              {rows.map((r) => (
                <div key={r.category} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm font-medium text-sidebar truncate">{r.category}</span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {r.qty} {r.unit}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-sm font-semibold text-sidebar tabular-nums">
              รวมวันนี้: {totals.cups} แก้ว, {totals.pieces} ชิ้น, {totals.bottles} ขวด
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dal.ts src/components/dashboard/sales-quantity-summary.tsx
git commit -m "feat(dashboard): add sales quantity summary card"
```

---

### Task 8: Per-menu profit table + "ดูทั้งหมด" modal (Part 2 only)

**Files:**
- Modify: `src/lib/dal.ts` (new `getMenuProfitBreakdown`)
- Create: `src/components/dashboard/menu-profit-table.tsx`

**Interfaces:**
- Produces: `getMenuProfitBreakdown(tenantId, startDate, endDate):
  Promise<MenuProfitRow[]>` where
  `MenuProfitRow = { productName: string; qty: number; unit: SoldUnit; revenue:
  number; cost: number; profit: number; gpPercent: number }`, sorted by `qty`
  descending (full list, not pre-limited — the component decides how many to
  show inline vs. in the modal).
- Consumes: `classifyUnit`/`SoldUnit` from Task 4.
- Produces: `MenuProfitTable({ rows: MenuProfitRow[] })` — renders the top 5
  inline; if `rows.length > 5`, shows a "ดูทั้งหมด" button opening a `Dialog`
  modal (same pattern as `src/components/job-level/job-level-picker.tsx`,
  including its `onClick={(e) => { if (e.target === e.currentTarget) ... }}`
  backdrop-dismiss fix) with the full scrollable list.

Must land after Task 4 (needs `classifyUnit`).

- [ ] **Step 1: Add `getMenuProfitBreakdown` to `src/lib/dal.ts`**

Add after `getSalesQuantitySummary` from Task 7:
```ts
// ─── Per-Menu Profit ─────────────────────────────────────────────────────────

export type MenuProfitRow = {
  productName: string;
  qty: number;
  unit: SoldUnit;
  revenue: number;
  cost: number;
  profit: number;
  gpPercent: number;
};

export async function getMenuProfitBreakdown(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string    // "YYYY-MM-DD" Bangkok (inclusive)
): Promise<MenuProfitRow[]> {
  const supabase = await createClient();
  const rangeStart = new Date(`${startDate}T00:00:00+07:00`);
  const rangeEnd = new Date(`${endDate}T00:00:00+07:00`);
  rangeEnd.setTime(rangeEnd.getTime() + 24 * 60 * 60 * 1000);

  const { data: orders } = await supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .neq("status", "refunded")
    .gte("created_at", rangeStart.toISOString())
    .lt("created_at", rangeEnd.toISOString());

  if (!orders || orders.length === 0) return [];

  const orderIds = (orders as { id: string }[]).map((o) => o.id);

  const { data: items } = await supabase
    .from("order_items")
    .select("product_id, product_name, category_name, quantity, subtotal")
    .in("order_id", orderIds);

  type ItemRow = {
    product_id: string | null;
    product_name: string;
    category_name: string | null;
    quantity: number;
    subtotal: number;
  };

  const byProduct = new Map<
    string,
    { productId: string | null; category_name: string | null; qty: number; revenue: number }
  >();
  for (const row of (items ?? []) as ItemRow[]) {
    const prev = byProduct.get(row.product_name) ?? {
      productId: row.product_id,
      category_name: row.category_name,
      qty: 0,
      revenue: 0,
    };
    byProduct.set(row.product_name, {
      productId: prev.productId ?? row.product_id,
      category_name: prev.category_name ?? row.category_name,
      qty: prev.qty + row.quantity,
      revenue: prev.revenue + Number(row.subtotal),
    });
  }

  const productIds = [...byProduct.values()]
    .map((v) => v.productId)
    .filter((id): id is string => id !== null);

  const { data: recipeRows } =
    productIds.length > 0
      ? await supabase
          .from("product_recipes")
          .select("product_id, quantity_used, raw_materials(cost_per_unit)")
          .in("product_id", productIds)
      : { data: [] as unknown[] };

  type RecipeRow = {
    product_id: string;
    quantity_used: number;
    raw_materials: { cost_per_unit: number } | null;
  };
  const unitCostByProductId = new Map<string, number>();
  for (const r of (recipeRows ?? []) as RecipeRow[]) {
    if (!r.raw_materials) continue;
    const lineCost = Number(r.quantity_used) * Number(r.raw_materials.cost_per_unit);
    unitCostByProductId.set(r.product_id, (unitCostByProductId.get(r.product_id) ?? 0) + lineCost);
  }

  return [...byProduct.entries()]
    .map(([productName, v]) => {
      const unitCost = v.productId ? unitCostByProductId.get(v.productId) ?? 0 : 0;
      const cost = unitCost * v.qty;
      const profit = v.revenue - cost;
      return {
        productName,
        qty: v.qty,
        unit: classifyUnit(v.category_name),
        revenue: v.revenue,
        cost,
        profit,
        gpPercent: v.revenue > 0 ? (profit / v.revenue) * 100 : 0,
      };
    })
    .sort((a, b) => b.qty - a.qty);
}
```

- [ ] **Step 2: Create `src/components/dashboard/menu-profit-table.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MenuProfitRow } from "@/lib/dal";

function ProfitTableRows({ rows }: { rows: MenuProfitRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground border-b">
          <th className="py-2 font-medium">เมนู</th>
          <th className="py-2 font-medium text-right">จำนวน</th>
          <th className="py-2 font-medium text-right">รายได้</th>
          <th className="py-2 font-medium text-right">ต้นทุน</th>
          <th className="py-2 font-medium text-right">กำไร</th>
          <th className="py-2 font-medium text-right">%กำไร</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r) => (
          <tr key={r.productName}>
            <td className="py-2 text-sidebar font-medium truncate max-w-[140px]">{r.productName}</td>
            <td className="py-2 text-right tabular-nums text-muted-foreground">
              {r.qty} {r.unit}
            </td>
            <td className="py-2 text-right tabular-nums text-sidebar">฿{r.revenue.toFixed(2)}</td>
            <td className="py-2 text-right tabular-nums text-muted-foreground">฿{r.cost.toFixed(2)}</td>
            <td
              className={`py-2 text-right tabular-nums font-semibold ${
                r.profit >= 0 ? "text-sidebar" : "text-destructive"
              }`}
            >
              ฿{r.profit.toFixed(2)}
            </td>
            <td className="py-2 text-right tabular-nums text-green-600 font-medium">
              {r.gpPercent.toFixed(1)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MenuProfitTable({ rows }: { rows: MenuProfitRow[] }) {
  const [open, setOpen] = useState(false);
  const top5 = rows.slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-sidebar">กำไรต่อเมนู</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">ยังไม่มีข้อมูลการขาย</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <ProfitTableRows rows={top5} />
            </div>
            {rows.length > 5 && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="mt-3 text-sm text-accent hover:underline"
              >
                ดูทั้งหมด ({rows.length} เมนู)
              </button>
            )}
          </>
        )}
      </CardContent>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/50 z-40" />
          <Dialog.Popup
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div className="w-full max-w-2xl max-h-[80vh] flex flex-col bg-white rounded-2xl shadow-xl">
              <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
                <Dialog.Title className="font-bold text-sidebar text-base">
                  กำไรต่อเมนู — ทั้งหมด ({rows.length} เมนู)
                </Dialog.Title>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="ปิด"
                  className="rounded-full p-1 text-muted-foreground hover:text-sidebar hover:bg-muted transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="overflow-y-auto overflow-x-auto px-5 py-4">
                <ProfitTableRows rows={rows} />
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </Card>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/dal.ts src/components/dashboard/menu-profit-table.tsx
git commit -m "feat(dashboard): add per-menu profit table with full-list modal"
```

---

### Task 9: Move Pricing Calculator to its own page

**Files:**
- Create: `src/app/(shell)/pricing-calculator/page.tsx`
- Modify: `src/components/shell/sidebar.tsx`

**Interfaces:**
- Consumes: `PricingCalculator` (unchanged, `src/components/dashboard/pricing-calculator.tsx`),
  `getProductsForCalculator`, `getTenantDeliveryGp` — both already exist in
  `dal.ts`, unchanged.

Independent of every other task; Task 10 depends on this one having already
removed `PricingCalculator`'s usage from `page.tsx` — do this task before Task 10.

- [ ] **Step 1: Create `src/app/(shell)/pricing-calculator/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { getProfile, getProductsForCalculator, getTenantDeliveryGp } from "@/lib/dal";
import { PricingCalculator } from "@/components/dashboard/pricing-calculator";

export default async function PricingCalculatorPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");

  const [calcProducts, defaultDeliveryGp] = await Promise.all([
    getProductsForCalculator(profile.tenant_id),
    getTenantDeliveryGp(profile.tenant_id),
  ]);

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">คำนวณราคาขาย</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          ตั้งราคาขายจากต้นทุนวัตถุดิบและ GP ที่ต้องการ
        </p>
      </div>
      <PricingCalculator products={calcProducts} defaultDeliveryGp={defaultDeliveryGp} />
    </div>
  );
}
```

- [ ] **Step 2: Add the nav entry in `src/components/shell/sidebar.tsx`**

Find:
```ts
import {
  LayoutDashboard,
  CreditCard,
  ShoppingBag,
  Package,
  Tag,
  FlaskConical,
  Sliders,
  Settings,
  Clock,
  Users,
  type LucideIcon,
} from "lucide-react";
```
Replace with:
```ts
import {
  LayoutDashboard,
  CreditCard,
  ShoppingBag,
  Package,
  Tag,
  FlaskConical,
  Sliders,
  Settings,
  Clock,
  Users,
  Calculator,
  type LucideIcon,
} from "lucide-react";
```

Find:
```ts
  { href: "/customers", label: "Customers", icon: Users, minRole: "manager" },
  { href: "/settings", label: "Settings", icon: Settings, minRole: "owner" },
```
Replace with:
```ts
  { href: "/customers", label: "Customers", icon: Users, minRole: "manager" },
  { href: "/pricing-calculator", label: "คำนวณราคาขาย", icon: Calculator, minRole: "manager" },
  { href: "/settings", label: "Settings", icon: Settings, minRole: "owner" },
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors (this task doesn't touch `page.tsx` yet — Task 10 removes
the calculator from there).

- [ ] **Step 4: Live-verify**

As a manager or owner QA account, confirm "คำนวณราคาขาย" appears in the sidebar,
navigating to it renders the calculator with the product dropdown populated, and
a staff-role QA account gets redirected away from `/pricing-calculator`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(shell)/pricing-calculator/page.tsx" src/components/shell/sidebar.tsx
git commit -m "feat: move Pricing Calculator to its own page"
```

---

### Task 10: Final integration — reassemble `src/app/(shell)/page.tsx`

**Files:**
- Modify: `src/app/(shell)/page.tsx` (full rewrite of the data-fetching and
  render sections)

**Interfaces:**
- Consumes every component and `dal.ts` function from Tasks 2-9. This task
  cannot start until all of Tasks 2, 3, 4, 5, 6, 7, 8, and 9 are complete and
  committed.

This is the task that actually assembles Part 1 and Part 2 into their final
approved order and removes the old `PricingCalculator` usage and old inline
best-sellers JSX from this file.

- [ ] **Step 1: Replace the full file**

```tsx
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  getProfile,
  getDashboardStats,
  getTopProducts,
  getLowStockAlerts,
  getSalesByHour,
  getSalesByDay,
  getSalesByMonth,
  getHourlyPattern,
  getSalesSummary,
  getSalesByCategory,
  getCostProfit,
  getPaymentMethodBreakdown,
  getSalesQuantitySummary,
  getMenuProfitBreakdown,
} from "@/lib/dal";
import { CostProfitCard } from "@/components/dashboard/cost-profit-card";
import { PaymentMethodCard } from "@/components/dashboard/payment-method-card";
import { SalesQuantitySummary } from "@/components/dashboard/sales-quantity-summary";
import { MenuProfitTable } from "@/components/dashboard/menu-profit-table";
import { BestSellersList } from "@/components/dashboard/best-sellers-list";
import { SalesTrendChart } from "@/components/dashboard/sales-trend-chart";
import { CategoryPerformanceChart } from "@/components/dashboard/category-performance-chart";
import { LowStockWidget } from "@/components/dashboard/low-stock-widget";
import { AnalyticsSection } from "@/components/dashboard/analytics-section";
import { MfaRecoveredToastTrigger } from "@/components/auth/mfa-recovered-toast-trigger";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function TrendBadgeInline({ current, previous }: { current: number; previous: number }) {
  if (current > previous)
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-green-600">
        <TrendingUp size={12} />
        ดีกว่าเมื่อวาน
      </span>
    );
  if (current < previous)
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-destructive">
        <TrendingDown size={12} />
        น้อยกว่าเมื่อวาน
      </span>
    );
  return (
    <span className="flex items-center gap-0.5 text-xs font-medium text-muted-foreground">
      <Minus size={12} />
      เท่าเมื่อวาน
    </span>
  );
}

function StatCards({
  todaySales,
  yesterdaySales,
  todayOrders,
  yesterdayOrders,
}: {
  todaySales: number;
  yesterdaySales: number;
  todayOrders: number;
  yesterdayOrders: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">ยอดขายวันนี้</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-2xl font-bold text-sidebar tabular-nums">฿{todaySales.toFixed(2)}</p>
          <TrendBadgeInline current={todaySales} previous={yesterdaySales} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">บิลวันนี้</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-2xl font-bold text-sidebar tabular-nums">{todayOrders}</p>
          <TrendBadgeInline current={todayOrders} previous={yesterdayOrders} />
        </CardContent>
      </Card>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; mfa_recovered?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const { range: rawRange, from: rawFrom, to: rawTo, mfa_recovered } = await searchParams;

  const canViewStats = profile.role === "owner" || profile.role === "manager";

  if (!canViewStats) {
    return (
      <div className="space-y-2">
        {mfa_recovered === "1" && <MfaRecoveredToastTrigger />}
        <h1 className="text-2xl font-bold text-sidebar">สวัสดี, {profile.full_name ?? "—"}</h1>
        <p className="text-sm text-muted-foreground">ยินดีต้อนรับสู่ KIDKUBPOS — เริ่มงานได้เลย!</p>
      </div>
    );
  }

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const hasValidCustomDates =
    typeof rawFrom === "string" &&
    typeof rawTo === "string" &&
    ISO_DATE.test(rawFrom) &&
    ISO_DATE.test(rawTo) &&
    rawFrom <= rawTo;
  const range: "week" | "month" | "year" | "custom" =
    rawRange === "month" || rawRange === "year"
      ? rawRange
      : rawRange === "custom" && hasValidCustomDates
        ? "custom"
        : "week";

  // Bangkok date strings ("YYYY-MM-DD")
  const offsetMs = 7 * 60 * 60 * 1000;
  const bangkokNow = new Date(new Date().getTime() + offsetMs);
  const todayStr = bangkokNow.toISOString().slice(0, 10);
  const bangkokYear = bangkokNow.getUTCFullYear();
  const bangkokMonth = bangkokNow.getUTCMonth() + 1;

  function daysAgoStr(n: number): string {
    return new Date(bangkokNow.getTime() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  const bangkokWeekday = bangkokNow.getUTCDay();
  const daysSinceMonday = bangkokWeekday === 0 ? 6 : bangkokWeekday - 1;
  const mondayOfThisWeekStr = daysAgoStr(daysSinceMonday);
  const firstOfThisMonthStr = `${bangkokYear}-${String(bangkokMonth).padStart(2, "0")}-01`;
  const yesterdayStr = daysAgoStr(1);

  const daysInMonthSoFar =
    Math.floor(
      (new Date(`${todayStr}T00:00:00+07:00`).getTime() -
        new Date(`${firstOfThisMonthStr}T00:00:00+07:00`).getTime()) /
        (24 * 60 * 60 * 1000)
    ) + 1;
  const daysInYearSoFar =
    Math.floor(
      (new Date(`${todayStr}T00:00:00+07:00`).getTime() -
        new Date(`${bangkokYear}-01-01T00:00:00+07:00`).getTime()) /
        (24 * 60 * 60 * 1000)
    ) + 1;
  const daysInCustomRange = (start: string, end: string) =>
    Math.floor(
      (new Date(`${end}T00:00:00+07:00`).getTime() - new Date(`${start}T00:00:00+07:00`).getTime()) /
        (24 * 60 * 60 * 1000)
    ) + 1;

  const startDate =
    range === "custom" && hasValidCustomDates
      ? (rawFrom as string)
      : range === "week"
        ? mondayOfThisWeekStr
        : range === "month"
          ? firstOfThisMonthStr
          : `${bangkokYear}-01-01`;
  const endDate = range === "custom" && hasValidCustomDates ? (rawTo as string) : todayStr;

  const daysInPeriod =
    range === "week"
      ? daysSinceMonday + 1
      : range === "month"
        ? daysInMonthSoFar
        : range === "custom" && hasValidCustomDates
          ? daysInCustomRange(startDate, endDate)
          : daysInYearSoFar;

  const [
    stats,
    todayTopProducts,
    lowStockAlerts,
    todayHourly,
    todayCategoryData,
    todayCostProfit,
    yesterdayCostProfit,
    paymentBreakdown,
    quantitySummary,
    summary,
    dailyData,
    monthlyData,
    peakHours,
    periodCategoryData,
    periodCostProfit,
    menuProfitRows,
    periodTopProducts,
  ] = await Promise.all([
    getDashboardStats(profile.tenant_id),
    getTopProducts(profile.tenant_id, todayStr, todayStr, 5),
    getLowStockAlerts(profile.tenant_id),
    getSalesByHour(profile.tenant_id, todayStr),
    getSalesByCategory(profile.tenant_id, todayStr, todayStr),
    getCostProfit(profile.tenant_id, todayStr, todayStr, 1),
    getCostProfit(profile.tenant_id, yesterdayStr, yesterdayStr, 1),
    getPaymentMethodBreakdown(profile.tenant_id, todayStr, todayStr),
    getSalesQuantitySummary(profile.tenant_id, todayStr, todayStr),
    getSalesSummary(profile.tenant_id, startDate, endDate),
    range === "week" || range === "month" || range === "custom"
      ? getSalesByDay(profile.tenant_id, startDate, endDate)
      : Promise.resolve(null),
    range === "year" ? getSalesByMonth(profile.tenant_id, bangkokYear) : Promise.resolve(null),
    getHourlyPattern(profile.tenant_id, startDate, endDate),
    getSalesByCategory(profile.tenant_id, startDate, endDate),
    getCostProfit(profile.tenant_id, startDate, endDate, daysInPeriod),
    getMenuProfitBreakdown(profile.tenant_id, startDate, endDate),
    getTopProducts(profile.tenant_id, startDate, endDate, 5),
  ]);

  return (
    <div className="space-y-6">
      {mfa_recovered === "1" && <MfaRecoveredToastTrigger />}
      <div>
        <h1 className="text-2xl font-bold text-sidebar">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">ภาพรวมของร้าน</p>
      </div>

      {/* ─── Part 1: วันนี้ ─────────────────────────────────────────────── */}

      <StatCards
        todaySales={stats.todaySales}
        yesterdaySales={stats.yesterdaySales}
        todayOrders={stats.todayOrders}
        yesterdayOrders={stats.yesterdayOrders}
      />

      <CostProfitCard current={todayCostProfit} previous={yesterdayCostProfit} />

      <PaymentMethodCard cash={paymentBreakdown.cash} transfer={paymentBreakdown.transfer} />

      <LowStockWidget alerts={lowStockAlerts} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-sidebar">แนวโน้มยอดขายวันนี้</CardTitle>
        </CardHeader>
        <CardContent>
          <SalesTrendChart range="day" data={todayHourly} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-sidebar">ยอดขายตามหมวดหมู่วันนี้</CardTitle>
        </CardHeader>
        <CardContent>
          <CategoryPerformanceChart data={todayCategoryData} />
        </CardContent>
      </Card>

      <SalesQuantitySummary rows={quantitySummary} />

      <div>
        <h2 className="text-base font-semibold text-sidebar mb-3">สินค้าขายดี TOP 5 วันนี้</h2>
        <BestSellersList products={todayTopProducts} />
      </div>

      {/* ─── Part 2: ช่วงเวลาที่เลือก ───────────────────────────────────── */}

      <Suspense fallback={null}>
        <AnalyticsSection
          range={range}
          summary={summary}
          dailyData={dailyData}
          monthlyData={monthlyData}
          peakHours={peakHours}
          categoryData={periodCategoryData}
        />
      </Suspense>

      <CostProfitCard current={periodCostProfit} />

      <MenuProfitTable rows={menuProfitRows} />

      <div>
        <h2 className="text-base font-semibold text-sidebar mb-3">สินค้าขายดี TOP 5</h2>
        <BestSellersList products={periodTopProducts} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in the project. This is the step where every
earlier task's "expected: errors confined to `page.tsx`" caveat finally
resolves — if any error remains, find which task's interface this file is
calling incorrectly and fix the call site here (not the earlier task's file,
unless the earlier task's export itself is wrong).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors (pre-existing `<img>` warnings in unrelated files are
fine).

- [ ] **Step 4: Live-verify — this is the big one, budget real time for it**

Using a disposable QA tenant seeded with: at least 2 categories with distinct
names (including at least one that wouldn't keyword-match "coffee"/"bakery", to
exercise the ขวด fallback), at least 6 distinct products sold (to exercise the
per-menu-profit modal's "ดูทั้งหมด" path), at least one product with NO recipe
rows (to exercise the missing-recipe warning caption), sales spanning today AND
yesterday (to exercise the today-vs-yesterday trend badges), and both cash and
transfer payment methods used:

1. Part 1 renders top-to-bottom in the approved order: stat cards → cost/profit
   (with badges, with the missing-recipe caption if applicable) → payment method
   (with correct %s) → low stock → today's trend chart → today's category pie
   (colors stable across a reload) → sales quantity summary (correct
   แก้ว/ชิ้น/ขวด buckets and totals) → today's top 5.
2. Part 2's tabs read รายสัปดาห์/รายเดือน/รายปี/กำหนดเอง (no "วันนี้" tab); switch
   to รายสัปดาห์ and confirm the date range starts on a real Monday; switch to
   รายเดือน and confirm it starts on the 1st of the current month; check the
   ปีนี้ year figure displays as a พ.ศ. year.
3. Part 2 renders: summary cards → cost/profit for the period (no trend badge) →
   per-menu profit table (top 5, sorted by quantity, no fixed-cost column) → click
   "ดูทั้งหมด" if more than 5 products sold, confirm the modal opens, scrolls, and
   both backdrop-click and the X button close it → trend chart → peak hours chart
   → category pie (same colors as Part 1's chart for the same category names) →
   top 5 for the period.
4. Confirm the Dashboard no longer shows the Pricing Calculator anywhere, and
   that `/pricing-calculator` (from Task 9) still works.

Delete all QA data afterward, confirm 0 remaining, exactly as this session's
established practice throughout.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(shell)/page.tsx"
git commit -m "feat(dashboard): assemble Part 1 (today) and Part 2 (period) sections"
```

---

## Verification checklist (run once, after Task 10, before considering this plan done)

- [ ] `npx tsc --noEmit` clean project-wide.
- [ ] `npm run lint` clean (only pre-existing unrelated warnings).
- [ ] Full live walkthrough per Task 10 Step 4, on a fresh disposable QA tenant,
  screenshots/notes kept for anything that looked visually off.
- [ ] Confirm no `"card"` string remains anywhere in `src/` related to payment
  method (a final `grep -rn '"card"'` across `src/` should show none of the
  8 Task-1 call sites left).
- [ ] Confirm `git log` shows one commit per task (10 commits, or 11 if Task 2's
  `page.tsx` portion was committed separately per its note) — no task's changes
  silently folded into another's commit.
