# Login / Auth Revamp — Design Spec

**Status:** Approved by user in brainstorming session, 2026-07-16.

## 1. Overview

Today the app has only email/password sign-in (`signInWithPassword`) and sign-out. There is no
registration, no password reset, no OAuth, and no self-service way to provision a `profiles` row —
every tenant/profile in the database today was created by hand outside the app.

This spec covers two connected pieces, built in one initiative because the second depends on
decisions made in the first:

- **Part A — Owner Registration & Login.** A real self-service signup (creates a brand-new
  tenant, the registrant becomes its `owner`), forgot/reset password via Supabase's standard
  email-link flow, and OAuth buttons wired but inert until the user configures provider apps.
- **Part B — Job Level + PIN gate.** After the shared POS device has an authenticated session
  (established once via Part A), a `/job-level` screen lets whoever is physically at the device
  identify themselves as Owner, or as one of the Manager/Staff profiles the Owner has provisioned,
  by 6-digit PIN. Manager and Staff never get an email/password login of their own — the Owner
  creates their profile + PIN from Settings → Team.

Reference screenshots (provided by user): a generic "Welcome Back / Registration / Forgot
Password / Reset Password / Password Changed" auth-flow kit, and a POS-style "Cashier Login"
kit (avatar/name picker + PIN keypad + "Forgot PIN?" + "Start Shift"). Both are used as visual
inspiration only — see Section 7 for the one deliberate behavioral deviation from the reference
(PIN reset never re-sends the old PIN).

## 2. Confirmed Decisions (from brainstorming)

| Question | Decision |
|---|---|
| What happens to "tenant" on signup? | Register always creates a brand-new tenant; registrant becomes its `owner`. |
| What is the PIN, really? | PIN belongs to Manager/Staff profiles the Owner provisions — not a personal 2FA for existing account holders. |
| When does the Job Level screen appear relative to email/password login? | After the device has logged in with email/password once (persists) — Job Level+PIN is the per-session "who's using it now" gate, not a replacement for the real login. |
| Does Staff's PIN actually restrict access, or is it just attribution? | Must actually restrict — Staff should only reach Dashboard/POS/Orders/Shifts. (Turned out to already be true almost everywhere — see Section 6.) |
| OAuth (Google/Facebook) — build now? | Wire the buttons and the code path now; actual provider config (Google Cloud Console / Facebook Developers + pasting Client ID/Secret into Supabase Dashboard) is the user's own follow-up outside this work. |
| Manager/Staff forgot PIN? | Owner resets it from the Team page. No email-based self-service recovery for Staff/Manager. |
| Where is the new tenant's store name collected? | Added as a field directly on the `/register` form. |
| Multiple Staff in one tenant — one shared PIN or per-person? | Per-person, with a name list under the "STAFF" tile (also needed for `shifts.opened_by` attribution). |

## 3. Data Model Changes

New migration `supabase/migrations/<timestamp>_auth_revamp.sql`:

```sql
alter table public.profiles
  add column pin_hash text,
  add column recovery_contact text,
  add column auth_managed boolean not null default true,
  add column pin_failed_attempts int not null default 0,
  add column pin_locked_until timestamptz;

comment on column public.profiles.pin_hash is
  'bcrypt hash of the 6-digit PIN used at the /job-level gate. Null until first set.';
comment on column public.profiles.recovery_contact is
  'Free-text contact info (phone, etc.) shown to the owner on the Team page. Never emailed automatically.';
comment on column public.profiles.auth_managed is
  'true = this profile''s auth.users row belongs to the person themselves (Owner via signup).
   false = the auth.users row is a synthetic account created by the Owner for Manager/Staff PIN login.';
comment on column public.profiles.pin_failed_attempts is
  'Consecutive wrong-PIN count at /job-level. Reset to 0 on a correct attempt.';
comment on column public.profiles.pin_locked_until is
  'If set and in the future, PIN attempts for this profile are rejected until this time.';
```

**Rate limiting is DB-backed, not in-memory:** this app deploys to Vercel, where each request can
land on a different serverless instance — an in-memory attempt counter would not reliably persist
between requests and could not be trusted to enforce a lockout at all. `pin_failed_attempts` /
`pin_locked_until` on `profiles` make the counter durable and correct regardless of which instance
handles the next request.

No RLS policy changes are needed: all new columns are read/written exclusively through
`SECURITY DEFINER` functions and server actions running under the caller's existing role checks
(Section 4/5), never through a direct client-side `update()` call against `profiles`.

New Postgres function, same file:

