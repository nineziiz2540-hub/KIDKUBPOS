# KIDKUBPOS — Figma Design System v2 (iOS/iPadOS 26-Inspired: Toggle, Text Field, Tab Bar)

> **For agentic workers:** This spec documents a Figma design deliverable, not a code change. Execution happens via Figma MCP skills (`figma-use`, `figma-generate-library`), not `writing-plans`/code implementation. Code translation is a separate, later step gated on user approval of this Figma draft — same pattern as v1.

**Goal:** Extend the KIDKUBPOS Figma design system (v1: Foundations + Button/Card/Input/Badge, `docs/superpowers/specs/2026-07-09-figma-design-system-v1-design.md`) with 3 more components, using Apple's official "iOS and iPadOS 26 (Community)" Figma kit as visual/structural reference — borrowing proportions and interaction patterns, not assets, and re-tinted to the existing brand palette.

**Why now:** User wants to keep making the UI feel less "stiff" and specifically flagged 11 iOS/iPadOS 26 component categories as reference material. Of those 11, this round scopes to the 3 most immediately useful to the current app: Text Fields, Toggles, Tab bar. The remaining 8 (Menus, Notifications, Pickers, Toolbars, Widgets, Page controls, Context Menus) are explicitly deferred — Widgets in particular overlaps with full-screen Dashboard mockups, already called out as future work in the v1 spec.

**Reference source:** Apple Design Resources — "iOS and iPadOS 26 (Community)" Figma file (`fileKey: JJdqjMaxVQGnwMgaCyH63q`), inspected live (`Buttons` page, node `507:24673`) to confirm it's the real official kit. **Licensing note:** treated as visual/structural reference only — proportions, spacing rhythm, elevation, and interaction patterns are fair game to reinterpret; Apple's actual assets (SF Symbols icon set, San Francisco font) are NOT copied into KIDKUBPOS. Icons are hand-built simple vector shapes in this round; the code-translation step will use the app's existing `lucide-react` icon set, not SF Symbols.

## Scope

Three components, added to the existing "Components" page in the same Figma file (`MSBdlVkFbTrQM72FaN4Y3Y`) as v1 — no page-cap concern since the file is now on a Professional-tier plan (no 3-page limit).

### 1. Toggle (new component)

Not present anywhere in the codebase today — the 4 existing on/off controls (`product-form.tsx`, `modifier-form.tsx`, `modifier-modal.tsx`, `modifiers-tab.tsx`) all use a bare native `<input type="checkbox" className="accent-accent">`. This is a genuinely new primitive, Figma-only this round (no code retrofit).

**Structure:** iOS-proportioned pill track (51×31, ratio ~1.65:1) with a circular white thumb (27px diameter, shadow/sm) inset 2px from the track edge — track uses `radius/4xl` (fully pill).

**Variants (2 properties, 4 total):**
- `Value`: On / Off
- `State`: Default / Disabled (Disabled = 50% opacity, same convention as Button's Disabled — reusing node opacity, not a separate color ramp)

**Colors:** Off track = neutral gray (`#D1D1D6`-equivalent, raw value — same "out of brand token scope" treatment as Button's Secondary gray in v1, not bound to a Foundations variable). On track = `color/accent` (bound variable, same orange used everywhere else for the "primary/active" signal). Thumb = white in both states.

### 2. Text Field (extends existing Input component, does not replace it)

The existing Input component set (`9:11`, states Default/Focus/Error) gains **one new variant**, not a full cross-product: `State=Default, Icon=Search`. The other 3 existing variants implicitly get `Icon=None`. This models a leading-icon search field (magnifying glass, hand-built simple vector — 2 overlapping shapes, a ring + a short diagonal line) + `"ค้นหา..."` placeholder, demonstrating the pattern without building combinations the app doesn't need yet (no page currently has search UI; this is preparing the pattern, not shipping a feature).

**Explicitly not built:** Focus/Error variants of the search field, a trailing clear (×) button variant — deferred until an actual search UI is planned.

### 3. Tab Bar (redesign reference for existing BottomNav)

This models the real `bottom-nav.tsx` (4 items: Dashboard/POS/Orders/Settings, `h-16`, solid `color/sidebar` background) with one visual addition borrowed from iOS 26: the **active tab gets a pill-shaped highlight** behind its icon+label — `color/accent` fill at 15% paint opacity, `radius/4xl` — rather than iOS's full frosted-glass/blur floating bar treatment. Inactive tabs: icon+label at white 70% opacity (matches current `text-white/50`→`/80` hover convention, brightened slightly for the active-vs-inactive contrast to read clearly against the new pill). Active tab: icon+label at full white opacity, no color change to the icon/label itself (the pill alone signals "active").

**Explicitly rejected:** floating/detached bar, backdrop-blur/translucency — both would be a bigger visual departure from the app's existing solid-navy identity (matches the desktop `Sidebar`, which is also solid) and blur risks legibility over busy page content in a POS context where clear reading matters more than decoration.

**Deliverable:** one example frame (4 items, "POS" shown active) — not a variant set, since the point is demonstrating the active-pill treatment once, not enumerating which-tab-is-active as a formal variant axis.

## Explicitly Out of Scope (this round)

- The other 8 iOS/iPadOS 26 categories from the user's original list: Menus, Notifications, Pickers, Toolbars, Widgets (Dashboard charts), Page controls, Context Menus — deferred to future rounds, to be prioritized later
- Any code changes — this is a Figma draft only, same as v1; code translation (including actually wiring Toggle into the 4 checkbox call sites, adding a real search feature, updating `bottom-nav.tsx`) is a separate later step gated on user approval
- Full Focus/Error states for the search-icon Text Field variant
- A formal "which tab is active" variant axis for Tab Bar — just the one illustrative frame

## Next Step

Build via `figma-use` + `figma-generate-library` skills, same file (`MSBdlVkFbTrQM72FaN4Y3Y`), same "Components" page. Validate each component with `get_metadata` + `get_screenshot` before moving to the next, same incremental pattern as v1. Present the finished Figma draft to the user for review before any further action.
