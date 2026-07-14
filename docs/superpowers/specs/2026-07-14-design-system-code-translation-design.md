# KIDKUBPOS — Design System Code Translation (v1 + v2 Figma → Code)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into a task-by-task implementation plan, then superpowers:subagent-driven-development or superpowers:executing-plans to execute it.

**Goal:** Translate the approved Figma design system (v1: shadow/radius/Button/Card/Input/Badge tokens; v2: Toggle, Text Field search variant, Tab bar — both specs already reviewed and approved by the user) into real code, plus wire the new search-icon Input pattern into two pages that genuinely need it (Products, Inventory).

**Architecture:** Pure Tailwind v4 token + component-file edits, no new dependencies (Switch comes from `@base-ui/react/switch`, already a project dependency used the same way as `Button`/`Input`). One new component (`Switch`) and one new small client component (`SearchFilter`), both following existing codebase conventions.

**Tech Stack:** Next.js 16, Tailwind v4 (`@theme` tokens), `@base-ui/react` primitives, existing `cva` pattern for variant components.

## Global Constraints

- Brand colors (`--color-accent: #ff6b35`, `--color-sidebar`, `--color-surface`) and font (Geist) do not change — carried over unchanged from v1/v2 specs.
- New shadow tokens registered via a `@theme { --shadow-*: ... }` block. This is the same mechanism already proven in this codebase for radius (`--radius-sm/md/lg/xl` inside the shadcn `@theme inline` block directly power the existing `rounded-sm/md/lg/xl` utilities everywhere) — defining `--shadow-sm`/`--shadow-md`/`--shadow-lg` overrides Tailwind's built-in shadow scale app-wide, and `--shadow-accent` (a non-default key) auto-generates a new `shadow-accent` utility. **Component files use the plain utility classes directly** (`shadow-sm`, `shadow-md`, `shadow-accent`) — no `shadow-[var(--shadow-*)]` arbitrary-value syntax needed anywhere.
- Exact shadow values (from the approved v1 spec, unchanged):
  ```
  --shadow-sm:     0 1px 2px rgba(12,26,61,0.06)
  --shadow-md:     0 2px 4px rgba(12,26,61,0.06), 0 4px 12px rgba(12,26,61,0.08)
  --shadow-lg:     0 2px 4px rgba(12,26,61,0.06), 0 8px 16px rgba(12,26,61,0.10)
  --shadow-accent: 0 4px 12px rgba(255,107,53,0.25)
  ```
- Radius: `--radius: 0.625rem` → `--radius: 0.875rem` in `:root` (the existing `calc()`-derived scale in the shadcn `@theme inline` block cascades automatically — no other radius line changes).
- No new npm dependencies.
- No changes to DAL (`src/lib/dal.ts`) or Server Actions — the search feature is a pure client-side filter over data the pages already fetch in full.

## Components

### 1. Tokens — `src/app/globals.css`

- Change line 94 `--radius: 0.625rem;` → `--radius: 0.875rem;`
- Append a new `@theme { }` block after the existing brand-override block (after line 156), adding the 4 shadow custom properties with the exact values listed above. Once defined, `shadow-sm`/`shadow-md`/`shadow-accent` are used as plain Tailwind utility classes in component files (see below) — the `@theme` block itself is the only place the raw `rgba(...)` values appear.

### 2. Button — `src/components/ui/button.tsx`

- Base class string (line 7): change `rounded-lg` → `rounded-md` (per user decision: code follows the already-approved Figma binding, radius/md, rather than changing Figma).
- `variant.default` (line 11, the primary/accent button): append `shadow-accent` to the existing class string (`"bg-primary text-primary-foreground hover:bg-primary/80"` → add the shadow utility). No other variants get a shadow (matches the v1 Component Treatments table: primary only).

### 3. Card — `src/components/ui/card.tsx`

- Line 15: remove `ring-1 ring-foreground/10`, add `shadow-md` in its place.
- No radius change needed — `rounded-xl` already resolves to the bumped base radius (`radius-lg` tier) via the cascading `calc()` scale.

### 4. Input — `src/components/ui/input.tsx`

