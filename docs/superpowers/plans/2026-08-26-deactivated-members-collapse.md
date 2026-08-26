# Deactivated Team Members Collapsible Section Implementation Plan

> **For agentic workers:** This plan is small and tightly coupled (2 files, one deliverable) —
> execute inline in this session rather than dispatching subagents. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Stop deactivated Manager/Staff rows from cluttering Settings > ทีมงาน's main list as
more people leave over time. Move them into a collapsed-by-default disclosure section below the
active list, per the approved design in
`docs/superpowers/specs/2026-08-26-deactivated-members-collapse-design.md`.

**Architecture:** `src/app/(shell)/settings/team/page.tsx` (server component) partitions the
existing `getTeamMembers(...)` result into `activeMembers`/`deactivatedMembers` by
`deactivated_at`. The main list renders only `activeMembers` — no behavior change to any row
there. A new client component, `DeactivatedMembersSection`, renders only when
`deactivatedMembers.length > 0`, as its own bordered card with a toggle header
("พนักงานที่ปิดใช้งานแล้ว (N)" + chevron) that flips local `useState` open/closed — no server
round-trip, no new server action. Expanded rows reuse the exact name/role/date markup and
`ReactivateButton` the main list already renders for a deactivated row today.

**Tech Stack:** Next.js 16 Server Components + one small Client Component, Tailwind, lucide-react
icons (already a dependency — `ChevronLeft` is already imported in this file). No DB/action
changes.

## Global Constraints

- No new server actions, no new DB columns, no changes to `deactivateTeamMember` /
  `reactivateTeamMember` (`src/app/actions/settings.ts`) or to `getTeamMembers` (`src/lib/dal.ts`)
  — this is a pure rendering/grouping change on top of data that already exists.
- If `deactivatedMembers.length === 0`, `DeactivatedMembersSection` must not render at all — no
  empty toggle for a store where nobody has ever been deactivated.
- The section starts collapsed on every page load (no persistence) — this is intentional per the
  spec, not a gap to fix.
- This project has no automated test runner configured. Verify live using the Browser pane against
  a disposable QA tenant, matching this session's established practice — every "verify" step below
  means a real live check, not a unit test.
- Match the existing visual language exactly: `rounded-lg border bg-white` for the card,
  `divide-y divide-border` between rows, the same row inner markup (`flex items-center gap-4 px-4
  py-3`, name in `font-medium text-sidebar text-sm truncate`, meta line in `text-xs
  text-muted-foreground`) the main list already uses for a deactivated row today.

---

### Task 1: Collapsible `DeactivatedMembersSection` + wire into the team page

**Files:**
- Create: `src/components/settings/deactivated-members-section.tsx`
- Modify: `src/app/(shell)/settings/team/page.tsx`

**Interfaces:**
- Consumes: `TeamMember` type from `src/lib/dal.ts` (`{ id: string; full_name: string | null;
  role: Role; created_at: string; deactivated_at: string | null }`); `ReactivateButton` from the
  existing `src/components/settings/deactivate-team-member-form.tsx` (already exported, signature
  `ReactivateButton({ memberId }: { memberId: string })`).
- Produces: `DeactivatedMembersSection({ members }: { members: TeamMember[] })` — a client
  component, rendered by the team page with only the deactivated subset.

- [ ] **Step 1: Create `src/components/settings/deactivated-members-section.tsx`**

