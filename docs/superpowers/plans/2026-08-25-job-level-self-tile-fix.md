# Job-Level Self-Tile Fix Implementation Plan

> **For agentic workers:** This plan is small and tightly coupled (3 files, no independent
> deliverable per file) — execute inline in this session rather than dispatching subagents.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the `/job-level` tile picker so the "self" tile always reflects whoever is
currently authenticated (not a hardcoded "OWNER" label), and the switchable "other members"
lists never include yourself and always offer the real Owner as a target when you're not
already them.

**Architecture:** The bug is entirely in the `/job-level` page and its `OwnerTile` component —
the server actions (`setOwnPin`, `verifyOwnPin`, `switchToMember`) already operate correctly on
"whoever `getProfile()` currently resolves to" vs. "the specific `member_id` passed in." Fix is
UI/query composition only: (1) `getTeamMembersByRole` in `src/lib/dal.ts` gains an `excludeId`
param and an `"owner"` role option; (2) `OwnerTile` is renamed to `SelfTile` and takes the
current profile's real `role` to pick its label and whether to show the password-reset "ลืม
PIN?" link (owner-only, since Manager/Staff have no real password); (3) the page fetches all
three role buckets with self excluded and conditionally renders the OWNER bucket only when self
isn't already the owner.

**Tech Stack:** Next.js 16 App Router, Server Actions (unchanged), Supabase (unchanged).

## Global Constraints

- Do not modify `src/app/actions/job-level.ts` — `setOwnPin`, `verifyOwnPin`,
  `resetOwnPinViaPassword`, `switchToMember` are already correct; the bug is only in how the
  job-level page composes which tile calls which action with which data.
- This project has no automated test runner configured (`package.json` has no `test` script,
  no Jest/Vitest/Playwright). Verification is live, against a disposable QA tenant/accounts via
  the Supabase MCP tools + the Browser pane, matching this project's established practice —
  every step below that says "verify" means a real live check, not a unit test.
- Preserve every existing visual/behavioral detail of the PIN-entry screens (PinPad wiring,
  error message rendering, Turnstile widget for password-reset) — only the label and the
  "ลืม PIN?" visibility are supposed to change.
- `RoleTile` (`src/components/job-level/role-tile.tsx`) is already correctly generic
  (`label` + `members` props) — do not modify it, it needs no changes.

---

### Task 1: Extend `getTeamMembersByRole` to support role `"owner"` and self-exclusion

**Files:**
- Modify: `src/lib/dal.ts:192-204`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getTeamMembersByRole(tenantId: string, role: Role, excludeId?: string):
  Promise<Pick<TeamMember, "id" | "full_name">[]>` — used by Task 2's page rewrite. `Role` is
  the existing exported type `"owner" | "manager" | "staff"` (`src/lib/dal.ts:7`).

- [ ] **Step 1: Read the current function to confirm line numbers before editing**

Run: `grep -n "getTeamMembersByRole" src/lib/dal.ts`
Expected: match at the `export async function getTeamMembersByRole(` line, currently line 192.

- [ ] **Step 2: Replace the function**

Replace this exact current block:

```ts
export async function getTeamMembersByRole(
  tenantId: string,
  role: "manager" | "staff"
): Promise<Pick<TeamMember, "id" | "full_name">[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("tenant_id", tenantId)
    .eq("role", role)
    .order("full_name", { ascending: true });
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
    .eq("role", role);
  if (excludeId) {
    query = query.neq("id", excludeId);
  }
  const { data } = await query.order("full_name", { ascending: true });
  return (data ?? []) as Pick<TeamMember, "id" | "full_name">[];
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Task 2 will actually call this with the new signature — this step alone
just confirms the widened `role: Role` parameter and optional `excludeId` don't break the
existing two call sites in the current `page.tsx`, which is about to be rewritten in Task 2
anyway, so a transient unused-param warning is not expected here since TypeScript doesn't warn
on narrowing call-site usage of a widened parameter type.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/dal.ts
git commit -m "feat(job-level): support owner role + self-exclusion in getTeamMembersByRole"
```

---

### Task 2: Rename `OwnerTile` to `SelfTile` with a role-driven label

**Files:**
- Create: `src/components/job-level/self-tile.tsx` (full replacement content for the renamed file)
- Delete: `src/components/job-level/owner-tile.tsx`

**Interfaces:**
- Consumes: `setOwnPin`, `verifyOwnPin`, `resetOwnPinViaPassword`, `type PinState` from
  `@/app/actions/job-level` (unchanged imports, unchanged actions).
- Produces: `SelfTile({ role, hasPinSet }: { role: "owner" | "manager" | "staff"; hasPinSet:
  boolean })` — consumed by Task 3's page rewrite.

- [ ] **Step 1: Create `src/components/job-level/self-tile.tsx`**

```tsx
"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { setOwnPin, verifyOwnPin, resetOwnPinViaPassword, type PinState } from "@/app/actions/job-level";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { PinPad } from "@/components/ui/pin-pad";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const ROLE_LABELS = {
  owner: "OWNER",
  manager: "MANAGER",
  staff: "STAFF",
} as const;

export function SelfTile({
  role,
  hasPinSet,
}: {
  role: "owner" | "manager" | "staff";
  hasPinSet: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full rounded-lg border bg-white p-6 text-center hover:shadow-md transition-shadow"
      >
        <p className="text-lg font-semibold text-sidebar">{ROLE_LABELS[role]}</p>
      </button>
    );
  }

  return hasPinSet ? (
    <VerifySelfPin canResetViaPassword={role === "owner"} />
  ) : (
    <SetSelfPin />
  );
}

