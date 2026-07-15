# Pickers + Context Menu Code Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a custom date-range picker to the Dashboard's analytics filter, and a context menu (right-click/long-press) to the Inventory table's rows, alongside the existing visible `⋮` trigger pattern.

**Architecture:** `DateRangePicker` wraps `@base-ui/react/popover`. Context Menu extends `src/components/ui/menu.tsx` with `ContextMenu`/`ContextMenuTrigger` from `@base-ui/react/context-menu`, reusing every other export in that file unchanged.

**Tech Stack:** Next.js 16, `@base-ui/react` (`popover`, `context-menu` — both already installed), existing DAL functions, existing Server Actions.

## Global Constraints

- No new npm dependencies.
- No new Figma work this round (both pieces reuse visual patterns already built — popover chrome from Menu, and the context-menu popup literally reuses `MenuPopup`/`MenuItem`/`MenuLinkItem`/`MenuSeparator`).
- Native `<input type="date">` fields — no custom calendar-grid build.
- The Inventory row keeps its visible `⋮` `Menu` trigger — the context-menu (right-click/long-press) is additive, not a replacement.
- Never pass a function/closure as a prop from a Server Component into a `"use client"` component — an entire interactive row must be its own Client Component receiving only serializable props (same rule that produced `ProductRowMenu` last round; `MaterialRow` in this round follows the same shape from the start).
- No test framework exists. Verification per task: `npx tsc --noEmit` (must be clean), `npm run build` (must be clean), plus live-browser QA via the running `npm run dev` preview.

---

### Task 1: DateRangePicker component + Dashboard wiring

**Files:**
- Create: `src/components/ui/date-range-picker.tsx`
- Modify: `src/lib/dal.ts` (extend `getSalesByCategory`)
- Modify: `src/components/dashboard/sales-trend-chart.tsx`
- Modify: `src/components/dashboard/analytics-section.tsx`
- Modify: `src/app/(shell)/page.tsx`

**Interfaces:**
- Consumes: nothing from Task 2 (independent).
- Produces: `DateRangePicker({ active, label, onApply })` exported from `src/components/ui/date-range-picker.tsx`. `getSalesByCategory`'s new 3rd param `customRange?: { start: string; end: string }` — Task 2 does not consume this.

- [ ] **Step 1: Create `src/components/ui/date-range-picker.tsx`**

```tsx
"use client"

import { useState } from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function DateRangePicker({
  active,
  label,
  onApply,
}: {
  active: boolean
  label: string
  onApply: (from: string, to: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        className={cn(
          "px-3 py-1.5 text-sm rounded-md font-medium transition-colors",
          active
            ? "bg-white text-sidebar shadow-sm"
            : "text-muted-foreground hover:text-sidebar"
        )}
      >
        {label}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner sideOffset={8} align="start">
          <PopoverPrimitive.Popup className="w-64 rounded-lg bg-white p-4 shadow-lg outline-none space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                จากวันที่
              </label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                ถึงวันที่
              </label>
              <Input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <Button
              type="button"
              disabled={!from || !to}
              className="w-full bg-accent hover:bg-accent/90 text-white"
              onClick={() => {
                onApply(from, to)
                setOpen(false)
              }}
            >
              ใช้ช่วงเวลานี้
            </Button>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export { DateRangePicker }
```

- [ ] **Step 2: Run `npx tsc --noEmit` to confirm the new file compiles cleanly**

Expected: no errors referencing `date-range-picker.tsx`.

- [ ] **Step 3: Extend `getSalesByCategory` in `src/lib/dal.ts`**

Find the current function (starts at the line with `export async function getSalesByCategory(`):

```ts
export async function getSalesByCategory(
  tenantId: string,
  range: "day" | "week" | "month" | "year"
): Promise<{ category: string; total: number }[]> {
  const supabase = await createClient();
  const offsetMs = 7 * 60 * 60 * 1000;
  const now = new Date();
  const bangkokNow = new Date(now.getTime() + offsetMs);

  let rangeStart: Date;
  if (range === "day") {
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

  const { data: orders } = await supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .gte("created_at", rangeStart.toISOString());

  if (!orders || orders.length === 0) return [];
  /* ...rest of function unchanged below this point... */
```

