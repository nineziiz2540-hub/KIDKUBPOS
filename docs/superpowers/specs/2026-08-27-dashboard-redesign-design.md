# Dashboard Redesign (Part 1 + Part 2 + Pricing Calculator Relocation)

## Problem

The Dashboard page (`src/app/(shell)/page.tsx`) currently mixes "always today" stats
with a separate period-selectable analytics section, has no cost/profit visibility
at all, no payment-method breakdown, a category chart with randomly-cycled colors
that carry no meaning, a best-sellers list that's actually all-time (not scoped to
whatever period the page is showing), and a pricing tool embedded in the middle of
the page unrelated to "today's overview." The owner wants the page reorganized into
two clear parts — **Part 1**, an always-visible "today" section, and **Part 2**, a
period-selectable section (week/month/year/custom) below it — plus several new
widgets, and the pricing calculator moved to its own top-level page.

## Ground truth established during research (read this before implementing)

- **No historical cost snapshot exists anywhere in the schema.** `products` has no
  cost column; `order_items` has no cost column. The only cost source is
  `product_recipes` (quantity_used per raw material) × `raw_materials.cost_per_unit`
  — both of which reflect **today's** values. Any "cost"/"profit" figure computed
  for a past date is really "revenue from that date, re-priced at today's ingredient
  costs" — not the actual historical profit. **Accepted limitation, not fixed by
  this spec.**
- **A product with no recipe rows costs ฿0** in this model, inflating its apparent
  profit. Handled by a warning caption (see Part 1 §1), not by blocking anything.
- **`tenants.fixed_cost_monthly` is currently stored but never read anywhere in the
  codebase** — not even by the existing Pricing Calculator. This spec is what
  finally makes it meaningful.
