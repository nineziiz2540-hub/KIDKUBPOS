# Owner Two-Factor Authentication (TOTP) — Design

## Problem

Item #5 of [[project_login_page_security_gap_analysis]]: the Owner account — the only role that
can see and change `tenants.promptpay_id` (the shop's PromptPay payout target) plus other
business/financial settings — has no second factor. If an Owner's password is guessed, phished, or
reused from a breach, an attacker gets full control with nothing else to defeat, most seriously the
ability to redirect the shop's QR payments to their own PromptPay number.

This work also closes the residual gap surfaced while designing it:
[[project_tenants_rls_forgery_fix]] proved that app-layer role checks alone are not a real
security boundary against a caller who skips the rendered page and hits Supabase's Data API
directly with a valid session token. A 2FA feature that only gates the Next.js UI would suffer the
exact same problem — an attacker with the Owner's password could still update `tenants` via a
direct API call without ever completing the second factor. This design closes both the UI path and
the API path together, using the same "prove it live" methodology as every other feature this
session.

## Approach

Use Supabase Auth's native MFA API (`supabase.auth.mfa.*`) with **TOTP only** (authenticator apps
— Google Authenticator, Authy, etc.). No SMS (costs money, needs a provider configured) and no
WebAuthn/Passkeys (still BETA on this Supabase project) for this v1.

**Scope: Owner role only, opt-in.** Enrollment lives in Settings (already owner-gated —
`src/app/(shell)/settings/page.tsx:14` redirects any non-owner away). Manager and Staff are
unaffected; nothing about their login changes.

**Enforcement has two independent layers, both required:**

1. **App layer** — after a successful password sign-in, if the account has a verified MFA factor
   and the current session is only at AAL1 (Authenticator Assurance Level 1 — password-only), the
   user is routed to a challenge page instead of the app, and **this check lives in
   `src/proxy.ts` (the existing middleware)**, not just in `signIn`'s post-login redirect. That
   placement is deliberate: gating only the initial redirect would leave a bypass — a user who
   completes password auth then navigates directly to `/pos` or any other URL would reach it
   without ever being challenged, since Supabase itself does not block an AAL1 session from being
   used. The middleware already centrally gates every request for "is there a session at all"
   (`src/proxy.ts:42`); this adds "if elevation is required, is it satisfied" as the same kind of
   central, unbypassable check.