Replace the signature and the `rangeStart` computation block with:

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
    .gte("created_at", rangeStart.toISOString());
  if (rangeEndExclusive) {
    query = query.lt("created_at", rangeEndExclusive.toISOString());
  }
  const { data: orders } = await query;

  if (!orders || orders.length === 0) return [];
  /* ...rest of function unchanged below this point... */
```

Do not touch anything below the `if (!orders || orders.length === 0) return [];` line — the `order_items` fetch and category grouping logic is unchanged.

- [ ] **Step 4: Run `npx tsc --noEmit` to confirm the DAL change compiles cleanly**

Expected: no errors in `dal.ts`. This will also surface the one call site in `page.tsx` if its call signature becomes incompatible (it won't, since the new param is optional) — confirm no new errors appear there either.

- [ ] **Step 5: Modify `src/components/dashboard/sales-trend-chart.tsx`**

Change the `Props` type from:
```ts
type Props =
  | { range: "day"; data: { hour: number; total: number }[] }
  | { range: "week" | "month"; data: SalesByDay[] }
  | { range: "year"; data: SalesByMonth[] };
```
to:
```ts
type Props =
  | { range: "day"; data: { hour: number; total: number }[] }
  | { range: "week" | "month" | "custom"; data: SalesByDay[] }
  | { range: "year"; data: SalesByMonth[] };
```

Change:
```ts
if (props.range === "week" || props.range === "month") {
```
to:
```ts
if (props.range === "week" || props.range === "month" || props.range === "custom") {
```

Inside that same block, change the `XAxis`'s `interval` prop from:
```tsx
interval={props.range === "month" ? 4 : 0}
```
to:
```tsx
interval={chartData.length > 10 ? Math.ceil(chartData.length / 8) : 0}
```

- [ ] **Step 6: Modify `src/components/dashboard/analytics-section.tsx`**

Add the import:
```tsx
import { DateRangePicker } from "@/components/ui/date-range-picker";
```

Change the `Range` type from:
```ts
type Range = "day" | "week" | "month" | "year";
```
to:
```ts
type Range = "day" | "week" | "month" | "year" | "custom";
```

Add a helper function near the top of the file (after `RANGE_TABS`):
```tsx
function formatShortDate(dateStr: string): string {
  const parts = dateStr.split("-");
  return `${Number(parts[2] ?? "0")}/${Number(parts[1] ?? "0")}`;
}
```

Inside `AnalyticsSection`, right after the existing `setRange` function, add:
```tsx
  function setCustomRange(from: string, to: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", "custom");
    params.set("from", from);
    params.set("to", to);
    router.replace(`?${params.toString()}`);
  }

  const customFrom = searchParams.get("from");
  const customTo = searchParams.get("to");
  const customLabel =
    range === "custom" && customFrom && customTo
      ? `${formatShortDate(customFrom)} - ${formatShortDate(customTo)}`
      : "กำหนดเอง";
```

Inside the tabs row, right after the closing `))}` of the `RANGE_TABS.map(...)` call and before the row's closing `</div>`, add:
```tsx
        <DateRangePicker
          active={range === "custom"}
          label={customLabel}
          onApply={setCustomRange}
        />
```

Change the chart section's condition from:
```tsx
{(range === "week" || range === "month") && dailyData !== null && (
  <SalesTrendChart range={range} data={dailyData} />
)}
```
to:
```tsx
{(range === "week" || range === "month" || range === "custom") && dailyData !== null && (
  <SalesTrendChart range={range} data={dailyData} />
)}
```

- [ ] **Step 7: Modify `src/app/(shell)/page.tsx`**

Change the `searchParams` type in the function signature from:
```ts
searchParams: Promise<{ range?: string }>;
```
to:
```ts
searchParams: Promise<{ range?: string; from?: string; to?: string }>;
```

Change:
```ts
  const { range: rawRange } = await searchParams;
  const range: "day" | "week" | "month" | "year" =
    rawRange === "week" || rawRange === "month" || rawRange === "year"
      ? rawRange
      : "day";
