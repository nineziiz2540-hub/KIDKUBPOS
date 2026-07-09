# KIDKUBPOS — Figma Design System v1 (Tokens + Key Components)

> **For agentic workers:** This spec documents a Figma design deliverable, not a code change. Execution happens via Figma MCP skills (`figma-create-new-file`, `figma-generate-library`), not `writing-plans`/code implementation. Code translation (globals.css) is a separate, later step gated on user approval of the Figma draft.

**Goal:** Fix KIDKUBPOS's "stiff" visual feel by adding a proper elevation (shadow) system and softening radius/spacing, inspired by iPadOS's soft-elevation conventions but re-tinted to the existing café brand palette — without changing brand colors, font, or layout structure.

**Why now:** User ran a full UI/UX audit (2026-07-08, see `project_uiux_audit_2026-07-08` memory) and fixed functional bugs (font fallback, mobile POS layout, order_number display, dead nav link). This is the next, separate step: visual polish, done in Figma first so the direction can be reviewed before any code changes.

**Scope:** Design System only (colors, shadow scale, radius scale, spacing guideline, 4 key components: Button, Card, Input, Badge). Full-screen mockups (POS, Dashboard) are explicitly out of scope for this round — a likely next brainstorm once the token system is validated.

## Approved Direction

Keep existing brand colors (`--color-accent: #ff6b35`, `--color-sidebar: #0c1a3d`, `--color-surface: #eef3fc`) and font (Geist) unchanged. Add what's missing (elevation) and soften what exists (radius), reusing iPadOS's soft multi-layer shadow convention but tinted toward the brand navy instead of neutral grey, so the app reads as "premium café" rather than "cold tech."

## Token Decisions

**Shadow scale (new):**
```
--shadow-sm:     0 1px 2px rgba(12,26,61,0.06)
--shadow-md:     0 2px 4px rgba(12,26,61,0.06), 0 4px 12px rgba(12,26,61,0.08)
--shadow-lg:     0 2px 4px rgba(12,26,61,0.06), 0 8px 16px rgba(12,26,61,0.10)
--shadow-accent: 0 4px 12px rgba(255,107,53,0.25)
```
- `sm` → inputs, badges
- `md` → cards/panels (replaces the current bare `border`)
- `lg` → modals, bottom sheets, popovers
- `accent` → primary action buttons only (checkout, save) — the one place a colored (not navy) shadow is used, to make primary CTAs pop

**Radius:** bump base `--radius` from `0.625rem` (10px) to `0.875rem` (14px). The existing scale (`--radius-sm/md/lg/xl/2xl/3xl/4xl`, all `calc(var(--radius) * N)`) cascades automatically — no other token needs to change.

**Spacing guideline (convention, not a new token):** card/panel padding minimum `p-5` (20px); page sections on desktop use `p-6` (24px).

## Component Treatments

| Component | Change |
|---|---|
| Card | Drop `border`, use `shadow-md` as the boundary definition instead |
| Button (primary) | Add `shadow-accent`; radius follows the new base scale |
| Input | Keep a thin border (still needed for clear editable-field affordance) + `shadow-sm` + accent-colored focus ring |
| Badge | Unchanged — existing tinted-background pill pattern (e.g. "กะเปิดอยู่") already fits |

## Explicitly Out of Scope

- No color palette changes (accent/sidebar/surface/font stay exactly as-is)
- No full-screen mockups this round (POS/Dashboard redesigns are a follow-up)
- No code changes yet — this is a Figma draft for review only; translating approved tokens into `globals.css` is a separate step after the user signs off on the Figma file

## Next Step

Create a new Figma file and build this as a design-system library (Variables for colors/shadow/radius + the 4 components as variants), using the `figma-create-new-file` and `figma-generate-library` skills. Present the resulting file to the user for review before any code translation.
