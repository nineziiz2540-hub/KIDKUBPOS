# KIDKUBPOS — Pickers + Context Menu Code Translation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into a task-by-task implementation plan, then superpowers:subagent-driven-development or superpowers:executing-plans to execute it.

**Goal:** Implement the last 2 of the 7 originally-scoped iOS/iPadOS 26 categories the user chose to pursue (of the 7: Buttons and Tab bar/Toggle/Text Field were done earlier; Menu/Notifications were done in the prior round; the user explicitly decided to skip Widgets and Page controls as poor fits for a web POS app) — a custom date-range picker for the Dashboard, and a context menu (right-click/long-press) for the Inventory table.

**No new Figma components this round.** Both pieces reuse visual patterns already established in Figma: the date-range picker is a popover using the existing `Input`/`Button` styling (no new visual language beyond the popover chrome already built for Menu), and the context menu's popup is *visually identical* to the Menu component already built (same `MenuPopup`/`MenuItem`/`MenuLinkItem`/`MenuSeparator` — Base UI's context-menu module literally re-exports the regular menu module's Popup/Item parts, confirmed by inspecting `node_modules/@base-ui/react/context-menu/index.parts.d.ts`). Building duplicate Figma mockups for either would be pure busywork.

**Architecture:** `DateRangePicker` wraps `@base-ui/react/popover` (confirmed installed, not previously used in this codebase). Context Menu extends the existing `src/components/ui/menu.tsx` with 2 more exports (`ContextMenu`, `ContextMenuTrigger`) from `@base-ui/react/context-menu`, reusing every other export already in that file.

**Tech Stack:** Next.js 16, `@base-ui/react` (`popover`, `context-menu` sub-packages — both already installed, no new dependencies), existing DAL functions in `src/lib/dal.ts`, existing Server Actions.

## Global Constraints