```
to:
```ts
  const { range: rawRange, from: rawFrom, to: rawTo } = await searchParams;
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const hasValidCustomDates =
    typeof rawFrom === "string" &&
    typeof rawTo === "string" &&
    ISO_DATE.test(rawFrom) &&
    ISO_DATE.test(rawTo) &&
    rawFrom <= rawTo;
  const range: "day" | "week" | "month" | "year" | "custom" =
    rawRange === "week" || rawRange === "month" || rawRange === "year"
      ? rawRange
      : rawRange === "custom" && hasValidCustomDates
        ? "custom"
        : "day";
```

Change:
```ts
  const startDate =
    range === "week"
      ? daysAgoStr(6)
      : range === "month"
      ? daysAgoStr(29)
      : range === "year"
      ? `${bangkokYear}-01-01`
      : todayStr;
  const endDate = todayStr;
```
to:
```ts
  const startDate =
    range === "custom" && hasValidCustomDates
      ? (rawFrom as string)
      : range === "week"
      ? daysAgoStr(6)
      : range === "month"
      ? daysAgoStr(29)
      : range === "year"
      ? `${bangkokYear}-01-01`
      : todayStr;
  const endDate = range === "custom" && hasValidCustomDates ? (rawTo as string) : todayStr;
```

In the `Promise.all([...])` array, change:
```ts
    range === "week" || range === "month"
      ? getSalesByDay(profile.tenant_id, startDate, endDate)
      : Promise.resolve(null),
```
to:
```ts
    range === "week" || range === "month" || range === "custom"
      ? getSalesByDay(profile.tenant_id, startDate, endDate)
      : Promise.resolve(null),
```

and change:
```ts
    getSalesByCategory(profile.tenant_id, range),
```
to:
```ts
    getSalesByCategory(
      profile.tenant_id,
      range,
      range === "custom" ? { start: startDate, end: endDate } : undefined
    ),
```

Leave the `getHourlyPattern` line (`range !== "day" ? getHourlyPattern(...) : Promise.resolve(null)`) unchanged — `"custom"` already satisfies `range !== "day"` with no edit needed.

Leave `src/components/dashboard/summary-cards.tsx` untouched — its `range` prop is already plain `string` typed and its label lookup already falls back to `"ช่วงนี้"` for unrecognized keys.

- [ ] **Step 8: Run `npx tsc --noEmit` and `npm run build` to confirm all Task 1 changes compile and build cleanly**

Expected: both clean. Pay attention to any type-narrowing error in `analytics-section.tsx`'s chart-rendering JSX (the `range` variable must be correctly narrowed to `"week" | "month" | "custom"` inside that conditional block to satisfy `SalesTrendChart`'s updated prop union) — if TypeScript complains here, the condition and the prop-passing must use the exact same narrowed `range` variable, not a re-derived one.

- [ ] **Step 9: Live-verify in the browser (dev server already running)**

Navigate to `/` (Dashboard). Click through the existing day/week/month/year presets first to confirm no regression. Then open the new "กำหนดเอง" popover trigger, pick a "จากวันที่"/"ถึงวันที่" pair, click "ใช้ช่วงเวลานี้" — confirm: the popover closes, the URL updates to include `range=custom&from=...&to=...`, the trigger pill now shows the picked dates (e.g. "1/7 - 15/7") instead of "กำหนดเอง", the sales trend chart updates to the custom range, and the category-performance chart also reflects the custom range (not stale data from whatever preset was active before).

- [ ] **Step 10: Commit**

```bash
git add src/components/ui/date-range-picker.tsx src/lib/dal.ts src/components/dashboard/sales-trend-chart.tsx src/components/dashboard/analytics-section.tsx src/app/\(shell\)/page.tsx
git commit -m "feat(design-system): add DateRangePicker component, wire into Dashboard analytics filter"
```

---

### Task 2: Context Menu + MaterialRow + Inventory wiring

**Files:**
- Modify: `src/components/ui/menu.tsx`
- Create: `src/components/inventory/material-row.tsx`
- Modify: `src/app/(shell)/inventory/page.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 (independent).
- Produces: `ContextMenu`, `ContextMenuTrigger` exported from `src/components/ui/menu.tsx`, alongside the file's existing `Menu`/`MenuTrigger`/`MenuPopup`/`MenuItem`/`MenuLinkItem`/`MenuSeparator` exports (all unchanged).

- [ ] **Step 1: Modify `src/components/ui/menu.tsx`**