- **The Pricing Calculator's existing formula does not use `fixed_cost_monthly` at
  all** (`src/components/dashboard/pricing-calculator.tsx`'s `compute()`): it only
  uses ingredient cost, packaging cost, waste %, target GP %, and delivery GP % to
  answer "what price should I charge." It is a **pricing** tool, not a **P&L** tool,
  and this spec does not change it — it only moves its location in the nav.
- **"Delivery" is not a real, trackable order attribute.** `orders.order_type` is
  only `"dine_in" | "take_away"` in the whole codebase — there is no delivery
  channel recorded per order. Delivery GP% stays a Pricing-Calculator-only, planning
  input; it has no bearing on any dashboard figure in this spec.
- **`orders.payment_method` currently allows `"cash" | "transfer" | "card"`**, but a
  live query against production confirmed **zero orders and zero refunds have ever
  used `"card"`** (6 total orders exist: 4 cash, 2 transfer). Removing `"card"`
  support is safe with no historical-data migration concern — see Prerequisite
  below.
- **`categories` is a fully tenant-defined, free-text table** — no fixed enum, no
  color column, no seed data. `order_items.category_name` is a denormalized
  snapshot of the category name at sale time (survives category renames). This
  spec's category-color design (§Part 1.6 / Part 2.6) is deliberately **not**
  hardcoded to any specific category names, for exactly this reason — see that
  section.
- **No unit (cup/piece/bottle) is modeled on `products`.** The "สรุปจำนวนขาย"
  widget (Part 1 §5) infers unit from category per the mapping agreed below.
- **`getTopProducts` in `dal.ts` has no date filter at all** — it is always
  all-time. This is a real bug relative to every place it's used going forward and
  is fixed as part of this spec (Part 1 §6 / Part 2 §7).
- **`getSalesByCategory`'s week/month branches compute their range as `now -
  7*24h` / `now - 30*24h` in raw UTC**, not Bangkok-midnight-aligned like every
  other stats function in `dal.ts` (`getDashboardStats`, `getSalesByDay`,
  `getSalesByMonth`, `getSalesSummary`, `getSalesByHour`, `getHourlyPattern` all use
  correct `+07:00` boundary math). This is a real, pre-existing bug, and fixing it
  is bundled into the Part 2 calendar-alignment work since it's the same class of
  fix.

## Prerequisite: remove "card" as a payment method, end to end

Confirmed zero historical usage (see above) — safe to remove outright, not
deprecate. Exact file list (all confirmed by direct code search, no others exist):

1. `src/types/app.ts` — narrow `PosOrderInput.paymentMethod` to `"cash" | "transfer"`.
2. `src/components/pos/pos-screen.tsx` — narrow the `paymentMethod` `useState` type.
3. `src/components/pos/smart-cart.tsx` — narrow `PaymentMethod` type; remove
   `"card"` from `PAYMENT_METHODS`, which removes the "บัตร" button from the POS
   checkout screen.
4. `src/components/orders/refund-order-button.tsx` — narrow `RefundMethod` type;
   remove the "บัตร" option from the refund-method selector.
5. `src/app/actions/orders.ts` (around line 321-327) — remove `refundMethod !==
   "card"` from the accepted-values whitelist check.
6. `src/components/orders/orders-filter.tsx` — narrow `FilterValue` type; remove the
   "บัตร" filter option from the Orders list filter UI.
7. `src/app/(shell)/orders/page.tsx` — narrow the duplicate `FilterValue` type
   (line 8) to match.
8. `src/lib/dal.ts` (around line 705, 753-755, 785) — remove `totalCard` from the
   shift-close reconciliation type/computation/return value; `src/components/shifts/shift-panel.tsx`
   (line 113) — remove the "บัตร: ฿X" display row from the shift-close summary.

No DB migration needed — `orders.payment_method`/`refund_method` are plain `text`
columns with no check constraint, so narrowing is purely an application-layer
change.

## Part 1: Today's overview (always visible, no date picker)

Final vertical order (existing widgets unless marked **NEW**):

1. ยอดขายวันนี้ / บิลวันนี้ — existing `StatCards`, unchanged.
2. **ต้นทุน/กำไรวันนี้ — NEW**
3. **วิธีชำระเงิน — NEW**
4. สต็อกวัตถุดิบ — existing `LowStockWidget`, unchanged, stays in this position.
5. กราฟแนวโน้มยอดขายวันนี้ — existing `SalesTrendChart`, reused pinned to today.
6. **กราฟวงกลมยอดขายตามหมวดหมู่ — upgraded** `CategoryPerformanceChart`.
7. **สรุปจำนวนขาย — NEW**
8. สินค้าขายดี TOP 5 วันนี้ — existing best-sellers list, **query fixed to scope
   to today** (currently all-time) and unit label fixed (currently hardcodes "ชิ้น"
   for every product).

### 1. ต้นทุน/กำไรวันนี้ (Cost & Profit card)

**Formula** (confirmed with the owner across several rounds — this is final):

```
ต้นทุนวันนี้ = COGS วันนี้ + (fixed_cost_monthly ÷ 30)
  where COGS วันนี้ = Σ over today's order_items (current recipe cost of that
  product × quantity sold), using product_recipes × raw_materials.cost_per_unit
  at TODAY's values (see "ground truth" above re: historical accuracy limitation)

กำไรวันนี้ = ยอดขายวันนี้ − ต้นทุนวันนี้
  (ยอดขายวันนี้ is the exact same number as StatCards' "ยอดขายวันนี้" — reuse
  getDashboardStats' revenue figure, don't recompute independently, so the two
  cards can never visually disagree)
