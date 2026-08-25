# Team Member Deactivation Implementation Plan

> **For agentic workers:** This plan is small and tightly coupled (6 files, no independent
> deliverable per file) — execute inline in this session rather than dispatching subagents.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Owner deactivate a Manager/Staff member (immediate session cutoff, historical
records untouched, reversible), closing the "no delete button" gap found 2026-08-25 without the
foot-gun of a literal hard delete (blocked by `NO ACTION` foreign keys from `orders`/`shifts`/
`inventory_transactions`).

**Architecture:** A new nullable `profiles.deactivated_at` column plus two new owner-gated server
actions (`deactivateTeamMember`, `reactivateTeamMember`) that keep it in lockstep with a GoTrue
ban (`admin.auth.admin.updateUserById(id, { ban_duration })`). The ban alone gives immediate
cutoff for free: `src/proxy.ts` already calls the network-validated `supabase.auth.getUser()` on
every authenticated request, and GoTrue rejects that call for a banned user starting on their very
next request — no changes to `proxy.ts` are needed. `getProfile()` in `src/lib/dal.ts` gets an
independent defense-in-depth check (return `null` if `deactivated_at` is set) for the same reason
this project built both an App-layer and RLS-layer gate for the 2FA feature. `getTeamMembersByRole`
(the job-level tile picker's data source) excludes deactivated profiles, and `switchToMember`
(`src/app/actions/job-level.ts`) gets an explicit `deactivated_at` check so a deactivated
member can never be switched into even via a direct action call bypassing the picker UI.

**Tech Stack:** Next.js 16 Server Actions, Supabase (Postgres + GoTrue Admin API), unchanged.

## Global Constraints

- An Owner can never deactivate themselves (`memberId === profile.id` must be rejected) — Owner is
  the only account with real login credentials; deactivating them would strand the tenant.
- The GoTrue ban and `profiles.deactivated_at` must always move together. On deactivate: ban
  FIRST, then set the DB flag (fail-safe ordering — if the ban call fails, do not mark them
  deactivated in the DB, since that would be a false sense of security with no actual cutoff). On
  reactivate: lift the ban first, then clear the DB flag (mirrors the same ordering discipline).
- `ban_duration: "876000h"` is the exact value from `@supabase/auth-js`'s own JSDoc example for
  "effectively permanent" (~100 years) — confirmed by reading
  `node_modules/@supabase/auth-js/dist/module/GoTrueAdminApi.js`. `ban_duration: "none"` is the
  documented way to lift a ban — confirmed by reading
  `node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:453`. Use these exact strings.
- This project has no automated test runner configured. Verify live using the Supabase MCP tools
  against a disposable QA tenant, matching this session's established practice throughout —
  every "verify" step below means a real live check, not a unit test.
- Do not touch `src/proxy.ts` — the immediate-cutoff requirement is satisfied entirely by the
  GoTrue ban plus the existing per-request `getUser()` call already there; no new logic belongs
  in the request-path middleware for this feature.
- Do not change `createTeamMember`'s or `resetTeamMemberPin`'s PIN-uniqueness scan (which checks
  all `pin_hash IS NOT NULL` rows in the tenant, including deactivated ones) — this is a
  deliberate, already-correct choice (see spec's Risks section): a deactivated member's PIN hash
  staying "reserved" is conservative and harmless, since their account is banned regardless.

---

### Task 1: Add `profiles.deactivated_at` column

**Files:**
- Create: `supabase/migrations/20260825150000_profiles_deactivated_at.sql`

**Interfaces:**
- Produces: `profiles.deactivated_at timestamptz null` — consumed by every later task.

- [ ] **Step 1: Write the migration**

```sql
alter table public.profiles
  add column deactivated_at timestamptz null default null;
```

- [ ] **Step 2: Apply via the Supabase MCP `apply_migration` tool** (not `execute_sql` — this
  project's established practice requires migrations to go through the real migration ledger; a
  prior incident in this project used `execute_sql` for a migration and it went missing from the
  ledger until re-applied correctly, see `.superpowers/sdd/progress.md` Task 1 history)

Name: `profiles_deactivated_at`.

- [ ] **Step 3: Verify live**

Run (via `execute_sql`, read-only, fine for verification):
```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'profiles' and column_name = 'deactivated_at';
```
Expected: one row, `data_type = timestamp with time zone`, `is_nullable = YES`,
`column_default = NULL`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260825150000_profiles_deactivated_at.sql
git commit -m "feat(team): add profiles.deactivated_at column"
```

---

### Task 2: Wire `deactivated_at` through `src/lib/dal.ts`

**Files:**
- Modify: `src/lib/dal.ts` (four spots: `ProfileWithTenant` type, `getProfile`, `TeamMember` type,
  `getTeamMembers`, `getTeamMembersByRole`)

**Interfaces:**
- Consumes: Task 1's column.
- Produces: `ProfileWithTenant.deactivated_at: string | null`; `TeamMember.deactivated_at: string
  | null`; `getTeamMembersByRole` now excludes deactivated profiles unconditionally; `getProfile()`
  returns `null` for a deactivated caller — consumed by every page that already does
  `if (!profile) redirect(...)` (no changes needed at those call sites, this is the point).

- [ ] **Step 1: Add `deactivated_at` to `ProfileWithTenant`**

Find this block (around line 11):
```ts
export type ProfileWithTenant = {
  id: string;
  full_name: string | null;
  role: Role;
  tenant_id: string;
  pin_hash: string | null;
  pin_failed_attempts: number;
  pin_locked_until: string | null;
  has_backup_password: boolean;
  created_at: string;
  updated_at: string;
  tenants: {
```

Add `deactivated_at: string | null;` right after `has_backup_password: boolean;`:
```ts
export type ProfileWithTenant = {
  id: string;
  full_name: string | null;
  role: Role;
  tenant_id: string;
  pin_hash: string | null;
  pin_failed_attempts: number;
  pin_locked_until: string | null;
  has_backup_password: boolean;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
  tenants: {
```

- [ ] **Step 2: Make `getProfile()` reject a deactivated caller**

Replace this exact block:
```ts
export const getProfile = cache(async (): Promise<ProfileWithTenant | null> => {
  const user = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*, tenants(*)")
    .eq("id", user.id)
    .single();

  return data as ProfileWithTenant | null;
});
```

with:
```ts
export const getProfile = cache(async (): Promise<ProfileWithTenant | null> => {
  const user = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*, tenants(*)")
    .eq("id", user.id)
    .single();

  if (!data || (data as ProfileWithTenant).deactivated_at !== null) return null;

  return data as ProfileWithTenant;
});
```

- [ ] **Step 3: Add `deactivated_at` to `TeamMember`**

Replace:
```ts
export type TeamMember = {
  id: string;
  full_name: string | null;
  role: Role;
  created_at: string;
};
```

with:
```ts
export type TeamMember = {
  id: string;
  full_name: string | null;
  role: Role;
  created_at: string;
  deactivated_at: string | null;
};
```

- [ ] **Step 4: Select `deactivated_at` in `getTeamMembers`**

Replace:
```ts
export async function getTeamMembers(tenantId: string): Promise<TeamMember[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  return (data ?? []) as TeamMember[];
}
```

with:
```ts
export async function getTeamMembers(tenantId: string): Promise<TeamMember[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role, created_at, deactivated_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  return (data ?? []) as TeamMember[];
}
```

- [ ] **Step 5: Exclude deactivated profiles in `getTeamMembersByRole`**

Replace (this is the version from the earlier job-level self-tile fix, commit `8b71e72`):
```ts
export async function getTeamMembersByRole(
  tenantId: string,
  role: Role,
  excludeId?: string
): Promise<Pick<TeamMember, "id" | "full_name">[]> {
  const supabase = createAdminClient();
  let query = supabase
    .from("profiles")
    .select("id, full_name")
    .eq("tenant_id", tenantId)
    .eq("role", role);
  if (excludeId) {
    query = query.neq("id", excludeId);
  }
  const { data } = await query.order("full_name", { ascending: true });
  return (data ?? []) as Pick<TeamMember, "id" | "full_name">[];
}
```

with:
```ts
export async function getTeamMembersByRole(
  tenantId: string,
  role: Role,
  excludeId?: string
): Promise<Pick<TeamMember, "id" | "full_name">[]> {
  const supabase = createAdminClient();
  let query = supabase
    .from("profiles")
    .select("id, full_name")
    .eq("tenant_id", tenantId)
    .eq("role", role)
    .is("deactivated_at", null);
  if (excludeId) {
    query = query.neq("id", excludeId);
  }
  const { data } = await query.order("full_name", { ascending: true });
  return (data ?? []) as Pick<TeamMember, "id" | "full_name">[];
}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/dal.ts
git commit -m "feat(team): exclude deactivated profiles from getProfile/getTeamMembersByRole"
```

---

### Task 3: Harden `switchToMember` against a deactivated target

**Files:**
- Modify: `src/app/actions/job-level.ts:196-278` (the `switchToMember` function)

**Interfaces:**
- Consumes: `deactivated_at` column from Task 1.
- Produces: nothing new — this closes a gap so a deactivated member can never be switched into,
  even by a direct POST to this action bypassing the (already-filtered, per Task 2) picker UI.

- [ ] **Step 1: Add `deactivated_at` to the target profile query and check it**

Find this block inside `switchToMember` (currently around line 211):
```ts
  const { data: target } = await admin
    .from("profiles")
    .select("id, pin_hash, pin_failed_attempts, pin_locked_until")
    .eq("id", memberId)
    .eq("tenant_id", callerProfile.tenant_id)
    .single();

  if (!target || !target.pin_hash) {
    return { error: "ไม่พบข้อมูลพนักงาน" };
  }
```

Replace with:
```ts
  const { data: target } = await admin
    .from("profiles")
    .select("id, pin_hash, pin_failed_attempts, pin_locked_until, deactivated_at")
    .eq("id", memberId)
    .eq("tenant_id", callerProfile.tenant_id)
    .single();

  if (!target || !target.pin_hash || target.deactivated_at !== null) {
    return { error: "ไม่พบข้อมูลพนักงาน" };
  }
```

Deliberately reuses the existing "not found" message rather than a distinct "deactivated"
message — this path is unreachable through normal UI use (Task 2 already filters the picker), so
the only way to hit it is a direct/forged action call, and there's no user-facing benefit to
distinguishing the two cases for that caller.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/job-level.ts
git commit -m "fix(job-level): reject switchToMember for a deactivated target"
```

---

### Task 4: `deactivateTeamMember` and `reactivateTeamMember` server actions

**Files:**
- Modify: `src/app/actions/settings.ts` (append two new exported functions after
  `resetTeamMemberPin`, which currently ends the file at line 274)

**Interfaces:**
- Consumes: `getProfile`, `createAdminClient` (already imported in this file); `TeamMemberState`
  (already defined in this file, reused unchanged).
- Produces: `deactivateTeamMember(prevState, formData)` and `reactivateTeamMember(prevState,
  formData)`, both `(prevState: TeamMemberState, formData: FormData) => Promise<TeamMemberState>`
  — consumed by Task 5's new UI components.

- [ ] **Step 1: Append both actions to the end of `src/app/actions/settings.ts`**

```ts

export async function deactivateTeamMember(
  prevState: TeamMemberState,
  formData: FormData
): Promise<TeamMemberState> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const memberId = formData.get("member_id");
  if (typeof memberId !== "string") {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }
  if (memberId === profile.id) {
    return { error: "ไม่สามารถปิดใช้งานบัญชีตัวเองได้" };
  }

  const admin = createAdminClient();

  // Ban first, DB flag second: if the ban call fails, we must not mark them deactivated in the
  // DB, since that would show "deactivated" in the UI without the actual immediate-cutoff having
  // happened at all — a false sense of security.
  const { error: banError } = await admin.auth.admin.updateUserById(memberId, {
    ban_duration: "876000h",
  });
  if (banError) return { error: "ปิดใช้งานไม่สำเร็จ" };

  const { error } = await admin
    .from("profiles")
    .update({ deactivated_at: new Date().toISOString() })
    .eq("id", memberId)
    .eq("tenant_id", profile.tenant_id);
  if (error) return { error: "ปิดใช้งานไม่สำเร็จ" };

  revalidatePath("/settings/team");
  return { success: true };
}

export async function reactivateTeamMember(
  prevState: TeamMemberState,
  formData: FormData
): Promise<TeamMemberState> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const memberId = formData.get("member_id");
  if (typeof memberId !== "string") {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }

  const admin = createAdminClient();

  // Lift the ban first, DB flag second — mirrors deactivate's ordering discipline. If lifting
  // the ban fails, do not clear deactivated_at, since that would show "active" in the UI while
  // the account is still actually banned at the GoTrue level.
  const { error: unbanError } = await admin.auth.admin.updateUserById(memberId, {
    ban_duration: "none",
  });
  if (unbanError) return { error: "เปิดใช้งานไม่สำเร็จ" };

  const { error } = await admin
    .from("profiles")
    .update({ deactivated_at: null })
    .eq("id", memberId)
    .eq("tenant_id", profile.tenant_id);
  if (error) return { error: "เปิดใช้งานไม่สำเร็จ" };

  revalidatePath("/settings/team");
  return { success: true };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/settings.ts
git commit -m "feat(team): add deactivateTeamMember/reactivateTeamMember server actions"
```

---

### Task 5: Settings > ทีมงาน UI — deactivate/reactivate controls

**Files:**
- Create: `src/components/settings/deactivate-team-member-form.tsx`
- Modify: `src/app/(shell)/settings/team/page.tsx`

**Interfaces:**
- Consumes: `deactivateTeamMember`, `reactivateTeamMember` from Task 4;
  `TeamMember.deactivated_at` from Task 2.
- Produces: `DeactivateButton({ memberId }: { memberId: string })` and
  `ReactivateButton({ memberId }: { memberId: string })`, rendered by the team page.

- [ ] **Step 1: Create `src/components/settings/deactivate-team-member-form.tsx`**

```tsx
"use client";
import { useActionState } from "react";
import {
  deactivateTeamMember,
  reactivateTeamMember,
  type TeamMemberState,
} from "@/app/actions/settings";
import { Button } from "@/components/ui/button";

export function DeactivateButton({ memberId }: { memberId: string }) {
  const [state, action, pending] = useActionState<TeamMemberState, FormData>(
    deactivateTeamMember,
    undefined
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="member_id" value={memberId} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        className="text-destructive hover:text-destructive"
      >
        {pending ? "…" : "ปิดใช้งาน"}
      </Button>
      {state?.error !== undefined && (
        <span className="text-xs text-destructive">{state.error}</span>
      )}
    </form>
  );
}

export function ReactivateButton({ memberId }: { memberId: string }) {
  const [state, action, pending] = useActionState<TeamMemberState, FormData>(
    reactivateTeamMember,
    undefined
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="member_id" value={memberId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "…" : "เปิดใช้งานอีกครั้ง"}
      </Button>
      {state?.error !== undefined && (
        <span className="text-xs text-destructive">{state.error}</span>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Wire into the team page**

Replace the full current content of `src/app/(shell)/settings/team/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getProfile, getTeamMembers } from "@/lib/dal";
import { updateMemberRole } from "@/app/actions/settings";
import { RoleSelectForm } from "@/components/settings/role-select-form";
import { TeamMemberForm } from "@/components/settings/team-member-form";
import { ResetPinForm } from "@/components/settings/reset-pin-form";

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
            {members.length} คนในร้าน
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-white divide-y divide-border">
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
            {member.id === profile.id ? (
              <span className="text-xs text-muted-foreground italic px-2 py-1">
                คุณ
              </span>
            ) : member.deactivated_at ? (
              <ReactivateButton memberId={member.id} />
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
        {members.length === 0 && (
          <p className="px-4 py-12 text-center text-muted-foreground text-sm">
            ยังไม่มีพนักงาน
          </p>
        )}
      </div>

      <TeamMemberForm />
    </div>
  );
}
```

Note the added import — `DeactivateButton` and `ReactivateButton` must be imported from Task 5
Step 1's file:
```tsx
import { DeactivateButton, ReactivateButton } from "@/components/settings/deactivate-team-member-form";
```
(add this alongside the other component imports at the top of the file).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no new errors (pre-existing `<img>` warnings in unrelated files are fine).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/deactivate-team-member-form.tsx "src/app/(shell)/settings/team/page.tsx"
git commit -m "feat(team): add deactivate/reactivate controls to Settings > ทีมงาน"
```

---

## Verification Plan (run after Task 5, before considering this done)

No automated tests exist in this project — verify live using the Supabase MCP tools to create a
disposable QA tenant + Owner + Manager (following the exact pattern used throughout this
session), plus the Browser pane so progress is visible. Delete all QA data after.

1. **Deactivate as Owner**: click "ปิดใช้งาน" on the Manager row → row switches to "ปิดใช้งานแล้ว"
   state with a working "เปิดใช้งานอีกครั้ง" button. Confirm in the DB: `profiles.deactivated_at`
   is set, `auth.users.banned_until` is far in the future for that id.
2. **Immediate cutoff — the core requirement**: mint a live session for the Manager BEFORE
   deactivating, confirm it works (e.g. loads the dashboard), THEN deactivate from the Owner side,
   THEN reuse the *exact same* Manager session cookie for a fresh request. Must now fail (redirect
   to `/login`) — proves the cutoff is immediate, not just "can't log in again."
3. **Picker exclusion**: from the Owner's `/job-level` screen, the deactivated Manager must no
   longer appear under the MANAGER section at all.
4. **Direct-call hardening**: confirm `switchToMember` rejects the deactivated Manager's id even
   when called directly (not just absent from the picker) — this is Task 3's specific addition,
   worth testing independently of the UI.
5. **Reactivate**: click "เปิดใช้งานอีกครั้ง" → `deactivated_at` clears, `banned_until` clears,
   mint a fresh session for the Manager and confirm it works again, and they reappear in the
   `/job-level` picker.
6. **Self-protection**: confirm the Owner cannot deactivate their own row (there should be no
   deactivate control shown for the "คุณ" row at all, matching the existing role-select/reset-pin
   exclusion for self).
7. Confirm `tsc`/`lint` clean and no regression to the 2FA gate (`845c8c5`) or the job-level
   self-tile fix (`8b71e72`) — quick sanity pass, since this shares `dal.ts` and
   `job-level.ts` with both.

Delete all QA data (profiles, auth.users, the throwaway tenant) and confirm 0 remaining after.