Add the import, alongside the existing `import { Menu as MenuPrimitive } from "@base-ui/react/menu"`:
```tsx
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"
```

Add, near the other `const Menu = ...` / `const MenuTrigger = ...` lines:
```tsx
const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger
```

Change the final `export { ... }` line from:
```tsx
export { Menu, MenuTrigger, MenuPopup, MenuItem, MenuLinkItem, MenuSeparator }
```
to:
```tsx
export { Menu, MenuTrigger, MenuPopup, MenuItem, MenuLinkItem, MenuSeparator, ContextMenu, ContextMenuTrigger }
```

Do not change `MenuPopup`, `MenuItem`, `MenuLinkItem`, or `MenuSeparator` at all — they work unmodified as children of `ContextMenu` too (Base UI's `context-menu` module re-exports the same underlying `Popup`/`Item`/`Portal`/`Positioner` implementations as the regular `menu` module).

- [ ] **Step 2: Run `npx tsc --noEmit` to confirm the change compiles cleanly**

Expected: no errors referencing `menu.tsx`.

- [ ] **Step 3: Create `src/components/inventory/material-row.tsx`**

```tsx
"use client";

import { useRef } from "react";
import {
  MoreVertical,
  PackagePlus,
  SlidersHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  Menu,
  MenuTrigger,
  MenuPopup,
  MenuItem,
  MenuLinkItem,
  MenuSeparator,
  ContextMenu,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { Badge } from "@/components/ui/badge";
import { deleteRawMaterial } from "@/app/actions/inventory";

export function MaterialRow({
  id,
  name,
  unit,
  costPerUnit,
  currentStock,
  minStockAlert,
  isLow,
}: {
  id: string;
  name: string;
  unit: string;
  costPerUnit: number;
  currentStock: number;
  minStockAlert: number;
  isLow: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  function handleDelete() {
    if (confirm(`ลบ "${name}"?`)) {
      formRef.current?.requestSubmit();
    }
  }

  const menuItems = (
    <>
      <MenuLinkItem href={`/inventory?action=receive&id=${id}`}>
        <PackagePlus size={14} /> รับสินค้า
      </MenuLinkItem>
      <MenuLinkItem href={`/inventory?action=adjust&id=${id}`}>
        <SlidersHorizontal size={14} /> ปรับ
      </MenuLinkItem>
      <MenuLinkItem href={`/inventory?action=edit&id=${id}`}>
        <Pencil size={14} /> แก้ไข
      </MenuLinkItem>
      <MenuSeparator />
      <MenuItem destructive onClick={handleDelete}>
        <Trash2 size={14} /> ลบ
      </MenuItem>
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <tr
            data-search-value={name}
            className="border-b last:border-0 hover:bg-muted/10"
          />
        }
      >
        <td className="px-4 py-3 font-medium">
          {name}
          {isLow && (
            <Badge variant="destructive" className="ml-2 text-xs">
              สต็อกต่ำ
            </Badge>
          )}
        </td>
        <td className="px-4 py-3 text-muted-foreground">{unit}</td>
        <td className="px-4 py-3 text-right">{costPerUnit.toFixed(4)}</td>
        <td className="px-4 py-3 text-right font-semibold">
          {currentStock.toFixed(3)}
        </td>
        <td className="px-4 py-3 text-right text-muted-foreground">
          {minStockAlert.toFixed(3)}
        </td>
        <td className="px-4 py-3 text-right">
          <Menu>
            <MenuTrigger
              aria-label={`ตัวเลือกสำหรับ ${name}`}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted/20"
            >
              <MoreVertical size={16} />
            </MenuTrigger>
            <MenuPopup>{menuItems}</MenuPopup>
          </Menu>
        </td>
      </ContextMenuTrigger>
      <MenuPopup>{menuItems}</MenuPopup>
      <form ref={formRef} action={deleteRawMaterial} className="hidden">
        <input type="hidden" name="id" value={id} />
      </form>
    </ContextMenu>
  );
}
```

- [ ] **Step 4: Run `npx tsc --noEmit` to confirm the new file compiles cleanly**

Expected: no errors referencing `material-row.tsx`.

- [ ] **Step 5: Wire into `src/app/(shell)/inventory/page.tsx`**

Add the import:
```tsx
import { MaterialRow } from "@/components/inventory/material-row";
```

Remove this now-unused import (the delete action and its confirm-dialog trigger both move entirely into `MaterialRow`):
```tsx
import { DeleteButton } from "@/components/ui/delete-button";
```

Also remove `deleteRawMaterial` from the `@/app/actions/inventory` import list at the top of the file — confirmed its only use in this file is the row's delete form, which is being removed. Keep `createRawMaterial`, `updateRawMaterial`, `receiveStock`, `adjustStock` in that same import line unchanged (all still used by the create/edit/stock-action forms elsewhere on this same page).

Replace the current per-row block:
```tsx
                  return (
                    <tr key={m.id} data-search-value={m.name} className="border-b last:border-0 hover:bg-muted/10">
                      <td className="px-4 py-3 font-medium">
                        {m.name}
                        {isLow && (
                          <Badge variant="destructive" className="ml-2 text-xs">
                            สต็อกต่ำ
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{m.unit}</td>
                      <td className="px-4 py-3 text-right">{Number(m.cost_per_unit).toFixed(4)}</td>
                      <td className="px-4 py-3 text-right font-semibold">{Number(m.current_stock).toFixed(3)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{Number(m.min_stock_alert).toFixed(3)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/inventory?action=receive&id=${m.id}`}
                            className="rounded px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10"
                          >
                            รับสินค้า
                          </Link>
                          <Link
                            href={`/inventory?action=adjust&id=${m.id}`}
                            className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/20"
                          >
                            ปรับ
                          </Link>
                          <Link
                            href={`/inventory?action=edit&id=${m.id}`}
                            className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/20"
                          >
                            แก้ไข
                          </Link>
                          <form action={deleteRawMaterial}>
                            <input type="hidden" name="id" value={m.id} />
                            <DeleteButton message={`ลบ "${m.name}"?`} />
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
```
with:
```tsx
                  return (
                    <MaterialRow
                      key={m.id}
                      id={m.id}
                      name={m.name}
                      unit={m.unit}
                      costPerUnit={Number(m.cost_per_unit)}
                      currentStock={Number(m.current_stock)}
                      minStockAlert={Number(m.min_stock_alert)}
                      isLow={isLow}
                    />
                  );