2. **Database layer (RLS)** — a **restrictive** policy on `tenants` requires AAL2 for any `UPDATE`
   when the acting user has a verified MFA factor enrolled, using Supabase's own documented
   pattern (queries `auth.mfa_factors` + `auth.jwt()->>'aal'`). Restrictive policies are ANDed
   with every other policy on the table — they can only ever narrow access, never grant it — which
   is structurally different from (and much lower-risk than) the *permissive* policy class of bug
   fixed in [[project_tenants_rls_forgery_fix]]. Worst case if this policy has a bug is a
   legitimate Owner action being wrongly blocked (a visible, immediately-noticed availability
   issue) — not a silent new hole. Scope for v1: `tenants` only (store name, business settings,
   PromptPay — the exact fields item #5 was raised to protect). Extending the same pattern to
   `profiles.role` updates (`updateMemberRole`) is a reasonable future addition but explicitly out
   of scope here to keep this change focused on what was actually discussed and agreed.

**Recovery — backup codes are a reset mechanism, not a repeatable second factor.** This is the
least obvious part of the design and the main thing to get right. Supabase's AAL is tracked inside
the JWT itself and only advances to `aal2` when Supabase's own `mfa.verify`/`mfa.challengeAndVerify`
succeeds against an enrolled factor — there is no supported way for our own backup-code check
(which lives in our own table, not Supabase's) to "pretend" a TOTP verification happened and
directly elevate a real Supabase-issued JWT. Trying to fake that would mean re-implementing
Supabase's own session/JWT signing, which is out of reach and not something to build custom crypto
for.

Instead: entering a valid backup code **disables MFA entirely** for that account (via the
`admin.auth.admin.mfa.deleteFactor` API, called server-side with the service-role client — the same
`createAdminClient()` used elsewhere in this codebase). Once the factor is removed, Supabase's own
`getAuthenticatorAssuranceLevel()` no longer requires `aal2` for that account (there is nothing
left to elevate to), so the existing `aal1` session is immediately sufficient and the user proceeds
normally — with a clear message that 2FA was turned off by the recovery code and should be
re-enrolled. Backup codes are generated once, at enrollment time, shown in plaintext exactly once
(never stored or retrievable in plaintext again — matches the "save these now" convention used by
GitHub/Google/etc.), hashed with `bcrypt` before storage (mirroring this codebase's existing PIN-hash
convention), and each is usable exactly once.

## Data flow

### Enrollment (Settings page, Owner only)

```
Owner clicks "เปิดใช้งาน 2FA"
  → supabase.auth.mfa.enroll({ factorType: "totp" })
  → returns { id: factorId, totp: { qr_code (SVG data URI), secret, uri } }  — factor is
    "unverified" until confirmed
  → render QR code (<img src={qr_code}>) + manual secret fallback for apps that can't scan
  → Owner scans with their authenticator app, enters the 6-digit code it now shows
  → supabase.auth.mfa.challengeAndVerify({ factorId, code })
     → on success: factor becomes "verified" AND the current session is elevated to aal2 in the
       same call
     → on failure: show error, let them retry (each call issues a fresh challenge)
  → generate 10 backup codes (10-char alphanumeric, cryptographically random), bcrypt-hash each,
    insert into mfa_backup_codes keyed to profile.id
  → show the 10 plaintext codes ONCE with an explicit "save these somewhere safe — each works only
    once, and using one turns off 2FA" warning
```

### Disable (Settings page, Owner only — requires an active aal2 session, matching Supabase's own
requirement to call `mfa.unenroll`)

```
Owner clicks "ปิดใช้งาน 2FA"
  → supabase.auth.mfa.unenroll({ factorId })
  → delete all mfa_backup_codes rows for profile.id (server-side, admin client)
```

### Login challenge (every request, via src/proxy.ts)

```
proxy.ts, after the existing supabase.auth.getUser() call:
  → if isAuthed:
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal.currentLevel !== aal.nextLevel && pathname !== "/mfa-challenge"
          && !isPublicAuthRoute):
        redirect to /mfa-challenge
  (unauthenticated / public-route handling unchanged)
```

```
/mfa-challenge page (new, mirrors the structure of /login):
  → supabase.auth.mfa.listFactors() to get the enrolled factor's id
  → form: 6-digit code input, "ใช้ Backup Code แทน" link toggling to a backup-code input
  → submit (TOTP path): supabase.auth.mfa.challengeAndVerify({ factorId, code })
     → success: session now aal2 → redirect("/")   (proxy.ts's next check passes normally)
     → failure: show error, stay on page
  → submit (backup-code path): server action
     → normalize/hash the submitted code, look up an unused matching row in mfa_backup_codes for
       this profile
     → not found / already used: "รหัสสำรองไม่ถูกต้องหรือถูกใช้ไปแล้ว"
     → found: mark used_at = now(); admin.auth.admin.mfa.deleteFactor({ id: factorId, userId: profile.id })
       (service-role); delete the account's remaining backup-code rows (a removed factor makes
       them moot); redirect("/") with a message that 2FA was disabled by recovery and should be
       re-enrolled
```

## Error handling

- Wrong TOTP code during enrollment or challenge: Supabase's own error, surfaced as a generic
  "รหัสไม่ถูกต้อง กรุณาลองใหม่" — no distinct handling needed, this is a normal expected user error,
  not a security-relevant branch.
- Backup code wrong/already used: generic "รหัสสำรองไม่ถูกต้องหรือถูกใช้ไปแล้ว" — deliberately does not
  distinguish "wrong code" from "already used" (avoids leaking which backup codes have been
  consumed to someone who doesn't already hold a valid one).
- `admin.auth.admin.mfa.deleteFactor` failing during backup-code recovery: this is a genuine failure
  mode worth handling explicitly rather than silently — if the admin call errors, do **not** mark
  the backup code as used (so the Owner can retry) and return a clear error instead of leaving the
  account in a state where the code is burned but the factor wasn't actually removed.
- RLS restrictive policy blocking a legitimate aal1 Owner action after enrollment but before
  completing the login challenge: cannot actually happen given the app-layer gate in `proxy.ts`
  already prevents an aal1 session from reaching any page (including Settings) once MFA is
  enrolled — the two layers are consistent by construction, not by coincidence.

## Files touched

- New migration: `supabase/migrations/<date>_mfa_backup_codes.sql` — creates
  `mfa_backup_codes (id uuid pk default gen_random_uuid(), profile_id uuid references
  profiles(id) on delete cascade, code_hash text not null, used_at timestamptz, created_at
  timestamptz not null default now())`, RLS enabled with zero policies (service-role only, same
  pattern as `login_lockouts`); plus the restrictive AAL2-required policy on `public.tenants`
  for `UPDATE`.
- New: `src/lib/mfa-backup-codes.ts` — generate/hash/verify helpers (mirrors
  `src/lib/login-lockout.ts`'s structure and fail-open-on-DB-error discipline for the parts that
  touch the DB).
- New: `src/app/actions/mfa.ts` — server actions: `enrollMfa`, `confirmMfaEnrollment`,
  `disableMfa`, `verifyMfaChallenge`, `verifyMfaBackupCode`.
- New: `src/app/(auth)/mfa-challenge/page.tsx` — the login-time challenge page.
- New: `src/components/settings/mfa-section.tsx` — Settings UI: current status, enroll flow (QR +
  confirm), backup-codes-shown-once panel, disable flow.
- Modify: `src/app/(shell)/settings/page.tsx` — render the new MFA section (owner-only page, no
  additional guard needed there).
- Modify: `src/proxy.ts` — add the AAL-elevation-required redirect described above.
- Regenerate `src/types/database.ts` after the migration (new table only — no changes to existing
  tables' columns).

## Testing

Live verification against a disposable QA Owner account, mirroring this session's established
exploit-proof methodology (a QA account, real actions, real Supabase state checked before/after,
cleaned up after):

1. Enroll TOTP using a real, generatable code (a TOTP library run locum, e.g. Node's `otplib`,
   fed the same secret returned by `enroll()`, matches what a real authenticator app would show).
   Confirm the factor becomes `verified` and 10 backup codes are returned once.
2. Sign out, sign back in with the correct password — confirm the app now redirects to
   `/mfa-challenge` instead of the app (proves `proxy.ts`'s gate fires), and confirm via a direct
   Data API call in that state that the session is genuinely `aal1` and `tenants` `UPDATE` is
   rejected by the new restrictive policy (proves the DB layer independently of the UI).
3. Complete the challenge with a real generated TOTP code — confirm redirect succeeds and the
   same `tenants` `UPDATE` that was rejected above now succeeds (proves aal2 elevation actually
   unblocks the restrictive policy, not just that the policy exists).
4. Use a saved backup code instead of TOTP on a fresh locked-out session — confirm login proceeds,
   confirm via `execute_sql` that the factor was actually deleted from `auth.mfa_factors`, confirm
   the used backup code is marked `used_at` and a second attempt with the same code fails, and
   confirm the account can now log in normally at aal1 (no more challenge, since no factor remains).
5. Direct-API bypass attempt: with a valid aal1-only session (post-password, pre-challenge),
   attempt `PATCH /rest/v1/tenants` directly — must be rejected — this is the specific scenario
   the whole RLS half of this feature exists to close, so it gets its own explicit proof, not just
   incidental coverage from step 2.
6. Disable 2FA from Settings while at aal2 — confirm the factor and all backup-code rows are gone,
   and a subsequent login no longer challenges.

QA account and all associated `auth.mfa_factors`/`mfa_backup_codes` rows deleted afterward,
confirmed via `select count(*)`.

[[project_login_page_security_gap_analysis]] [[project_tenants_rls_forgery_fix]]
[[feedback_key_patterns]]