```sql
create or replace function public.create_tenant_and_owner(
  p_user_id   uuid,
  p_store_name text
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_tenant_id uuid;
  v_slug text;
begin
  v_slug := lower(regexp_replace(p_store_name, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || substr(md5(random()::text), 1, 6);

  insert into public.tenants (name, slug)
  values (p_store_name, v_slug)
  returning id into v_tenant_id;

  insert into public.profiles (id, tenant_id, role, auth_managed)
  values (p_user_id, v_tenant_id, 'owner', true);

  return v_tenant_id;
end;
$$;
```

This mirrors the existing `generate_order_number`/`deduct_stock_for_order` pattern (atomic,
`SECURITY DEFINER`, called via `supabase.rpc(...)`).

## 4. Part A — Register / Login / Forgot Password (Owner)

**New pages:**

| Route | Purpose |
|---|---|
| `/register` | Store name, email, password, confirm password, Google/Facebook buttons (inert). |
| `/forgot-password` | Email field → triggers Supabase's `resetPasswordForEmail`. |
| `/reset-password` | Landed on via the emailed link; new password + confirm; success state. |
| `/auth/callback` | Route handler exchanging an OAuth code for a session (`exchangeCodeForSession`) — inert until OAuth is configured, but the code path is complete. |

**New server actions (`src/app/actions/auth.ts`, extending the existing file):**

- `signUp(prevState, formData)` — validates password match, calls
  `supabase.auth.signUp({ email, password })`, then `supabase.rpc('create_tenant_and_owner', { p_user_id: user.id, p_store_name: storeName })`, then redirects to `/job-level` (first-time PIN setup, Section 5).
- `requestPasswordReset(prevState, formData)` — `supabase.auth.resetPasswordForEmail(email, { redirectTo: <origin>/reset-password })`. Always returns the same generic success message regardless of whether the email exists, to avoid leaking which emails are registered.
- `updatePassword(prevState, formData)` — called from `/reset-password` once Supabase's recovery session is active; `supabase.auth.updateUser({ password })`.
- `signInWithOAuth` is **not** a server action — it's a client-side call
  (`supabase.auth.signInWithOAuth({ provider, options: { redirectTo: <origin>/auth/callback } })`)
  triggered directly from the Register/Login page's Google/Facebook buttons, since it must redirect
  the browser to the provider.

**"Remember me" — deliberate deviation from the literal request:** the app will not store raw
passwords anywhere itself (this is a hard security rule — see the "Prohibited actions" boundary
around plaintext credentials). Instead: login/register fields get correct
`autoComplete="username"` / `autoComplete="current-password"` / `autoComplete="new-password"`
attributes so each browser's own password manager can offer to remember them, and the existing
Supabase session (refresh-token cookie) already persists across browser restarts by default — so
in practice nobody re-enters credentials on the same device anyway.

## 5. Part B — Team Management Extension (Owner adds Manager/Staff)

`profiles.full_name` already exists — no new name column needed.

**`/settings/team` gets a "+ เพิ่มพนักงาน" button** opening a form:
- `full_name` (text, required)
- `role` — Manager / Staff (Owner cannot create another Owner from here)
- `pin` + `pin_confirm` (6 digits each)
- `recovery_contact` (optional free text)

**New server action `createTeamMember` (`src/app/actions/settings.ts`):**
1. Reject unless caller's own profile role is `owner`.
2. Validate `pin === pin_confirm`, exactly 6 digits.
3. Check the PIN isn't already in use by another profile in the same tenant (bcrypt-compare
   against every existing `pin_hash` in the tenant — tenant team sizes are small, a full scan is
   fine; no plaintext PIN index exists to query directly).
4. Using a service-role client (`src/lib/supabase/admin.ts`, new file, reads
   `SUPABASE_SERVICE_ROLE_KEY` — already a documented env var in `.env.example`, just unused until
   now): `admin.createUser({ email: synthetic, password: <discarded random>, email_confirm: true })`.