```

Leave the `isLow` computation (the `const isLow = ...` lines directly above the `return`) exactly as-is — it's still computed server-side and now passed down as a plain boolean prop instead of being used inline in server-rendered JSX.

- [ ] **Step 6: Run `npx tsc --noEmit` again to confirm the wiring compiles cleanly**

Expected: no errors, and specifically no "declared but never used" error for any import in `inventory/page.tsx` (confirms `DeleteButton` and any now-unused action import were fully removed).

- [ ] **Step 7: Run `npm run build` for a full production-build check**

Expected: clean build. This is the check most likely to surface an invalid-HTML table-nesting mistake in `MaterialRow` (an errant wrapping `<div>` instead of `ContextMenuTrigger` correctly becoming the `<tr>` itself) as a hydration-mismatch-shaped warning or error — investigate immediately if anything unusual appears here, don't wave it off as unrelated noise.

- [ ] **Step 8: Live-verify in the browser (dev server already running)**

Navigate to `/inventory`. Confirm the table still renders correctly (rows are real `<tr>` elements inside `<tbody>`, not visually broken or duplicated). Click the `⋮` trigger on a row — confirm all 4 items appear and work exactly as before (รับสินค้า/ปรับ/แก้ไข navigate correctly; ลบ still shows the same `confirm()` and deletes on confirm). Then right-click anywhere else on the same row (not on the `⋮` button) — confirm the identical 4-item menu opens via the context-menu path. This second check is the highest-risk part of this whole round and must not be skipped or assumed to work from the code alone.

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/menu.tsx src/components/inventory/material-row.tsx src/app/\(shell\)/inventory/page.tsx
git commit -m "feat(design-system): add ContextMenu, wire into Inventory rows alongside existing Menu trigger"
```

---

## Explicitly Out of Scope (this round)

- Orders page date filtering.
- A full custom calendar-grid picker.
- Products table getting a `ContextMenu` (only Inventory this round).
- Widgets, Page controls, Toolbars (all deferred/skipped per user decision).