function SetSelfPin() {
  const [state, action, pending] = useActionState<PinState, FormData>(setOwnPin, undefined);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center text-base">ตั้งรหัส PIN ของคุณ</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pin">PIN 6 หลัก</Label>
            <Input id="pin" name="pin" type="password" inputMode="numeric" maxLength={6} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pin_confirm">ยืนยัน PIN</Label>
            <Input
              id="pin_confirm"
              name="pin_confirm"
              type="password"
              inputMode="numeric"
              maxLength={6}
              required
            />
          </div>
          {state?.error !== undefined && (
            <p className="text-sm text-destructive font-medium">{state.error}</p>
          )}
          <Button
            type="submit"
            disabled={pending}
            className="w-full bg-accent hover:bg-accent/90 text-white"
          >
            {pending ? "กำลังบันทึก…" : "ตั้ง PIN"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function VerifySelfPin({ canResetViaPassword }: { canResetViaPassword: boolean }) {
  const [state, action, pending] = useActionState<PinState, FormData>(verifyOwnPin, undefined);
  const [formRef, setFormRef] = useState<HTMLFormElement | null>(null);
  const [forgotMode, setForgotMode] = useState(false);

  if (forgotMode) {
    return <ForgotOwnerPinForm onCancel={() => setForgotMode(false)} />;
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form
          ref={setFormRef}
          action={action}
          className="flex flex-col items-center gap-4"
        >
          <input type="hidden" name="pin" />
          {state?.error !== undefined && (
            <p className="text-sm text-destructive font-medium">{state.error}</p>
          )}
          <PinPad
            disabled={pending}
            onComplete={(pin) => {
              if (!formRef) return;
              const hidden = formRef.elements.namedItem("pin") as HTMLInputElement;
              hidden.value = pin;
              formRef.requestSubmit();
            }}
          />
          {canResetViaPassword && (
            <button
              type="button"
              onClick={() => setForgotMode(true)}
              className="text-sm text-accent hover:underline"
            >
              ลืม PIN?
            </button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function ForgotOwnerPinForm({ onCancel }: { onCancel: () => void }) {
  const [state, action, pending] = useActionState<PinState, FormData>(
    resetOwnPinViaPassword,
    undefined
  );
  const [token, setToken] = useState<string | null>(null);
  const [widgetError, setWidgetError] = useState(false);
  const turnstileRef = useRef<TurnstileInstance>(null);

  // Synchronize local UI state with the latest action result during render (React's "adjust
  // state while rendering" pattern), same convention used by login/register/forgot-password —
  // avoids the react-hooks/set-state-in-effect lint violation a useEffect-based version would
  // trigger.
  const [handledState, setHandledState] = useState<PinState>(undefined);
  if (state !== handledState) {
    setHandledState(state);
    if (state?.error !== undefined) {
      setToken(null);
    }
  }

  // Resetting the Turnstile widget is a genuine imperative side effect (an external DOM/network
  // call on the third-party widget instance), so it belongs in an effect, not the render-time
  // block above — tokens are single-use, so a failed submission must get a fresh one.
  useEffect(() => {
    if (state?.error !== undefined) {
      turnstileRef.current?.reset();
    }
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center text-base">ยืนยันตัวตนด้วยบัญชีของคุณ</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reset_email">อีเมล</Label>
            <Input
              id="reset_email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reset_password">รหัสผ่าน</Label>
            <Input
              id="reset_password"
              name="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          <input type="hidden" name="turnstile_token" value={token ?? ""} />
          <TurnstileWidget
            ref={turnstileRef}
            onSuccess={(t) => {
              setToken(t);
              setWidgetError(false);
            }}
            onExpire={() => setToken(null)}
            onError={() => {
              setToken(null);
              setWidgetError(true);
            }}
          />
          {widgetError && (
            <p className="text-xs text-muted-foreground text-center">
              ไม่สามารถโหลดระบบยืนยันตัวตนได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่
            </p>
          )}
          {state?.error !== undefined && (
            <p className="text-sm text-destructive font-medium">{state.error}</p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={pending}
              className="flex-1"
            >
              ยกเลิก
            </Button>
            <Button
              type="submit"
              disabled={pending || !token}
              className="flex-1 bg-accent hover:bg-accent/90 text-white"
            >
              {pending ? "กำลังตรวจสอบ…" : "ยืนยัน"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
```

This is byte-for-byte the old `owner-tile.tsx` except: the component is renamed `OwnerTile` →
`SelfTile` and takes a new `role` prop instead of always rendering the literal string "OWNER";
`ROLE_LABELS` picks the tile's visible label from `role`; `VerifyOwnerPin` is renamed
`VerifySelfPin` and takes a new `canResetViaPassword` boolean that gates the "ลืม PIN?" link
(previously always shown) — `SelfTile` passes `role === "owner"` for it, since
`resetOwnPinViaPassword` in `src/app/actions/job-level.ts:169` already rejects non-owner
accounts server-side, and Manager/Staff synthetic accounts have no real password to authenticate
with anyway (see `createTeamMember` in `src/app/actions/settings.ts:193-199` — random UUID
password, never given to the staff member). `SetSelfPin`, `ForgotOwnerPinForm`, and every JSX
subtree inside them are unchanged from the original file.

- [ ] **Step 2: Delete the old file**

```bash
git rm src/components/job-level/owner-tile.tsx
```

- [ ] **Step 3: Type-check (page.tsx still imports the old name/path — expected to fail until Task 3)**

Run: `npx tsc --noEmit`
Expected: FAIL — `src/app/(auth)/job-level/page.tsx` still imports `{ OwnerTile } from
"@/components/job-level/owner-tile"`, which no longer exists. This is expected and resolved by
Task 3 in the same work session (these two tasks ship as one commit sequence, not independently
mergeable — Task 3 must follow immediately).

- [ ] **Step 4: Stage (do not commit yet — commit together with Task 3's page rewrite so the tree is never left in a broken intermediate state)**

```bash
git add src/components/job-level/self-tile.tsx src/components/job-level/owner-tile.tsx
```

---

### Task 3: Rewrite `/job-level` page to use `SelfTile` and self-excluded member lists

**Files:**
- Modify: `src/app/(auth)/job-level/page.tsx` (full replacement)

**Interfaces:**
- Consumes: `SelfTile` from Task 2, `getTeamMembersByRole(tenantId, role, excludeId?)` from
  Task 1, existing `RoleTile` from `@/components/job-level/role-tile` (unchanged).
- Produces: nothing consumed elsewhere — this is the page itself.

- [ ] **Step 1: Replace the full file content**

```tsx
import { redirect } from "next/navigation";
import { getProfile, getTeamMembersByRole } from "@/lib/dal";
import { SelfTile } from "@/components/job-level/self-tile";
import { RoleTile } from "@/components/job-level/role-tile";

export default async function JobLevelPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "owner" && !profile.has_backup_password) {
    redirect("/onboarding/set-password");
  }

  const [owners, managers, staff] = await Promise.all([
    getTeamMembersByRole(profile.tenant_id, "owner", profile.id),
    getTeamMembersByRole(profile.tenant_id, "manager", profile.id),
    getTeamMembersByRole(profile.tenant_id, "staff", profile.id),
  ]);

  return (
    <div className="w-full max-w-md space-y-4">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold text-sidebar">KIDKUB JOB LEVEL</h1>
        <p className="text-sm text-muted-foreground">เลือกตำแหน่งของคุณเพื่อเข้าใช้งาน</p>
      </div>
      <SelfTile role={profile.role} hasPinSet={profile.pin_hash !== null} />
      {profile.role !== "owner" && <RoleTile label="OWNER" members={owners} />}
      <RoleTile label="MANAGER" members={managers} />
      <RoleTile label="STAFF" members={staff} />
    </div>
  );
}
```

Note the OWNER `RoleTile` is only rendered when `profile.role !== "owner"` — a tenant has
exactly one owner, so when self already IS the owner, `owners` is always empty (self-excluded)
and an always-empty "OWNER" section with `RoleTile`'s generic "ให้ Owner เพิ่มพนักงาน..."
placeholder would be nonsensical directly under a section literally about the Owner. MANAGER and
STAFF sections are always rendered unconditionally (matching the original page's behavior) since
there can be zero, one, or many members in those roles regardless of who self is — self-exclusion
alone (via `excludeId`) is sufficient there; no conditional-render is needed or correct for those
two.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS, no errors (this resolves Task 2's expected transient failure).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS, no new errors (pre-existing `<img>` warnings in unrelated files are fine).

- [ ] **Step 4: Commit Tasks 2 and 3 together**

```bash
git add src/app/"(auth)"/job-level/page.tsx
git commit -m "fix(job-level): stop self-tile from being bound to a hardcoded Owner identity

Fixes two related bugs: (1) after switching to a Manager/Staff identity, the
tile labeled \"OWNER\" actually verified the CURRENTLY authenticated
person's own PIN (self), not literally the Owner's — so a real Owner's PIN
was rejected there while the just-switched-to Manager's own PIN worked,
with no way to switch back to the real Owner at all; (2) the switchable
member lists never excluded yourself, so your own name appeared as a
switch-to target for your own current role.

Renamed OwnerTile -> SelfTile (role-driven label instead of a hardcoded
\"OWNER\" string); getTeamMembersByRole gained an excludeId param and
support for role=\"owner\"; the page now fetches all three role buckets
with self excluded and only shows the OWNER bucket when self isn't already
the owner (a tenant has exactly one Owner, so that bucket is otherwise
always empty). Server actions (setOwnPin/verifyOwnPin/switchToMember)
were not touched -- they were already correct."
```

- [ ] **Step 5: Live-verify against a disposable QA tenant (see Verification Plan below)**

---

## Verification Plan (run after Task 3, before considering this done)

No automated tests exist in this project — verify live using the Supabase MCP tools to create
disposable QA data (a throwaway tenant + Owner + Manager, following the exact pattern used
earlier this session to first reproduce this bug) plus the Browser pane, matching this project's
established practice. Delete all QA data after.

1. **Owner's own tile now shows "OWNER" correctly when self is Owner** — sanity check, should be
   unchanged from before.
2. **The exact original repro, now fixed:** set Owner PIN → create a Manager, set their PIN →
   switch to Manager (works) → click "สลับผู้ใช้งาน" → back at `/job-level`, the self-tile must
   now read **"MANAGER"** (not "OWNER") → entering the Manager's own PIN there must succeed →
   entering the real Owner's PIN there must be REJECTED (since this tile is for self, not Owner).
3. **The real Owner must now be reachable as a switch target:** from the Manager's job-level
   screen, an "OWNER" section must now appear (previously absent entirely) listing the real
   Owner by name; selecting it and entering the Owner's real PIN must succeed and land back on
   the Owner's own dashboard, with the self-tile back to reading "OWNER" on the next visit to
   `/job-level`.
4. **Self must never appear in a switch-to list:** while authenticated as the Manager, the
   MANAGER section's member list must NOT include the Manager's own name (previously it did —
   the second bug found alongside the main one).
5. **Owner's own PIN self-verification still works end-to-end** (unaffected control case):
   fresh Owner login → job-level → click self-tile ("OWNER") → enter Owner's own PIN → lands on
   dashboard.
6. Confirm no regression to the 2FA gate from the previous fix (`845c8c5`) — an Owner with a
   verified MFA factor who PIN-confirms their own tile must still be sent to `/mfa-challenge`.

Delete all QA data (profiles, auth.users, the throwaway tenant) and confirm 0 remaining after
every round, matching this session's established methodology throughout.
