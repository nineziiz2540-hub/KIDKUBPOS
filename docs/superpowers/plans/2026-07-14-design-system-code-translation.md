# Design System Code Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate the approved Figma design system (v1 tokens/Button/Card/Input, v2 Toggle/Text-Field-search/Tab-bar) into real code, and wire the new search-icon Input pattern into the Products and Inventory pages.

**Architecture:** Pure Tailwind v4 `@theme` token edits + `cva`/class-string edits on 3 existing `ui/` components, one new primitive-wrapped component (`Switch`, built the same way `Button`/`Input` already wrap `@base-ui/react`), and one new small generic client component (`SearchFilter`) reused by two Server Component pages.

**Tech Stack:** Next.js 16 (App Router, Server Components), Tailwind v4 (`@theme`), `@base-ui/react` (`switch`, already a dependency), `lucide-react` (icons, already a dependency), `class-variance-authority` (existing `cva` pattern in `button.tsx`).

This project has no automated test framework (`package.json` has no `test` script, no `.test.`/`.spec.` files exist). Per-task verification uses the project's actual convention: `npx tsc --noEmit` for TS-only changes, `npm run build` for CSS/token changes (compiles Tailwind, catches `@theme` syntax errors), and a final consolidated live-browser QA pass (Task 8) covering every visual/interaction change together — matching how every previous stack in this codebase was verified.

## Global Constraints

- Brand colors (`--color-accent: #ff6b35`, `--color-sidebar`, `--color-surface`) and font (Geist) do not change.
- Exact shadow values (from the approved spec):
  ```
  --shadow-sm:     0 1px 2px rgba(12,26,61,0.06)
  --shadow-md:     0 2px 4px rgba(12,26,61,0.06), 0 4px 12px rgba(12,26,61,0.08)
  --shadow-lg:     0 2px 4px rgba(12,26,61,0.06), 0 8px 16px rgba(12,26,61,0.10)
  --shadow-accent: 0 4px 12px rgba(255,107,53,0.25)
  ```
