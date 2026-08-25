# Team Member Deactivation — Design Spec

## Problem

Settings > ทีมงาน has no way to remove a Manager or Staff once added — confirmed live 2026-08-25
(see conversation): the row only has a role-select dropdown and "ตั้ง PIN ใหม่", no delete
action exists anywhere in the UI or in `src/app/actions/settings.ts`.

A literal hard delete is not viable: `profiles.id` is referenced by `NO ACTION` (not `CASCADE`)
foreign keys from `orders` (`refunded_by`, `refunded_approved_by`, `cancelled_approved_by`,
`discount_approved_by`, `cancelled_by`), `shifts` (`opened_by`, `closed_by`), and
`inventory_transactions` (`created_by`) — confirmed live against the production schema. A
`DELETE FROM profiles` for anyone who has ever opened a shift, approved a discount, etc. (i.e.
almost anyone worth removing) would fail outright with a foreign-key violation.

## Decision

Build **deactivation**, not deletion: historical records (orders, shifts, inventory
transactions) stay completely intact and keep correctly attributing who did what; the
deactivated person can no longer log in or be selected at the job-level tile picker. Confirmed
with the user this has no knock-on effect elsewhere: this app has no external sync, export, or
webhook integration of any kind (confirmed via codebase search), and dashboard/report queries in
`src/lib/dal.ts` aggregate by product/date/tenant, never by staff member, so deactivating someone
never changes any reported number.

**Immediate session cutoff, not just "can't log back in"** — user's explicit choice, confirmed via
AskUserQuestion, over the cheaper "just block future logins" alternative.

## How immediate cutoff works (no proxy.ts changes needed)

Supabase's admin API supports banning a user by id:
`admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" })` (the value Supabase's own
docs use for "effectively permanent" — ~100 years) sets `banned_until` on the `auth.users` row.
GoTrue checks ban status on every `/auth/v1/user` call, not just at login — and this app's
`src/proxy.ts` middleware already calls `supabase.auth.getUser()` (network-validated, hits that
real endpoint) on **every single authenticated request**. So the moment a Manager/Staff account
is banned, their very next request — even mid-session, even with a still-unexpired access token —
gets `user === null` from `getUser()`, and `proxy.ts`'s existing `!isAuthed` branch already
redirects to `/login`. No new gating logic is needed in the request path at all; this reuses
infrastructure this project already built and verified during the MFA/2FA work.

`src/lib/dal.ts`'s `getProfile()` (`getAuthUser()` → `getUser()` → profile lookup) gets a second,
independent, defense-in-depth check as belt-and-suspenders: return `null` when
`profiles.deactivated_at` is set, even if somehow the underlying session were still considered
valid. This costs nothing extra (same query, one more field checked) and matches this project's
established "defense in depth" pattern from the App+RLS MFA work.

## Schema change

New nullable column on `profiles`: `deactivated_at timestamptz null default null`. `null` = active
(the default and current state of every existing row); a timestamp = when it was deactivated.
Chosen over a plain boolean so the "when" is preserved for the Owner's own reference in the UI,
at no extra cost.

## Scope

**In scope:**
- Owner-only `deactivateTeamMember(memberId)` action: sets `deactivated_at = now()` + bans the
  underlying `auth.users` row via `ban_duration`. Blocks `memberId === profile.id` (an Owner can
  never deactivate themselves — matches the existing guard pattern in `updateMemberRole`; doing so
  would strand the tenant, since Owner is the only account with real login credentials).
- Owner-only `reactivateTeamMember(memberId)` action: sets `deactivated_at = null` + lifts the ban
  (`ban_duration: "none"`). Explicitly in scope per this conversation — a deactivated-by-mistake
  or returning staff member should not need a brand-new account.
- `getTeamMembersByRole` (the job-level tile picker's data source) excludes deactivated profiles —
  a deactivated person must never appear as a switch-to target.
- `switchToMember` (`src/app/actions/job-level.ts`) itself rejects a deactivated target id
  explicitly — not just relying on the picker UI never offering them, so a deactivated member
  can never be switched into even via a direct/forged action call.
- Settings > ทีมงาน UI: active members get a new "ปิดใช้งาน" button alongside the existing
  role-select and reset-PIN controls; deactivated members show a distinct "ปิดใช้งานแล้ว" state
  (with the deactivation date) and a "เปิดใช้งานอีกครั้ง" button instead of the normal controls.

**Out of scope (not requested, not needed for this fix):**
- Any change to how orders/shifts/inventory_transactions display historical staff attribution —
  already correct and untouched by this design.
- Any reporting UI broken out "by staff member" — doesn't exist today, not being added here.
- Re-enabling a *deactivated Owner* — impossible by construction, since deactivation is blocked
  for self and there is exactly one Owner per tenant.

## Risks / edge cases considered

- **A deactivated Manager/Staff mid-PIN-entry on `/job-level` when deactivated**: the very next
  server action call (`switchToMember`, `setOwnPin`, `verifyOwnPin`) re-fetches their profile
  fresh via `getProfile()`/direct query — none of these cache stale state across the deactivation,
  so there's no window where a mid-flow deactivated user's PIN attempt could still succeed.
- **Un-banning on reactivate must be explicit** (`ban_duration: "none"`) — omitting it would leave
  a reactivated member still banned at the GoTrue level even though `deactivated_at` was cleared,
  a silent contradiction between the two systems. Both actions must keep `profiles.deactivated_at`
  and the GoTrue ban in lockstep.
- **PIN-uniqueness check in `createTeamMember`/`resetTeamMemberPin`** currently scans all profiles
  in the tenant with a non-null `pin_hash` — a deactivated member's `pin_hash` is left untouched
  by this design (not cleared), so their old PIN would still count as "taken" and block a new hire
  from reusing it. Accepted as-is: correct/conservative behavior (avoids two different people
  ever sharing one PIN's hash, even across time), and clearing `pin_hash` on deactivation isn't
  needed for the security goal (their account is already banned, so an unclearable PIN doesn't
  grant any access).

## Verification plan

No automated test runner exists in this project (`package.json` has no `test` script). Verify
live with a disposable QA tenant (Owner + Manager), matching every fix earlier this session:
1. Deactivate the Manager as Owner → their profile row shows `deactivated_at` set, their
   `auth.users` row shows `banned_until` far in the future.
2. **The Manager's own already-open session gets cut off on its very next request** (not just
   future logins) — the core "immediate cutoff" requirement. Reproduce with a real live session:
   mint a session for the Manager, confirm it works, deactivate from the Owner side, then reuse
   the *same* Manager session cookie for another request and confirm it's rejected.
3. The Manager no longer appears as a switch-to target on `/job-level` from the Owner's session.
4. Settings > ทีมงาน shows the Manager as deactivated with a working "เปิดใช้งานอีกครั้ง" button.
5. Reactivating: `deactivated_at` clears, ban lifts, the Manager can be minted a fresh session and
   log in normally again, and reappears as a switch-to target.
6. Confirm an Owner cannot deactivate themselves (button/action rejects `memberId === profile.id`).
7. Confirm no regression to the existing 2FA gate or the job-level self-tile fix from earlier this
   session — neither touches this code path, but worth a quick sanity pass given the shared files.

Delete all QA data after, confirming 0 remaining, matching this session's established
methodology throughout.