- No new npm dependencies.
- No new Figma work (see above).
- Native `<input type="date">` for the date fields — no custom calendar-grid build (Approach C, chosen explicitly over a full custom calendar for effort/risk reasons).
- The date-range picker only wires into the Dashboard's analytics filter — Orders' filter (payment method/status only, no date filter today) is explicitly out of scope.
- The Inventory row keeps a **visible** `⋮` trigger (same `Menu`/`MenuTrigger` pattern as Products) as the primary, discoverable entry point — the context-menu (right-click/long-press) is an **additional** power-user path to the identical 4-item list, not a replacement for visible discoverability.
- Do not invent new backend capability — every action surfaced by either component must already exist (`getSalesByDay`/`getSalesSummary`/`getHourlyPattern` already accept arbitrary date ranges; `getSalesByCategory` needs a minimal, backward-compatible extension to accept an explicit range the same way its siblings already do — this is completing an inconsistency between DAL functions, not adding a new feature).
- Same lessons from the prior 2 rounds apply here, explicitly: (1) never pass a function/closure as a prop from a Server Component into a `"use client"` component — if a row needs interactive JSX (a `ContextMenuTrigger`, an `onClick`), the **entire interactive row** must be extracted into its own Client Component receiving only serializable props, exactly like `ProductRowMenu` was in the prior round; (2) if any hook returns an object backed by shared/external store state (as `@base-ui/react`'s various `useXManager`-style hooks do), never put that raw object in a `useEffect` dependency array — capture it in a ref and depend only on the real trigger value. Neither hook lesson is expected to recur in this round's code (no `useEffect` + shared-store hook combination is used here), but is restated because it's now a demonstrated recurring risk class in this codebase.

## Components

### 1. Pickers — `DateRangePicker` + Dashboard wiring

**New file: `src/components/ui/date-range-picker.tsx`**

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

Notes:
- `open`/`onOpenChange` controlled state (confirmed real props on `PopoverRoot` via its type defs) so the popover closes itself right after `onApply` fires — no need for `Popover.Close`.
- `min={from || undefined}` on the "ถึงวันที่" input is a native HTML date-input constraint preventing an end date before the start date — free correctness from the platform, not custom logic.
- Reuses the existing `Input`/`Button` components as-is (`Input` already passes through arbitrary `type` — confirmed in `src/components/ui/input.tsx`).

**Modify `src/lib/dal.ts` — extend `getSalesByCategory`** (currently only accepts the 4 preset literals and computes its own `rangeStart` internally — every sibling analytics function already accepts explicit date strings; this closes that inconsistency):

Current signature (line 411-465):
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
  ...
```

New signature — adds an optional 3rd param, backward-compatible (every existing caller passing just `tenantId, range` is unaffected):

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
  ...
```

(The rest of the function body — fetching `order_items`, grouping by category — is unchanged.)

**Modify `src/components/dashboard/sales-trend-chart.tsx`:**

Extend the discriminated union type (line 21-24) from:
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

Change the branch condition (line 63) from:
```ts
if (props.range === "week" || props.range === "month") {
```
to:
```ts
if (props.range === "week" || props.range === "month" || props.range === "custom") {
```

Change the `XAxis`'s `interval` prop (line 75) from a hardcoded range-name check to a data-length-driven computation, since a custom range can be any length (unlike the fixed 7-day/30-day presets):
```tsx
// before:
interval={props.range === "month" ? 4 : 0}
// after:
interval={chartData.length > 10 ? Math.ceil(chartData.length / 8) : 0}
```

**Modify `src/components/dashboard/analytics-section.tsx`:**

Change the `Range` type (line 16) from:
```ts
type Range = "day" | "week" | "month" | "year";
```
to:
```ts
type Range = "day" | "week" | "month" | "year" | "custom";
```

Add a helper (near the top, alongside `RANGE_TABS`) and the custom-range setter + label computation inside the component body:

```tsx
import { DateRangePicker } from "@/components/ui/date-range-picker";

function formatShortDate(dateStr: string): string {
  const parts = dateStr.split("-");
  return `${Number(parts[2] ?? "0")}/${Number(parts[1] ?? "0")}`;
}
```

Inside `AnalyticsSection`, alongside the existing `setRange` function:

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

Add the picker as a 5th item in the existing tabs row (line 56-71), right after the `.map`:

```tsx
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        {RANGE_TABS.map(({ value, label }) => (
          /* ...unchanged... */
        ))}
        <DateRangePicker
          active={range === "custom"}
          label={customLabel}
          onApply={setCustomRange}
        />
      </div>
```

Change the chart-rendering condition (line 87-89) from:
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

(`range` here is already narrowed to `"week" | "month" | "custom"` by the surrounding condition, so this type-checks directly against `SalesTrendChart`'s updated union — no cast needed.)

**Modify `src/app/(shell)/page.tsx`:**

Change the `searchParams` type (line 89) from:
```ts
searchParams: Promise<{ range?: string }>;
```
to:
```ts
searchParams: Promise<{ range?: string; from?: string; to?: string }>;
```

Change the range parsing (line 109-113) from:
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

(`ISO_DATE` guards against a manually-edited URL passing garbage into `new Date(...)` inside the DAL functions — the date inputs themselves always emit `YYYY-MM-DD` since that's the native `<input type="date">` format, so this only matters for defensive handling of a hand-edited URL. `rawFrom <= rawTo` is a valid string comparison for same-length zero-padded ISO date strings.)

Change the `startDate`/`endDate` computation (line 127-135) from:
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

Change the parallel-fetch conditions (line 154-166) — `dailyData` and `getSalesByCategory`:
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

and:
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

(`getHourlyPattern`'s existing condition, `range !== "day"`, already covers `"custom"` correctly with no change needed — `"custom"` is never `"day"`.)

No changes needed to `src/components/dashboard/summary-cards.tsx` — its `range` prop is already typed as plain `string` and its label lookup already falls back to a generic `"ช่วงนี้"` for any unrecognized key, which `"custom"` will hit automatically.

### 2. Context Menu — Inventory row

**Modify `src/components/ui/menu.tsx`** — add 2 more exports, reusing the file's existing `MenuPopup`/`MenuItem`/`MenuLinkItem`/`MenuSeparator` (Base UI's context-menu module re-exports the same underlying Popup/Item/Portal/Positioner as regular menu — confirmed via `node_modules/@base-ui/react/context-menu/index.parts.d.ts`, so the existing `MenuPopup` wrapper works unmodified as a `ContextMenu` child too):

```tsx
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"
// (add alongside the existing `import { Menu as MenuPrimitive } from "@base-ui/react/menu"`)

const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger

export { Menu, MenuTrigger, MenuPopup, MenuItem, MenuLinkItem, MenuSeparator, ContextMenu, ContextMenuTrigger }
```

**New file: `src/components/inventory/material-row.tsx`** — the *entire* table row becomes a Client Component (not just the actions cell), because `ContextMenuTrigger` must wrap the whole `<tr>` for "right-click/long-press anywhere on the row" to work, and per this project's now-twice-demonstrated RSC rule, a Server Component cannot pass an interactive Client element's props except as serializable data — so the row's data (not a function) is what crosses the boundary:

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

Notes:
- `render={<tr ... />}` on `ContextMenuTrigger` makes the component *become* the actual `<tr>` element (Base UI's standard polymorphic-rendering pattern, confirmed present on `ContextMenuTrigger` via its `BaseUIComponentProps` type, which includes `render?: React.ReactElement | ...`) rather than wrapping it in an extra `<div>` — critical, because a `<div>` between `<tbody>` and `<tr>` is invalid HTML and browsers silently hoist it out of the table, breaking the row entirely. This is the single highest-risk mechanical detail in this round and **must be verified live in the browser** (right-click on a row, on both desktop-style right-click and via `dispatchEvent(new MouseEvent('contextmenu'))` if a real long-press can't be simulated) — the previous 2 rounds each shipped a bug that only live testing caught, so this piece gets the same scrutiny before being considered done.
- `menuItems` is defined once and rendered into **two** separate `<MenuPopup>` instances (one inside the visible `⋮` `Menu`, one as a sibling for the `ContextMenu`) — this is intentional duplication of the *rendered output*, not the source (the JSX variable itself isn't duplicated), and is required because `Menu` and `ContextMenu` are two independent Roots that cannot share one Popup instance between them.
- `costPerUnit`/`currentStock`/`minStockAlert` are typed as plain `number` here — the Server Component in `inventory/page.tsx` does the existing `Number(m.cost_per_unit)` etc. conversion (unchanged from today) before passing props, so this component never has to worry about the Supabase numeric-as-string quirk.

**Modify `src/app/(shell)/inventory/page.tsx`:**

Add the import:
```tsx
import { MaterialRow } from "@/components/inventory/material-row";
```

Remove the now-unused imports (`DeleteButton` — the delete action moves entirely into `MaterialRow`):
```tsx
import { DeleteButton } from "@/components/ui/delete-button";
```

Replace the `<tr>` block (current lines 123-163, the whole per-material row) with:
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

(The `isLow` computation just above the current `<tr>` — lines 119-121 — is unchanged, still computed in the Server Component and passed down as a plain boolean.)

`deleteRawMaterial` is no longer imported directly in `page.tsx` either (it moves into `material-row.tsx`) — check the current import list at the top of the file and remove it from there if it's not used elsewhere on the page (it is currently only used in the row's delete form, so it should be fully removed from `page.tsx`'s imports).

## Explicitly Out of Scope (this round)

- Orders page date filtering — no date filter exists there today; adding one would be a new feature, not a translation of existing capability.
- A full custom calendar-grid picker (Approach A from the design discussion) — explicitly rejected in favor of the popover + native date inputs (Approach C).
- Products table getting a `ContextMenu` in addition to its existing `Menu` — only Inventory gets the dual-trigger treatment this round.
- The remaining Figma/iOS categories the user chose to skip entirely: Widgets, Page controls, Toolbars (Toolbars was discussed and deferred pending an eventual multi-select/bulk-actions feature that doesn't exist yet).

## Testing

No test framework exists in this project. Verification per task:
- `npx tsc --noEmit` — must be clean.
- `npm run build` — must be clean (this is the check that would have caught an invalid-HTML table-nesting mistake at the RSC/render level, similar to how it caught the RSC boundary issue last round — though actual browser rendering is still the real proof for the `render`-prop-as-`<tr>` mechanic).
- Live-browser QA via the running `npm run dev` preview:
  - Dashboard: click each preset (day/week/month/year), then open the custom-range popover, pick a from/to date, apply — confirm the chart updates, the trigger pill shows the picked range instead of "กำหนดเอง", and the category-breakdown chart reflects the custom range (not still showing a stale preset's data).
  - Inventory: confirm the row still renders correctly as a real `<tr>` (not hoisted out of the table by the browser); click the `⋮` trigger — confirm all 4 items work exactly as they did before (รับสินค้า/ปรับ/แก้ไข navigate correctly, ลบ still confirms + deletes); right-click anywhere else on the row — confirm the identical 4-item menu opens via the context-menu path too.

## Next Step

Hand off to `superpowers:writing-plans` to produce a task-by-task implementation plan (2 tasks: Pickers, Context Menu — matching this project's established "component + its wiring in one task" convention), then execute via `superpowers:subagent-driven-development`, with a live `npm run dev` preview open throughout per the user's standing preference.