- Add `shadow-sm` to the base class string.
- Change the focus ring from `focus-visible:ring-ring/50` to `focus-visible:ring-accent/35` (accent-colored focus, per the approved v1 Component Treatments table — this intentionally diverges from shadcn's default neutral ring for this one component).
- Add an optional `icon` prop: `icon?: "search"`. When `"search"`, render an inline `Search` icon (from `lucide-react`, already a project dependency, used everywhere else in the codebase for icons — not a hand-built SVG, that was only a Figma-side stand-in) absolutely positioned at the left with `text-muted-foreground`, and add left padding (`pl-8`) to the input itself only when the icon is present. Implementation wraps the `<input>` in a relatively-positioned `<div>` when `icon` is set; renders the bare `<input>` unchanged (no wrapper div) when `icon` is omitted, so every existing call site is unaffected.

### 5. Switch (new) — `src/components/ui/switch.tsx`

New file, following the same construction pattern as `button.tsx` (wraps a `@base-ui/react` primitive with Tailwind classes, no `cva` needed since there's only one visual style, just on/off + disabled states driven by data attributes the primitive already exposes):

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
        className={cn(
          "pointer-events-none block size-[27px] rounded-full bg-white shadow-sm transition-transform data-[checked]:translate-x-5 data-[unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
```

(Confirmed against the installed package: `@base-ui/react/switch` exposes exactly `data-checked` / `data-unchecked` as boolean-presence attributes on both `Root` and `Thumb` — see `node_modules/@base-ui/react/switch/root/SwitchRootDataAttributes.js` — so `data-[checked]:...` / `data-[unchecked]:...` Tailwind selectors above are correct as written, not a placeholder.)

**Call-site replacement — corrected scope after re-reading all 4 originally-flagged files:** only 2 files qualify. A on/off **Switch** is the right control for a single yes/no setting; the other 2 files turned out to be multi-select checklists (`.map()` over a list, one checkbox per item) or a customer-facing option-picker with a radio/checkbox hybrid — both are correctly checkboxes/radios by convention and are **not** touched by this round:

- `src/components/products/product-form.tsx` — `is_active` (uncontrolled, `name="is_active" defaultChecked={defaults.is_active ?? true}`) → `<Switch name="is_active" defaultChecked={defaults.is_active ?? true} />`
- `src/components/modifiers/modifier-form.tsx` — two fields, both uncontrolled: `name="is_required" defaultChecked={defaults?.isRequired ?? false}` and `name="is_multi_select" defaultChecked={defaults?.isMultiSelect ?? false}` → same pattern with `<Switch>`

**Explicitly excluded (stay as checkbox/radio, not a scope gap — a deliberate correctness call):**
- `src/components/products/modifiers-tab.tsx` — `allModifiers.map(...)` renders one controlled checkbox per modifier group (`checked={selected.has(mod.id)}`, `onChange={() => toggle(mod.id)}`) to build a multi-select set; this is a checklist, not a singular setting.
- `src/components/pos/modifier-modal.tsx` — `type={modifier.isMultiSelect ? "checkbox" : "radio"}` renders the customer-facing modifier-option picker during POS checkout; same reasoning, plus it needs radio behavior for single-select groups, which `Switch` cannot express.

### 6. Tab Bar — `src/components/shell/bottom-nav.tsx`

Wrap the active link's icon+label in a pill: when `active` is true, add a wrapping `<span>` with `bg-accent/15 rounded-full px-3 py-1` around the `<Icon>` + label `<span>` (currently direct children of the `<Link>`). Inactive tabs keep today's `text-white/50 hover:text-white/80` — unchanged. Active tab's icon/label color becomes plain `text-white` (full opacity) with no color change on the icon itself, matching the v2 spec ("the pill alone signals active").

### 7. Search filter — new client component + 2 page wire-ups

**New file:** `src/components/ui/search-filter.tsx`

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
    <>
      <Input
        icon="search"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-xs"
      />
      {children(filtered)}
    </>
  )
}

export { SearchFilter }
```

**Wire-up 1 — `src/app/(shell)/products/page.tsx`:** the existing `products` array (fetched server-side, unchanged) and the JSX that maps over it to render the product list/table both move into `children` of a `<SearchFilter items={products ?? []} filterKey="name" placeholder="ค้นหาสินค้า...">{(filtered) => (...)}</SearchFilter>`. No change to the Supabase query.

**Wire-up 2 — `src/app/(shell)/inventory/page.tsx`:** same pattern around the existing `materials` array from `getRawMaterials()`, `filterKey="name"`, placeholder `"ค้นหาวัตถุดิบ..."`. No change to `getRawMaterials`.

Both pages are Server Components; `SearchFilter` is the only new Client Component boundary introduced, matching the existing pattern already used for `raw-material-form.tsx`/`stock-action-form.tsx` in the same directory style.

## Explicitly Out of Scope

- The remaining 8 iOS/iPadOS-26-inspired categories from the v2 discussion (Menus, Notifications, Pickers, Toolbars, Widgets/Dashboard, Page controls, Context Menus) — no Figma or code work this round.
- Server-side/DB-backed search (full-text search, `ILIKE` queries, pagination) — current scope is a client-side substring filter only, appropriate because both pages already fetch their full list with no pagination.
- Any change to `Badge` — v1 spec already marked it unchanged, still true.
- Dark mode — the `.dark` class block exists in `globals.css` but the app doesn't expose a theme toggle; not touched by this round.

## Testing

- Type-check (`npx tsc --noEmit` or the project's existing check script) after all file edits.
- Live browser verification (per this project's established convention) for: Button (primary shows accent shadow + rounded-md), Card (shadow instead of border), Input (accent focus ring + shadow), Switch on both real call sites — product edit's "เปิดใช้งาน" (`is_active`) and modifier group's "บังคับเลือก"/"เลือกได้หลายตัว" (`is_required`/`is_multi_select`) — confirming toggling still flips the underlying form value correctly, BottomNav active-pill on at least 2 different active routes, Products + Inventory search filters (typing narrows the list, clearing restores it, Thai text matches correctly), and confirm `modifiers-tab.tsx`/`modifier-modal.tsx` checkboxes are visually untouched.

## Next Step

Hand this spec to `superpowers:writing-plans` to produce the task-by-task implementation plan.