```tsx
"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { TeamMember } from "@/lib/dal";
import { ReactivateButton } from "@/components/settings/deactivate-team-member-form";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
};

export function DeactivatedMembersSection({ members }: { members: TeamMember[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-sidebar"
      >
        <span>พนักงานที่ปิดใช้งานแล้ว ({members.length})</span>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      {open && (
        <div className="divide-y divide-border border-t">
          {members.map((member) => (
            <div key={member.id} className="flex items-center gap-4 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sidebar text-sm truncate">
                  {member.full_name ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {ROLE_LABELS[member.role] ?? member.role}
                  {member.deactivated_at &&
                    ` · ปิดใช้งานแล้วเมื่อ ${new Date(member.deactivated_at).toLocaleDateString("th-TH")}`}
                </p>
              </div>
              <ReactivateButton memberId={member.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

Note: `TeamMember` is not currently exported as a named type import target outside `dal.ts` in
any other component, but it IS already exported from `src/lib/dal.ts` (`export type TeamMember =
{...}` at dal.ts:155) — importing it here is a normal type-only import, nothing to add.

- [ ] **Step 2: Replace `src/app/(shell)/settings/team/page.tsx`**

Replace the full current content:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getProfile, getTeamMembers } from "@/lib/dal";
import { updateMemberRole } from "@/app/actions/settings";
import { RoleSelectForm } from "@/components/settings/role-select-form";
import { TeamMemberForm } from "@/components/settings/team-member-form";
import { ResetPinForm } from "@/components/settings/reset-pin-form";
import { DeactivateButton } from "@/components/settings/deactivate-team-member-form";
import { DeactivatedMembersSection } from "@/components/settings/deactivated-members-section";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
};

export default async function TeamPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner") redirect("/");

  const members = await getTeamMembers(profile.tenant_id);
  const activeMembers = members.filter((m) => m.deactivated_at === null);
  const deactivatedMembers = members.filter((m) => m.deactivated_at !== null);

  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center gap-3">
        <Link
          href="/settings"
          className="text-muted-foreground hover:text-sidebar transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-sidebar">จัดการทีม</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {activeMembers.length} คนในร้าน
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-white divide-y divide-border">
        {activeMembers.map((member) => (
          <div key={member.id} className="flex items-center gap-4 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sidebar text-sm truncate">
                {member.full_name ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {ROLE_LABELS[member.role] ?? member.role}
              </p>
            </div>
            {member.id === profile.id ? (
              <span className="text-xs text-muted-foreground italic px-2 py-1">
                คุณ
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <RoleSelectForm
                  action={updateMemberRole}
                  memberId={member.id}
                  currentRole={member.role}
                />
                <ResetPinForm memberId={member.id} />
                <DeactivateButton memberId={member.id} />
              </div>
            )}
          </div>
        ))}
        {activeMembers.length === 0 && (
          <p className="px-4 py-12 text-center text-muted-foreground text-sm">
            ยังไม่มีพนักงาน
          </p>
        )}
      </div>

      {deactivatedMembers.length > 0 && (
        <DeactivatedMembersSection members={deactivatedMembers} />
      )}

      <TeamMemberForm />
    </div>
  );
}
```

Note what changed from the current file: `members` is now split into `activeMembers` /
`deactivatedMembers`; the main list's row markup drops the `member.deactivated_at && ...` meta
line and the `member.deactivated_at ? <ReactivateButton .../> : (...)` branch (a member in this
list is never deactivated now, so that branch is dead code — removed, not just unreachable); the
empty-state check moves to `activeMembers.length === 0`; `ReactivateButton` import is removed from
this file (it now lives only in `deactivated-members-section.tsx`) and `DeactivatedMembersSection`
is added.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 5: Live-verify in the Browser pane**

Using the disposable-QA-tenant pattern established this session (Supabase MCP `execute_sql` to
insert a throwaway tenant/owner/manager/staff, mint a session, inject the cookie, open
`http://localhost:3000/settings/team` at tablet size):

1. With 0 deactivated members: confirm `DeactivatedMembersSection` does not render at all.
2. Deactivate one Manager (existing `DeactivateButton` flow, unchanged): the row disappears from
   the main list immediately (server revalidates), and a new "พนักงานที่ปิดใช้งานแล้ว (1)" card
   appears below the main list, collapsed.
3. Click the toggle: section expands, shows the deactivated Manager's name/role/date and a working
   "เปิดใช้งานอีกครั้ง" button. Click the toggle again: collapses.
4. Click "เปิดใช้งานอีกครั้ง": member reappears in the main active list; since they were the only
   deactivated member, the whole section disappears again (falls out of the `length > 0` check,
   nothing special to verify beyond that it actually does).
5. Deactivate two members (one Manager, one Staff): confirm the counter reads "(2)" and both rows
   render when expanded, still collapsed by default on a fresh page load.
6. Confirm the "คุณ" (self/Owner) row is never affected — it stays in the active list, no
   deactivate control, unchanged from before this plan.

Delete all QA data (profiles, auth.users, the throwaway tenant) and confirm 0 remaining after,
matching this session's established cleanup discipline.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/deactivated-members-section.tsx "src/app/(shell)/settings/team/page.tsx"
git commit -m "feat(team): collapse deactivated members into a disclosure section"
```
