# Owner PIN Self-Reset — Design

## Problem

Manager and Staff PINs can be reset by the Owner from Settings → Team (`resetTeamMemberPin`), but
the Owner has no way to reset their own forgotten PIN — `setOwnPin` explicitly refuses to run once
`pin_hash` is already set ("คุณตั้ง PIN ไว้แล้ว"). The only recovery today is a direct database
edit by whoever has Supabase access, which isn't a real self-service path. This surfaced as a real
practical problem when a user tried to verify their setup and got locked out of testing their own
PIN.

## Approach

Add a "ลืม PIN?" link to the Owner tile's PIN-entry screen. It swaps the PIN pad for a small
email+password form. Submitting it re-authenticates via `signInWithPassword` — the same credential
the Owner already used to log into the device in the first place — which is the strongest secret
only the real Owner holds, and requires no new infrastructure (no email links, no tokens).

A successful password check does three things in one action:
1. Re-authenticates as whoever those credentials belong to, establishing a **fresh** Supabase Auth
   session. This matters because the device's *ambient* session at the point of clicking the Owner
   tile is not reliably the Owner's own — see "Adjacent finding" below. Re-authenticating with a
   password sidesteps that entirely: whatever the fresh session turns out to be, it is exactly and
   only whoever entered valid credentials.
2. Verifies the resulting profile's `role === 'owner'`. Manager/Staff accounts use synthetic emails
   with random, discarded passwords they never see, so this should never trigger in practice — it's
   defense-in-depth against this endpoint being probed with arbitrary credentials.
3. Clears that profile's `pin_hash`, `pin_failed_attempts`, `pin_locked_until` (identical fields to
   what `resetTeamMemberPin` already resets for team members, just applied to the caller's own row).

The action then redirects to `/job-level`. The page re-renders with `hasPinSet: false` for that
profile, so `<OwnerTile>` automatically falls through to the **existing** `SetOwnerPin` component —
no new "choose a new PIN" UI is built; the already-tested one is reused as-is.

## Adjacent finding (context, not in scope to fix here)

`VerifyOwnerPin`/`verifyOwnPin` operate on `getProfile()` — whichever profile the *ambient*
Supabase session currently belongs to — not necessarily the tenant's actual Owner. Because
`switchWorker()` only clears the `worker_verified` cookie and never reverts the underlying Auth
session, if the device was last switched to a Manager or Staff member and then "switch worker"
was tapped to return to `/job-level`, the Owner tile's PIN check would silently operate on that
Manager/Staff's own PIN instead. This has no security impact (the `worker_verified` cookie is
existence-only and every route still re-checks `profile.role` fresh per request — see
[[project_login_auth_revamp]]/Task 7's cookie-trust note), but it is a real UX mislabeling bug. The
password re-auth flow in this spec is immune to it by construction, since it never trusts the
ambient session. Fixing the mislabeling itself is a separate, smaller follow-up if wanted later.

## Data flow

```
Owner tile → tap "ลืม PIN?" → email+password form
  → resetOwnPinViaPassword(email, password)
    → supabase.auth.signInWithPassword({email, password})
       (fail → "อีเมลหรือรหัสผ่านไม่ถูกต้อง", stay on form)
    → getProfile() for the now-fresh session
       (role !== "owner" → "อีเมลหรือรหัสผ่านไม่ถูกต้อง" — same generic message, no leak)
    → update profiles set pin_hash=null, pin_failed_attempts=0, pin_locked_until=null
       where id = profile.id
    → redirect("/job-level")
  → page re-renders, hasPinSet=false → SetOwnerPin (existing, unchanged) → choose new PIN
```

## Error handling

- Wrong email/password: identical generic message to the Login page
  ("อีเมลหรือรหัสผ่านไม่ถูกต้อง") — avoids confirming whether an email exists, consistent with
  `signIn`'s existing behavior in `src/app/actions/auth.ts`.
- Re-authenticated but not an owner: same generic message (no distinct error), so the form gives no
  signal about *why* it failed.
- A "ยกเลิก" (cancel) link/button returns to the normal PIN pad view with no side effects — no
  partial state to clean up since nothing is written until the whole re-auth + role-check +
  pin-clear sequence succeeds.

## Files touched

- `src/app/actions/job-level.ts` — add `resetOwnPinViaPassword` action, alongside the existing
  `setOwnPin`/`verifyOwnPin`/`switchToMember`/`switchWorker`.
- `src/components/job-level/owner-tile.tsx` — extend `VerifyOwnerPin` with a toggle to a new inline
  `ForgotOwnerPinForm` (email + password fields, submit, cancel link). `SetOwnerPin` is unchanged.

No new pages, no new routes, no database migration (reuses existing `pin_hash` /
`pin_failed_attempts` / `pin_locked_until` columns from the original auth-revamp migration).

## Testing

Manual live-browser verification (per the project's established iPad-preview standard, see
[[feedback_live_preview_ipad_standard]]):
1. Owner has a PIN set → tap OWNER tile → tap "ลืม PIN?" → wrong password → generic error shown,
   PIN not cleared (verify by cancelling and confirming the old PIN pad still appears).
2. Correct email+password → redirected → `SetOwnerPin` form appears (not the PIN pad) → set a new
   PIN → lands on dashboard.
3. Re-open job-level, tap OWNER tile, verify the *new* PIN works and the old one doesn't.
4. Attempt with a Manager/Staff's synthetic email (if guessable) + any password → generic error
   (expected to fail at the password step already, since their passwords are random/unknown, but
   confirms no crash).
5. Cancel button returns to PIN pad without clearing anything.
