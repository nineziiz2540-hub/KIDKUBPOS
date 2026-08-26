# Deactivated Team Members — Collapsible Section (Design)

## Problem

Settings > ทีมงาน (`src/app/(shell)/settings/team/page.tsx`) lists every
`profiles` row for the tenant — active and deactivated — in one flat list.
A deactivated member (`deactivated_at !== null`) still renders inline with
the same visual weight as an active one, just swapping their action buttons
for a single "เปิดใช้งานอีกครั้ง" (reactivate) button. As more people leave
over time, this list grows and gets harder to scan for "who's actually on
the team right now" — the page's main job.

Hard delete isn't viable (see [[project_team_member_delete_missing]] — `NO
ACTION` foreign keys from `orders`/`shifts`/`inventory_transactions`), so
deactivated members must stay in the database and remain reachable (for
reactivation) — just not visually mixed into the active roster by default.

## Chosen approach

Move every deactivated member out of the main list into a separate,
collapsed-by-default section below it: **"พนักงานที่ปิดใช้งานแล้ว (N)"**
with a disclosure chevron. Collapsed state shows only that one summary row.
Expanding it reveals the deactivated members with the same info they show
today (name, role, "ปิดใช้งานแล้วเมื่อ <date>") and the existing
"เปิดใช้งานอีกครั้ง" button — unchanged behavior, just relocated.

If there are zero deactivated members, the section does not render at all
(no empty toggle).

Rejected alternatives:
- **Filter tabs (ทั้งหมด/ใช้งานอยู่/ปิดใช้งานแล้ว):** always occupies header
  space even for a brand-new store with nobody deactivated yet — the
  collapsible section only appears once it's actually needed.
- **Separate page:** adds a route for a feature this small; the collapsible
  section keeps everything on one page with no new navigation.

## Component changes

**`src/app/(shell)/settings/team/page.tsx`** (server component, existing):
- Partition `members` (from `getTeamMembers`) into `activeMembers` and
  `deactivatedMembers` by `deactivated_at`.
- Main list renders only `activeMembers` (same row markup as today —
  `RoleSelectForm`, `ResetPinForm`, `DeactivateButton` — nothing changes
  here except the input array).
- Below the main list card, render
  `<DeactivatedMembersSection members={deactivatedMembers} />` — only when
  `deactivatedMembers.length > 0`.
- The "คุณ" (self) row logic is unaffected — the signed-in owner is always
  active, so it only ever appears in the active list.

**`src/components/settings/deactivated-members-section.tsx`** (new client
component):
- Props: `members: { id: string; full_name: string | null; role: string;
  deactivated_at: string }[]`.
- `"use client"`, local `useState<boolean>(false)` for open/closed
  (collapsed by default — no persistence needed, it's fine to re-collapse
  on every page load).
- Own `rounded-lg border bg-white` box, matching the visual weight of the
  main list card and the "add member" form card below it.
- Header: a full-width button, `"พนักงานที่ปิดใช้งานแล้ว (" + N + ")"` with
  a `ChevronDown`/`ChevronRight` (lucide-react, already used for the back
  arrow on this page) that rotates/swaps on toggle. Clicking it flips the
  open state — no server round-trip.
- When open, renders each member below the header using the same row
  layout the main list uses today for a deactivated row (name, role label,
  "ปิดใช้งานแล้วเมื่อ <date>", `ReactivateButton`), separated by
  `divide-y divide-border` to match the main list's existing style.
- Imports `ReactivateButton` from the existing
  `src/components/settings/deactivate-team-member-form.tsx` — unchanged.

## Data flow / actions

No changes to `deactivateTeamMember` / `reactivateTeamMember`
(`src/app/actions/settings.ts`) or to `getTeamMembers` (`src/lib/dal.ts`).
This is purely a rendering/grouping change in the page and a new
presentational client component. `revalidatePath("/settings/team")` already
fires on both actions, so reactivating a member re-fetches the full list
server-side and they reappear in the active section automatically — the
collapsible section's local open/closed state resets on that navigation,
which is fine since the whole page re-renders.

## Edge cases

- **Zero deactivated members:** section omitted entirely (checked above).
- **Reactivating from within the open section:** after the server action
  completes and the page revalidates, that member disappears from the
  deactivated list and reappears in the active list above. If they were the
  only deactivated member, the whole section now disappears — no special
  handling needed since this falls out of the "omit if empty" rule.
- **Self somehow deactivated:** not reachable — `deactivateTeamMember`
  already rejects `memberId === profile.id` server-side, and the current
  owner is never rendered as deactivated.