```

- **Trend badges**: both ต้นทุน and กำไร get an up/down/flat badge vs. yesterday,
  matching `StatCards`' existing `TrendBadge` pattern exactly. Yesterday's figure
  uses the identical formula for yesterday's date (the fixed-cost-per-day term is
  the same constant for both days — no need to recompute it twice).
- **Missing-recipe warning**: if any product sold today (or yesterday, for the
  comparison) has zero rows in `product_recipes`, show this exact caption under
  the numbers: **"มีสินค้าที่ยังไม่ได้ตั้งต้นทุนบางรายการ ตัวเลขอาจไม่ครบถ้วน"**
  (`text-xs text-muted-foreground`, matching this project's existing caption
  styling convention).
- **Order inclusion**: same inclusion/exclusion rules as every other revenue
  figure already on this page (i.e., whatever `getDashboardStats` already excludes
  — cancelled/refunded — apply identically here; do not invent new rules).
- No new DB columns. New `dal.ts` function, e.g. `getTodayCostProfit(tenantId)`.

### 2. วิธีชำระเงิน (Payment Method card)

- Two columns only, post-prerequisite: **เงินสด** and **เงินโอน**.
- Each shows ฿ amount **and** % of today's total (e.g., "฿1,200 (60%)").
- **No trend badge** (explicitly decided against, to avoid an extra query for a
  metric that doesn't need day-over-day framing).
- New `dal.ts` function grouping today's non-cancelled orders by `payment_method`.

### 3. Sales trend chart

Reuses `SalesTrendChart` as-is (it already renders hourly buckets for a single
day). New instance, positioned per the order above; data pinned to today via
`getSalesByHour`.

### 4. Category pie chart — flexible, per-tenant color assignment (revised)

**This section supersedes an earlier draft of this spec that proposed hardcoding
5 specific colors to 5 specific English category names** (COFFEE/MATCHA/
NON-COFFEE/BAKERY/OTHER). That approach was rejected by the owner in favor of a
tenant-agnostic design, since `categories` is genuinely free-text per tenant (see
"ground truth" above) and the product is architected multi-tenant throughout.

**Final design:**
- `CategoryPerformanceChart` becomes a pie/donut chart showing each category's
  share of the selected period's sales as a percentage.
- Each category gets a **deterministic color derived from its `category id`**
  (a stable UUID that never changes for that category), indexing into a fixed
  palette of ~8-10 visually-distinct colors — e.g. `hashCode(categoryId) %
  PALETTE.length`. The same category therefore always renders the same color,
  every reload, in both Part 1 and Part 2 (so the same category matches visually
  across both), with **zero hardcoded category names anywhere in the code** and
  **zero DB migration** required.
- The "ไม่มีหมวดหมู่" (no category / null `category_name`) bucket gets a fixed,
  reserved neutral dark-gray color, **outside** the rotating palette — it isn't a
  real category, so it shouldn't visually compete with real ones or risk colliding
  with a palette color.
- Legend shows each category's actual name as stored by that tenant, verbatim —
  no translation or renaming required from the owner (the earlier ask to rename
  "กาแฟ" → "COFFEE" is **no longer needed** and is dropped from this spec).
- Same component, same color-assignment logic, used by both Part 1 (pinned to
  today) and Part 2 (selected period) — this is the shared-component design this
  whole spec was restructured around from the start.

### 5. สรุปจำนวนขาย (Sales Quantity Summary card) — NEW

Name confirmed with the owner: **"สรุปจำนวนขาย"**.

- **Unit inference**: since no unit field exists on `products`, unit is inferred
  from category, using the SAME 5-way classification the color chart used to use
  (this is the one place that classification still matters, now purely for unit
  inference, not color):
  - COFFEE / MATCHA / NON-COFFEE-type categories → นับเป็น **แก้ว**
  - BAKERY-type category → นับเป็น **ชิ้น**
  - Everything else (OTHER / uncategorized) → นับเป็น **ขวด**

  **Open implementation question carried into the plan**: since category-color
  assignment no longer does English-name matching, this unit-inference step still
  needs *some* way to know which of the tenant's real categories map to
  "drink"/"bakery"/"other" for unit purposes. The two live categories confirmed to
  exist today are `"Matcha"` and `"NON - COFFEE"` (clear drink matches by
  substring) and `"กาแฟ"` (Thai for coffee — not a drink-keyword string match).
  **Resolve this by keyword/substring matching on category name** (case-
  insensitive), against this exact keyword list:
  - **แก้ว** (drink) if the category name contains any of: `coffee`, `กาแฟ`,
    `matcha`, `มัทฉะ`, `tea`, `ชา`, `non-coffee`, `non coffee`, `noncoffee`
  - **ชิ้น** (piece) if it contains: `bakery`, `เบเกอรี่`, `ขนม`, `cake`, `เค้ก`
  - **ขวด** (bottle) — the fallback for anything matching neither list above
    (including a literal "OTHER" category, "ไม่มีหมวดหมู่", or any category name
    the implementer hasn't anticipated)

  This keyword list is a starting point, not exhaustive by design — the fallback
  bucket exists specifically so an unanticipated category name never crashes or
  blocks the widget, just defaults to ขวด. This is a smaller, more contained
  version of the naming-fragility problem the color chart also hit, solved the
  same defensive way.
- **Layout**: one row per category showing its count + unit (e.g., "COFFEE — 40
  แก้ว"), then a summary line at the bottom: total cups (all drink categories
  combined) + total bakery pieces + total other bottles, for today.
- New `dal.ts` function aggregating today's `order_items` by category with the
  unit-bucket classification applied.

### 6. สินค้าขายดี TOP 5 (Best Sellers, today)

- Reuses the existing inline best-sellers list (`src/app/(shell)/page.tsx` lines
  218-247) but **`getTopProducts` gains a required date-range parameter** (it
  currently has none, making it always all-time — a bug relative to this and every
  other use of it going forward).
- Unit label fixed to use the same category→unit inference as §5, instead of the
  current hardcoded "ชิ้น" suffix for every product regardless of type.

## Part 2: Period-selectable section (below Part 1)

### Calendar alignment (do this fix first, it's a prerequisite for everything else in Part 2)

- Period tabs become **รายสัปดาห์ / รายเดือน / รายปี / กำหนดเอง** — the current
  "วันนี้" tab is removed (Part 1 already covers "today" permanently, un-selectably,
  at the top of the page).
- **สัปดาห์** = Monday through Sunday of the current week (confirmed with the
  owner — not a rolling "last 7 days").
- **เดือน** = the full current calendar month (1st through last day), matching the
  same "full period" logic as week, not a rolling "last 30 days."
- **ปี** = the full current calendar year, Jan 1 – Dec 31 (Thai solar calendar
  boundaries match Gregorian ones), **displayed using the app's existing
  `toLocaleDateString("th-TH")` convention** (already used elsewhere in this
  codebase, e.g. `deactivated-members-section.tsx`), which renders the Buddhist
  Era year automatically — no manual +543 conversion needed anywhere.
- **กำหนดเอง** (custom) keeps the existing `DateRangePicker` UI unchanged.
- **Bug fix bundled into this work**: `getSalesByCategory`'s `week`/`month`
  branches currently compute their date boundary as raw `now - N*24h` in UTC
  (see "ground truth" above) instead of Bangkok-midnight-aligned like every other
  stats function. Fix this function (and audit any other range computation touched
  by this rework) to use the same Bangkok-midnight boundary math already
  established correctly elsewhere in `dal.ts` (`getSalesByDay`, `getSalesSummary`,
  etc.) — implementer should centralize this into one shared date-boundary helper
  rather than continuing to duplicate the offset math per-function, since that
  duplication is exactly what let this bug exist unnoticed.

### Part 2 widget list (below the period tabs)

1. ยอดขาย/บิลรวมของช่วงที่เลือก — existing `SummaryCards`, unchanged.
2. **ต้นทุน/กำไรของช่วงที่เลือก — NEW**, same formula as Part 1 §1, generalized:
   `ต้นทุนของช่วง = COGS ของช่วง + (fixed_cost_monthly ÷ 30) × จำนวนวันในช่วงที่เลือก`.
   No trend badge here (Part 2 doesn't have a natural "previous period" comparison
   requirement from the owner — not requested, not added).
3. **กำไรต่อเมนู TOP 5 — NEW** (see below for the full column spec).
4. กราฟแนวโน้มยอดขาย — existing `SalesTrendChart`, unchanged, stays.
5. กราฟแท่งช่วงเวลาขายดี — existing `PeakHoursChart`, unchanged, stays.
6. กราฟวงกลมยอดขายตามหมวดหมู่ — **same upgraded component as Part 1 §4**, reused
   with the selected period's data.
7. สินค้าขายดี TOP 5 — existing list, already range-aware via the same
   `getTopProducts` fix from Part 1 §6; gets the same unit-label fix.

### 3. กำไรต่อเมนู (Per-Menu Profit table) — NEW

**This section also went through revision — read carefully, the final formula is
simpler than an earlier draft.**

- Columns, exactly as specified by the owner:
  **เมนู | จำนวน (แก้ว/ชิ้น) | รายได้ | ต้นทุน | กำไร | %กำไร**
- **Formula — deliberately does NOT include any share of `fixed_cost_monthly`**:
  ```
  ต้นทุนของเมนูนี้ = ต้นทุนวัตถุดิบของเมนูนั้น (current recipe cost) × จำนวนที่ขายได้ในช่วงนี้
  กำไรของเมนูนี้ = รายได้ของเมนูนั้น − ต้นทุนของเมนูนี้
  %กำไร = กำไรของเมนูนี้ ÷ รายได้ของเมนูนั้น × 100
  ```
  Rationale (agreed with the owner after back-and-forth): fixed costs belong to
  the *shop*, not to individual menu items, and there is no single objectively
  "correct" way to allocate a shared cost like rent across different menu items —
  any allocation method (per-unit, per-revenue-share, etc.) is an arbitrary choice
  that adds complexity without a clear right answer. Per-menu profit here is
  **pure gross margin** (revenue − ingredient cost only). Whole-business net
  profit including fixed costs is already covered by Part 1 §1 / Part 2 §2 above
  — this table answers a different, narrower question ("which menu is more
  efficient to sell") on purpose.
- **Sort order**: by quantity sold, descending — same ranking basis as the
  existing best-sellers list, just with cost/profit columns added. (Matches the
  owner's own worked example, where a higher-quantity, lower-revenue item was
  listed above a lower-quantity, higher-revenue one.)
- **Top 5 shown inline**; if more than 5 products sold in the period, show a
  "ดูทั้งหมด" button (the owner's own description: "เหมือนหางปลาทู") that opens a
  `Dialog` modal (same `@base-ui/react/dialog` pattern already used elsewhere in
  this app — see `src/components/job-level/job-level-picker.tsx` for the most
  recent example, including its backdrop-dismiss fix) containing the full,
  scrollable list with the same 6 columns.
- Same missing-recipe caveat as Part 1 §1 applies per-row (a product with no
  recipe shows ต้นทุน as ฿0 — no special per-row warning specified by the owner;
  the whole-card caption from Part 1 §1 is judged sufficient, since this table sits
  right below/near that card on the same page).

## New page: "คำนวณราคาขาย" (Pricing Calculator relocation)

- Extract the existing `PricingCalculator` component (`src/components/dashboard/pricing-calculator.tsx`)
  unchanged — it is already fully self-contained (props: `products`,
  `defaultDeliveryGp`).
- New route: `src/app/(shell)/pricing-calculator/page.tsx` (or similar slug),
  server component fetching `getProductsForCalculator` + `getTenantDeliveryGp`
  (currently fetched inline in the dashboard's own `Promise.all`) and rendering
  `<PricingCalculator products={...} defaultDeliveryGp={...} />`.
- Remove the `<PricingCalculator>` block and its two data fetches entirely from
  `src/app/(shell)/page.tsx`.
- New sidebar nav entry, label **"คำนวณราคาขาย"**, added to `allNavItems` in
  `src/components/shell/sidebar.tsx`, matching the existing manager+ access level
  the calculator implicitly has today (it's currently only reachable via the
  Dashboard, which is itself gated to owner/manager). Not added to the mobile
  bottom nav (`bottom-nav.tsx`) — that's a fixed 4-slot bar and this doesn't
  displace an existing higher-priority item; reachable via the sidebar/full nav on
  mobile same as any other non-bottom-nav page.

## Explicitly out of scope for this spec

- Storing a historical cost snapshot per order/order-item (would require new DB
  columns and touch the checkout flow — a materially bigger change than "redesign
  the dashboard"; the current-cost-applied-retroactively limitation is accepted).
- Any fixed-cost allocation methodology for the per-menu profit table (deliberately
  rejected in favor of pure gross margin — see Part 2 §3).
- A `categories.color` column or any owner-facing color customization UI (the
  hash-of-id approach needs neither).
- Any "delivery" order channel or delivery-specific reporting (not a trackable
  order attribute in this codebase today).
- Mobile bottom-nav changes for the new Pricing Calculator page.