5. Insert the new `profiles` row: `full_name`, `role`, `tenant_id` (caller's own), `pin_hash`
   (bcrypt of the PIN), `recovery_contact`, `auth_managed = false`.

**Team list page** shows `full_name`, `role`, and a "ตั้ง PIN ใหม่" button per row → small form
(new PIN + confirm) → `resetTeamMemberPin` action (same owner-only + uniqueness checks, just
updates `pin_hash`).

## 6. Part C — Job Level + PIN Screen (runtime gate)

**Existing role-gating already does most of the work.** Grepping `profile.role` across
`src/app`, every back-office page/action (Products, Categories, Modifiers, Customers, Inventory,
all of Settings) already redirects/rejects anyone who isn't `owner` or `manager` via the
`isManagerOrOwner()` helper or an inline check. Staff has never been able to reach those pages —
this was already built defensively even before Staff had a way to log in. **No new
per-page role checks are needed**; this section is purely about the identity-switch mechanism
itself.

**New route `/job-level`:**
- Three tiles: OWNER / MANAGER / STAFF, styled per the existing Figma brand system.
- **OWNER tile:** if the caller's own `profiles.pin_hash` is null (first time after registering),
  show "ตั้งรหัส PIN ของคุณ" (6 digits + confirm) instead of a keypad; on success, set the hash and
  proceed. If already set, show a 6-digit keypad; correct PIN sets the `worker_verified` cookie
  (below) and redirects to `/` — no session-switch needed, the caller already *is* the active
  Supabase session.
- **MANAGER / STAFF tile:** lists `full_name` of every profile in the tenant with that role
  (empty state + disabled tile if none exist yet — "ให้ Owner เพิ่มพนักงานที่ตั้งค่า > ทีมงาน").
  Picking a name shows their PIN keypad. Correct PIN triggers the session-switch server action
  below, then redirects to `/`.

**Session-switch mechanism (shared by all three tiles when switching identity):**
1. Before checking the PIN: if `pin_locked_until` is set and still in the future, reject
   immediately with "ลองใหม่ในอีก N วินาที" (no bcrypt compare attempted).
2. Otherwise, compare the submitted PIN against `pin_hash` (bcrypt).
   - Wrong: increment `pin_failed_attempts`; if it now reaches 5, set
     `pin_locked_until = now() + interval '30 seconds'` and reset `pin_failed_attempts` to 0 for
     the next window. Reject with the generic "รหัสไม่ถูกต้อง" message.
   - Correct: reset `pin_failed_attempts` to 0 and clear `pin_locked_until`, then proceed to step 3.
3. On success, using the service-role client: `admin.generateLink({ type: 'magiclink', email: target.email })`, then immediately `verifyOtp({ token_hash, type: 'magiclink' })` on a server-side Supabase client to mint a real session for the target profile, and write that session into the response cookies via the existing `@supabase/ssr` server client helper.
4. Set the `worker_verified` cookie (httpOnly, short opaque value, no PII) and redirect to `/`.

**`worker_verified` cookie semantics:**
- Shell layout (`src/app/(shell)/layout.tsx`) already redirects unauthenticated visitors to
  `/login`. It gains one more check: authenticated but missing `worker_verified` → redirect to
  `/job-level`.
- A new "สลับผู้ใช้งาน" (switch worker) button next to the existing Logout button clears only
  this cookie and redirects to `/job-level` — the underlying Supabase session is untouched, so the
  next person doesn't need Owner's password re-entered.
- The existing `signOut` action (unchanged) clears everything and returns to `/login`, as today.

## 7. Security Notes / Deliberate Deviations from the Reference Screenshots

- **PINs are stored as bcrypt hashes, never plaintext.** The Makaryo reference's "Forgot PIN? Enter
  your email to receive your PIN" implies emailing back the *original* PIN — that's only possible
  if the PIN is stored in recoverable/plaintext form, which is a real security anti-pattern (same
  class of mistake as storing passwords in plaintext). This spec deliberately does **not** do
  that: since Manager/Staff never have their own login, PIN recovery is Owner-mediated
  (Section 5) — nothing is ever emailed automatically.
- **No credentials are stored client-side by the app.** "Remember ID/Password" is delivered via
  browser-native autocomplete + persistent Supabase sessions (Section 4), not app-managed storage.
- **Service-role key usage is confined to two new server-only files**
  (`src/lib/supabase/admin.ts`, and the server actions that import it) — never sent to the client,
  never used in a Client Component.
- **Synthetic Manager/Staff passwords are generated and discarded immediately** — nothing needs to
  remember them, since all subsequent "logins" for those accounts go through the magic-link+verify
  mechanism server-side, not a password.

## 8. Out of Scope

- Actually configuring Google/Facebook OAuth apps (external, user's own follow-up).
- Any change to existing page-level role gating (Products/Inventory/etc.) — already correct.
- Multi-tenant "join an existing tenant via invite code" flow — explicitly rejected in favor of
  "register always creates a new tenant."
- Self-service PIN recovery via email for Manager/Staff — explicitly rejected in favor of
  Owner-mediated reset.

## 9. Testing / Verification Plan

- `npx tsc --noEmit` after each task.
- Live browser verification (per this project's established practice — hydration-class bugs have
  repeatedly only surfaced via real page loads, not `tsc`/`build`): full walk of Register → first
  login → set Owner PIN → reach Dashboard; Owner creates a Staff member with a PIN from Team →
  "switch worker" → Staff tile → correct PIN → confirm Staff cannot reach `/inventory` or
  `/settings` (redirects) and can reach `/`, `/pos`, `/orders`, `/shifts`; wrong PIN 5x triggers the
  30-second lockout; Forgot Password email-link round trip end to end.
