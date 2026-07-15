# KIDKUBPOS — Figma Design System v2, Round 2 (Menus, Notifications)

> **For agentic workers:** This spec documents a Figma design deliverable, not a code change. Execution happens via Figma MCP skills (`figma-use`, `figma-generate-library`), not `writing-plans`/code implementation. Code translation is a separate, later step gated on user approval of this Figma draft — same pattern as v1 and v2 round 1.

**Goal:** Continue the iOS/iPadOS 26-inspired v2 design system (round 1: Toggle, Text Field search variant, Tab Bar — `docs/superpowers/specs/2026-07-14-figma-design-system-v2-ios-inspired-design.md`) with 2 more components from the original 8-category backlog: Menus, Notifications.

**Why now:** Of the 8 categories deferred from round 1, these 2 are the ones with a concrete, immediate use case in the current app — unlike Widgets (iOS home-screen concept, no equivalent surface in this web app) or Page controls (no carousels/paged content anywhere in KIDKUBPOS). Toolbars and Context Menus were considered but skipped this round in favor of scoping tightly to 2 categories with clear real-world targets.

**Reference source:** Same Apple "iOS and iPadOS 26 (Community)" kit as round 1 (`fileKey: JJdqjMaxVQGnwMgaCyH63q`) — visual/structural reference only (proportions, elevation, interaction pattern), re-tinted to KIDKUBPOS's existing brand palette. No Apple assets (SF Symbols, San Francisco font) copied in; icons are hand-built simple vector shapes, same as round 1's search icon.

## Scope

Both components added to the existing "Components" page (`2:27`) in the same Figma file (`MSBdlVkFbTrQM72FaN4Y3Y`).

### 1. Menu — row actions overflow menu

Targets a real, concrete use case: the inline "แก้ไข" / "ลบ" button pair currently sitting side-by-side in the Products and Inventory table rows (`src/app/(shell)/products/page.tsx`, `src/app/(shell)/inventory/page.tsx`) — candidate to become a single overflow-menu trigger per row in a future code-translation round.

**Deliverable:** one example popover frame (not a variant set — same treatment as round 1's Tab Bar, since the point is demonstrating the composed pattern once, not enumerating variants), containing exactly 2 real menu items:

- **Popover container:** hug-content width (~168px), white background, `radius/lg` (matches the app's existing `--radius` token used everywhere else), `shadow/lg` for elevation, no border (shadow alone separates it from content below, same treatment as Card). Vertical auto-layout, 4px inset padding around the item list, 0 item spacing (the divider provides the visual separation).
- **Menu Item — "แก้ไข":** hand-built pencil icon (simple vector, same construction technique as round 1's search icon) + label "แก้ไข", horizontal auto-layout, gap 8px, padding 12px horizontal / 10px vertical, text color `color/sidebar` (the app's standard body-text navy, not a new color).
- **Divider:** 1px line, raw gray `#E5E5E5`-equivalent (`{0.898, 0.898, 0.898}`) — same unbound raw value already used for Input's default border stroke (confirmed via inspection: no `color/border` variable exists in the Foundations collection, so this follows the established "out-of-token-scope raw gray" convention rather than inventing a new variable).
- **Menu Item — "ลบ":** hand-built trash-can icon + label "ลบ", both colored with the `color/danger` variable (the Foundations collection's actual name for this semantic — confirmed via inspection; corresponds to the app code's `--color-destructive` CSS variable) — signals a destructive action, matching the existing `Button` destructive variant's color.

**Explicitly not built this round:** a reusable "Menu Item" component with formal properties (TEXT label, BOOLEAN destructive, INSTANCE_SWAP icon) — the row-actions use case only ever needs these exact 2 items, so a generic property-driven component would be speculative generality for a pattern with one real caller. If a second menu use case emerges later, extract a proper component then.

### 2. Notification — Toast

**Interaction model:** floating, auto-dismissing (per user decision) — no manual close affordance. Positioning in the actual app (bottom-center, clearing the mobile `BottomNav` safe area) is a code-translation-time decision, not modeled in this Figma round.

**Deliverable:** a component set with one variant axis, `Type`: `Success` / `Error` (2 variants, positioned side by side like round 1's Toggle On/Off pair).

**Visual treatment — reuses the existing Badge "tint" convention** (`badge.tsx`'s `destructive` variant: `bg-destructive/10` + `text-destructive`, not a solid color fill) rather than inventing a new color treatment. Note: the Figma Foundations collection's variable for this semantic is named `color/danger` (confirmed via inspection), not `color/destructive` — `color/destructive` is only the app code's CSS variable name; the two refer to the same brand color.
- Container: `radius/lg`, `shadow/lg`, horizontal auto-layout, gap 8px, padding 16px horizontal / 12px vertical.
- **Type=Success:** background tint `color/success` at 10% opacity (paint-level opacity, not a bound-variable alpha — see round 1's lesson on `boundVariables.color` resetting custom opacity to 1), hand-built filled circle-checkmark icon in solid `color/success`, message text in `color/success` (darker/full-saturation for legibility), `text-sm font-medium` equivalent.
- **Type=Error:** background tint `color/danger` at 10% opacity (same raw-color-for-custom-opacity treatment), hand-built filled circle-X icon in solid `color/danger`, message text in `color/danger`.
- Placeholder message text for both: a short representative string (e.g. "บันทึกสำเร็จ" for Success, "เกิดข้อผิดพลาด" for Error) — real messages are wired at code-translation time.

**Explicitly not built this round:** an Info/neutral or Warning variant (no current app flow needs them — Low Stock Alerts already has its own dashboard widget from Stack 13, not a toast), a manual dismiss (×) control (auto-dismiss was the explicit decision), on-screen positioning mockup (component only, not a full-screen placement demo).

## Explicitly Out of Scope (this round)

- The remaining 6 iOS/iPadOS 26 categories: Pickers, Toolbars, Widgets, Page controls, Context Menus — still deferred, to be prioritized in a future round if wanted
- Any code changes — this is a Figma draft only; wiring the Menu into Products/Inventory tables or adding a real Toast trigger/dismiss-timer system to the app is separate, later, user-gated work
- A formal reusable "Menu Item" component with properties (see Scope section above)
- Warning/Info toast variants and manual-dismiss affordance

## Next Step

Build via `figma-use` + `figma-generate-library` skills, same file (`MSBdlVkFbTrQM72FaN4Y3Y`), same "Components" page (`2:27`). Validate each component with `get_metadata` + `get_screenshot` before moving to the next, same incremental pattern as v1 and round 1. Present the finished Figma draft to the user for review before any further action.