- Radius: `--radius: 0.625rem` → `--radius: 0.875rem` in `:root`. Do not touch the `calc()`-derived `--radius-sm/md/lg/xl/2xl/3xl/4xl` lines — they cascade automatically.
- Button's base corner radius uses `rounded-md` (not `rounded-lg`) — a deliberate deviation from the rest of the app, per user decision to match the already-approved Figma binding.
- No new npm dependencies (`@base-ui/react/switch` and `lucide-react`'s `Search` icon are both already installed).
- No changes to `src/lib/dal.ts`, Server Actions, or any Supabase query — the search feature filters client-side over data already fetched in full.
- Only 2 of the 4 originally-considered checkbox call sites become `Switch`: `product-form.tsx` (`is_active`) and `modifier-form.tsx` (`is_required`, `is_multi_select`). `modifiers-tab.tsx` and `modifier-modal.tsx` are multi-select checklists / a radio-or-checkbox picker — they keep their native `<input type="checkbox">`/`type="radio"` and must not be touched.

---

### Task 1: Design tokens — shadow scale + radius bump

**Files:**
- Modify: `src/app/globals.css:94` (radius value)
- Modify: `src/app/globals.css` (append new block after line 156, the existing brand-override `@theme` block)

**Interfaces:**
- Produces: Tailwind utility classes `shadow-sm`, `shadow-md`, `shadow-lg` (overriding Tailwind's built-in shadow scale app-wide) and a new `shadow-accent` utility. Every later task in this plan consumes these class names directly (no arbitrary-value `shadow-[var(...)]` syntax anywhere).

- [ ] **Step 1: Bump the radius base**

In `src/app/globals.css`, line 94, change:
```css
  --radius:  0.625rem;
```
to:
```css
  --radius:  0.875rem;
```

- [ ] **Step 2: Add the shadow token block**

At the end of `src/app/globals.css` (after the existing `:root { --background: #eef3fc; }` block, i.e. after current line 160), append:

```css

/* KIDKUBPOS: elevation scale (shadow-sm/md/lg auto-generated as Tailwind
   utilities via the --shadow-* theme namespace; shadow-accent is a new,
   non-default utility name generated the same way) */
@theme {
  --shadow-sm:     0 1px 2px rgba(12,26,61,0.06);
  --shadow-md:     0 2px 4px rgba(12,26,61,0.06), 0 4px 12px rgba(12,26,61,0.08);
  --shadow-lg:     0 2px 4px rgba(12,26,61,0.06), 0 8px 16px rgba(12,26,61,0.10);
  --shadow-accent: 0 4px 12px rgba(255,107,53,0.25);
}
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: build succeeds with no CSS/Tailwind errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(design-system): add shadow token scale, bump base radius to 0.875rem"
```

---

### Task 2: Button — radius fix + primary shadow

**Files:**
- Modify: `src/components/ui/button.tsx:7,11`

**Interfaces:**
- Consumes: `shadow-accent` utility from Task 1.
- Produces: no prop/API change — `Button`'s exported signature is unchanged, this task is styling-only.

- [ ] **Step 1: Change base radius from `rounded-lg` to `rounded-md`**

In `src/components/ui/button.tsx`, line 7, find:
```
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
```
Replace `rounded-lg` with `rounded-md` (only that one word changes on this line).

- [ ] **Step 2: Add the accent shadow to the `default` (primary) variant only**

Line 11, find:
```
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
```
Replace with:
```
        default: "bg-primary text-primary-foreground hover:bg-primary/80 shadow-accent",
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/button.tsx
git commit -m "feat(design-system): Button uses radius-md and accent shadow on primary variant"
```

---

### Task 3: Card — shadow instead of ring border

**Files:**
- Modify: `src/components/ui/card.tsx:15`

**Interfaces:**
- Consumes: `shadow-md` utility from Task 1.
- Produces: no prop/API change.

- [ ] **Step 1: Replace the ring with a shadow**

In `src/components/ui/card.tsx`, line 15, find:
```
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
```
Replace with (only `ring-1 ring-foreground/10` → `shadow-md` changes):
```
        "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground shadow-md [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/card.tsx
git commit -m "feat(design-system): Card uses shadow-md instead of a ring border"
```

---

### Task 4: Input — shadow, accent focus state, optional search icon

**Files:**
- Modify: `src/components/ui/input.tsx` (full rewrite of the component body)

**Interfaces:**
- Consumes: `shadow-sm` utility from Task 1.
- Produces: `Input` gains a new optional prop `icon?: "search"`. All existing call sites (which never pass `icon`) render byte-identical output to today except for the shadow/focus-ring class changes — **Task 7's `SearchFilter` is the only consumer of `icon="search"`.**

- [ ] **Step 1: Rewrite `src/components/ui/input.tsx`**

Replace the entire file content with:

```tsx
import * as React from "react"
import { Search } from "lucide-react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({
  className,
  type,
  icon,
  ...props
}: React.ComponentProps<"input"> & { icon?: "search" }) {
  const inputEl = (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base shadow-sm transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/35 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        icon && "pl-8",
        className
      )}
      {...props}
    />
  )

  if (!icon) return inputEl

  return (
    <div className="relative w-full">
      <Search
        size={14}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      {inputEl}
    </div>
  )
}

export { Input }
```

Note the two intentional changes from today's file beyond the shadow/icon additions: `focus-visible:border-ring` → `focus-visible:border-accent` and `focus-visible:ring-ring/50` → `focus-visible:ring-accent/35` — both border and ring turn accent-orange on focus, matching the actual Figma "Focus" variant the user approved (not just the ring alone).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors. Every existing call site (search the codebase for `<Input` — there are many, e.g. `product-form.tsx`, `modifier-form.tsx`) still compiles because `icon` is optional and every other prop is unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/input.tsx
git commit -m "feat(design-system): Input gets shadow-sm, accent focus state, optional search icon"
```

---

### Task 5: Switch (new component) + wire into 2 real forms

**Files:**
- Create: `src/components/ui/switch.tsx`
- Modify: `src/components/products/product-form.tsx` (import + `is_active` field)
- Modify: `src/components/modifiers/modifier-form.tsx` (import + `is_required`/`is_multi_select` fields)

**Interfaces:**
- Consumes: `shadow-sm` utility from Task 1.
- Produces: `Switch` component with props `{ className?, id?, name?, defaultChecked?, checked?, disabled?, onCheckedChange? }` (the full `@base-ui/react/switch` `Root` prop set, passed through via `...props`) — an uncontrolled `<Switch id="..." name="..." defaultChecked={boolean} />` submits as a native form field exactly like the checkbox it replaces (base-ui's `Switch.Root` renders a hidden native `<input type="checkbox">` internally for form participation).

- [ ] **Step 1: Create `src/components/ui/switch.tsx`**

```tsx
import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full border-2 border-transparent transition-colors outline-none focus-visible:ring-3 focus-visible:ring-accent/35 disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:bg-accent data-[unchecked]:bg-[#d1d1d6]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[27px] rounded-full bg-white shadow-sm transition-transform data-[checked]:translate-x-5 data-[unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
```

- [ ] **Step 2: Verify the new file compiles standalone**

Run: `npx tsc --noEmit`
Expected: no errors (this confirms `@base-ui/react/switch`'s `Root.Props` and `data-checked`/`data-unchecked` attribute names are used correctly).

- [ ] **Step 3: Wire into `src/components/products/product-form.tsx`**

Add the import (alongside the existing `Label`/`Textarea` imports near the top):
```tsx
import { Switch } from "@/components/ui/switch";
```

Then find (lines 109–118):
```tsx
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is_active"
          name="is_active"
          defaultChecked={defaults.is_active ?? true}
          className="h-4 w-4 rounded border-input accent-accent"
        />
        <Label htmlFor="is_active">เปิดใช้งาน</Label>
      </div>
```
Replace with:
```tsx
      <div className="flex items-center gap-2">
        <Switch
          id="is_active"
          name="is_active"
          defaultChecked={defaults.is_active ?? true}
        />
        <Label htmlFor="is_active">เปิดใช้งาน</Label>
      </div>
```

- [ ] **Step 4: Wire into `src/components/modifiers/modifier-form.tsx`**

Add the import:
```tsx
import { Switch } from "@/components/ui/switch";
```

Find (lines 47–68):
```tsx
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="mod-required"
              name="is_required"
              defaultChecked={defaults?.isRequired ?? false}
              className="h-4 w-4 rounded border-input accent-accent"
            />
            <Label htmlFor="mod-required">บังคับเลือก</Label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="mod-multi"
              name="is_multi_select"
              defaultChecked={defaults?.isMultiSelect ?? false}
              className="h-4 w-4 rounded border-input accent-accent"
            />
            <Label htmlFor="mod-multi">เลือกได้หลายตัวเลือก</Label>
          </div>
        </div>
```
Replace with:
```tsx
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex items-center gap-2">
            <Switch
              id="mod-required"
              name="is_required"
              defaultChecked={defaults?.isRequired ?? false}
            />
            <Label htmlFor="mod-required">บังคับเลือก</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="mod-multi"
              name="is_multi_select"
              defaultChecked={defaults?.isMultiSelect ?? false}
            />
            <Label htmlFor="mod-multi">เลือกได้หลายตัวเลือก</Label>
          </div>
        </div>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/switch.tsx src/components/products/product-form.tsx src/components/modifiers/modifier-form.tsx
git commit -m "feat(design-system): add Switch component, replace is_active/is_required/is_multi_select checkboxes"
```

**Do not touch** `src/components/products/modifiers-tab.tsx` or `src/components/pos/modifier-modal.tsx` in this task — both render multi-item selection lists (one checkbox/radio per list item), which is a different UI pattern from a singular on/off `Switch` and stays as native `<input>`.

---

### Task 6: BottomNav — active tab pill highlight

**Files:**
- Modify: `src/components/shell/bottom-nav.tsx`

**Interfaces:**
- Consumes: existing `--color-accent` (no new token dependency).
- Produces: no prop/API change — `BottomNav` still takes no props.

- [ ] **Step 1: Rewrite the nav item rendering**

In `src/components/shell/bottom-nav.tsx`, replace the whole `return (...)` block (lines 17–38) with:

```tsx
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-sidebar border-t border-white/10 flex h-16"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex items-center justify-center text-xs transition-colors ${
              active ? "text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            <span
              className={`flex flex-col items-center justify-center gap-0.5 rounded-full px-3 py-1 ${
                active ? "bg-accent/15" : ""
              }`}
            >
              <Icon size={22} />
              <span>{label}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
```

(Only the JSX inside the `map` changes — the icon/label are now wrapped in an inner `<span>` that carries the pill background when `active`, while the outer `<Link>` keeps the `flex-1` equal-width tab distribution unchanged.)

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/shell/bottom-nav.tsx
git commit -m "feat(design-system): BottomNav active tab gets accent pill highlight"
```

---

### Task 7: SearchFilter (new component) + wire into Products and Inventory pages

**Files:**
- Create: `src/components/ui/search-filter.tsx`
- Modify: `src/app/(shell)/products/page.tsx`
- Modify: `src/app/(shell)/inventory/page.tsx`

**Interfaces:**
- Consumes: `Input`'s `icon="search"` prop from Task 4.
- Produces: `SearchFilter<T>({ items: T[], filterKey: keyof T, placeholder: string, children: (filtered: T[]) => React.ReactNode })` — a generic client component. `filterKey` must name a string-coercible field on `T` (both call sites use `"name"`).

- [ ] **Step 1: Create `src/components/ui/search-filter.tsx`**

```tsx
"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"

function SearchFilter<T>({
  items,
  filterKey,
  placeholder,
  children,
}: {
  items: T[]
  filterKey: keyof T
  placeholder: string
  children: (filtered: T[]) => React.ReactNode
}) {
  const [query, setQuery] = useState("")
  const filtered =
    query.trim() === ""
      ? items
      : items.filter((item) =>
          String(item[filterKey]).toLowerCase().includes(query.toLowerCase())
        )

  return (
    <div className="space-y-4">
      <Input
        icon="search"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-xs"
      />
      {children(filtered)}
    </div>
  )
}

export { SearchFilter }
```

- [ ] **Step 2: Verify the new file compiles standalone**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Wire into `src/app/(shell)/products/page.tsx`**

Add the import (with the other component imports near the top):
```tsx
import { SearchFilter } from "@/components/ui/search-filter";
```

Find (lines 55–95):
```tsx
      <div className="rounded-lg border bg-white divide-y divide-border">
        {products && products.length > 0 ? (
          products.map((product) => (
            <div
              key={product.id}
              className="flex items-center gap-4 px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sidebar truncate">
                  {product.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {product.categories?.name ?? "ไม่ระบุหมวดหมู่"} ·{" "}
                  ฿{Number(product.price).toFixed(2)}
                </p>
              </div>
              <Badge variant={product.is_active ? "default" : "secondary"}>
                {product.is_active ? "เปิด" : "ปิด"}
              </Badge>
              {canManage && (
                <div className="flex gap-2 shrink-0">
                  <Link
                    href={`/products/${product.id}/edit`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    แก้ไข
                  </Link>
                  <form action={deleteProduct}>
                    <input type="hidden" name="id" value={product.id} />
                    <DeleteButton message={`ลบสินค้า "${product.name}"?`} />
                  </form>
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="px-4 py-8 text-center text-muted-foreground">
            ยังไม่มีสินค้า
          </p>
        )}
      </div>
```
Replace with:
```tsx
      <SearchFilter items={products ?? []} filterKey="name" placeholder="ค้นหาสินค้า...">
        {(filtered) => (
          <div className="rounded-lg border bg-white divide-y divide-border">
            {filtered.length > 0 ? (
              filtered.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center gap-4 px-4 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sidebar truncate">
                      {product.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {product.categories?.name ?? "ไม่ระบุหมวดหมู่"} ·{" "}
                      ฿{Number(product.price).toFixed(2)}
                    </p>
                  </div>
                  <Badge variant={product.is_active ? "default" : "secondary"}>
                    {product.is_active ? "เปิด" : "ปิด"}
                  </Badge>
                  {canManage && (
                    <div className="flex gap-2 shrink-0">
                      <Link
                        href={`/products/${product.id}/edit`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        แก้ไข
                      </Link>
                      <form action={deleteProduct}>
                        <input type="hidden" name="id" value={product.id} />
                        <DeleteButton message={`ลบสินค้า "${product.name}"?`} />
                      </form>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="px-4 py-8 text-center text-muted-foreground">
                {products && products.length > 0 ? "ไม่พบสินค้าที่ค้นหา" : "ยังไม่มีสินค้า"}
              </p>
            )}
          </div>
        )}
      </SearchFilter>
```

- [ ] **Step 4: Wire into `src/app/(shell)/inventory/page.tsx`**

Add the import:
```tsx
import { SearchFilter } from "@/components/ui/search-filter";
```

Find (lines 95–164, the `{/* Materials table */}` block):
```tsx
      {/* Materials table */}
      <div className="rounded-lg border bg-white overflow-hidden">
        {materials.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            ยังไม่มีวัตถุดิบ — กด &quot;เพิ่มวัตถุดิบ&quot; เพื่อเริ่มต้น
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-sidebar">ชื่อ</th>
                <th className="text-left px-4 py-3 font-medium text-sidebar">หน่วย</th>
                <th className="text-right px-4 py-3 font-medium text-sidebar">ต้นทุน/หน่วย</th>
                <th className="text-right px-4 py-3 font-medium text-sidebar">สต็อก</th>
                <th className="text-right px-4 py-3 font-medium text-sidebar">แจ้งเตือน ≤</th>
                <th className="text-right px-4 py-3 font-medium text-sidebar">การดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => {
                const isLow =
                  Number(m.min_stock_alert) > 0 &&
                  Number(m.current_stock) <= Number(m.min_stock_alert);
                return (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-muted/10">
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
              })}
            </tbody>
          </table>
        )}
      </div>
```
Replace with:
```tsx
      {/* Materials table */}
      <SearchFilter items={materials} filterKey="name" placeholder="ค้นหาวัตถุดิบ...">
        {(filtered) => (
          <div className="rounded-lg border bg-white overflow-hidden">
            {materials.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                ยังไม่มีวัตถุดิบ — กด &quot;เพิ่มวัตถุดิบ&quot; เพื่อเริ่มต้น
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                ไม่พบวัตถุดิบที่ค้นหา
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/30 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-sidebar">ชื่อ</th>
                    <th className="text-left px-4 py-3 font-medium text-sidebar">หน่วย</th>
                    <th className="text-right px-4 py-3 font-medium text-sidebar">ต้นทุน/หน่วย</th>
                    <th className="text-right px-4 py-3 font-medium text-sidebar">สต็อก</th>
                    <th className="text-right px-4 py-3 font-medium text-sidebar">แจ้งเตือน ≤</th>
                    <th className="text-right px-4 py-3 font-medium text-sidebar">การดำเนินการ</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m) => {
                    const isLow =
                      Number(m.min_stock_alert) > 0 &&
                      Number(m.current_stock) <= Number(m.min_stock_alert);
                    return (
                      <tr key={m.id} className="border-b last:border-0 hover:bg-muted/10">
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
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </SearchFilter>
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/search-filter.tsx "src/app/(shell)/products/page.tsx" "src/app/(shell)/inventory/page.tsx"
git commit -m "feat(design-system): add SearchFilter, wire into Products and Inventory pages"
```

---

### Task 8: Full-build check + consolidated live-browser QA

**Files:** none (verification only)

**Interfaces:** N/A — this task validates the combined output of Tasks 1–7.

- [ ] **Step 1: Full production build**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 2: Live-browser verification checklist**

Start the dev server and check each item against the running app:
- [ ] Any primary `Button` (e.g. POS checkout button) shows visibly smaller corner radius than before and a soft orange glow shadow beneath it.
- [ ] Any `Card`-based panel (e.g. Dashboard stat cards) shows a soft shadow with no visible border/ring.
- [ ] Any `Input` (e.g. product name field) shows a subtle shadow at rest; focusing it turns both the border and the focus ring orange (not the previous gray).
- [ ] Product edit page (`/products/[id]/edit`): the "เปิดใช้งาน" control is now a pill-shaped Switch, not a checkbox; toggling it and saving persists the change (confirms the hidden form field still submits correctly).
- [ ] Modifier edit page (`/modifiers/[id]/edit` or new): "บังคับเลือก" and "เลือกได้หลายตัวเลือก" are Switches; same persistence check.
- [ ] Product edit page's "Modifiers" tab (`modifiers-tab.tsx`) and the POS modifier picker modal (`modifier-modal.tsx`) are **visually unchanged** — still plain checkboxes/radios, confirming they were correctly left alone.
- [ ] On a mobile viewport, `BottomNav`'s currently-active tab shows a soft orange pill behind its icon+label; other tabs do not.
- [ ] `/products`: typing in the new search box narrows the list by name; clearing it restores the full list; searching a Thai substring that doesn't exist shows "ไม่พบสินค้าที่ค้นหา".
- [ ] `/inventory`: same search behavior, "ไม่พบวัตถุดิบที่ค้นหา" for no matches.

- [ ] **Step 3: Fix any discrepancy found, then re-run Step 1 and the failing checklist item(s) only**

---

## Self-Review Notes

- **Spec coverage:** all 7 spec sections (Tokens, Button, Card, Input, Switch, Tab Bar, Search filter) map 1:1 to Tasks 1–7. Task 8 covers the spec's "Testing" section.
- **Corrected scope carried over from spec self-review:** Switch replaces exactly 2 files' checkboxes (`product-form.tsx`, `modifier-form.tsx`), not 4 — `modifiers-tab.tsx`/`modifier-modal.tsx` are explicitly called out as do-not-touch in Task 5 and re-verified in Task 8's checklist.
- **One addition beyond the spec's literal text, done for fidelity to the approved Figma design:** Task 4 changes `focus-visible:border-ring` → `focus-visible:border-accent` in addition to the ring color the spec text mentioned — the actual approved Figma "Focus" Input variant has both the border and the ring turn accent-orange, and the spec's prose only mentioned the ring. Flagged here rather than silently added.
