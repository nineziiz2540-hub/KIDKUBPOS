# Login Attempt Lockout — Design

## Problem

`signIn` in `src/app/actions/auth.ts` and `resetOwnPinViaPassword` in `src/app/actions/job-level.ts`
both call `supabase.auth.signInWithPassword` with zero failed-attempt tracking. Both are now gated
by Cloudflare Turnstile CAPTCHA ([[project_login_captcha_feature]]), which blocks high-volume
automated brute force, but a human (or a CAPTCHA-solving service) can still work through a short
list of likely passwords against one target account without any friction beyond solving a CAPTCHA
each time. This is item #2 of the ranked backlog in
[[project_login_page_security_gap_analysis]] — the PIN system already has this kind of protection
(`pin_failed_attempts`/`pin_locked_until`, 5 attempts / 30s lockout, keyed by `profiles.id`); the
email/password login layer has never had an equivalent.

## Approach

New table `login_lockouts`, keyed by **normalized email** (trimmed + lowercased), not
`profiles.id`. This is a deliberate departure from the PIN system's pattern: the PIN system always
has a known `profile.id` in hand (the user is already authenticated by that point), but a
password-guessing attempt often targets an email with **no** matching account, or happens before
we've resolved the email to a user id at all — keying by the submitted email string sidesteps an
extra admin lookup and works uniformly whether or not the account exists.

Email normalization is load-bearing, not cosmetic: Supabase treats email matching as
case-insensitive, so if the lockout key isn't normalized the same way, an attacker can bypass the
whole feature by varying letter case on each attempt (`User@x.com`, `user@X.com`, ...), each one
landing on a fresh, un-throttled row.

The table is written via the **admin/service-role client** (`createAdminClient()`, already used
elsewhere in this codebase for pre-session privileged writes — see `signUp`'s cleanup path and
`resetOwnPinViaPassword`'s cross-user profile update). RLS is enabled with **zero policies** — no
anon or authenticated key can read or write this table via the Data API under any circumstance;
only server-side code holding the service-role key can touch it. This follows the same reasoning
as this session's `[[feedback_key_patterns]]` lesson (avoid exposing a policy to the Data API when
server-only access is sufficient) and sidesteps the whole class of Data-API-forgery bug found
repeatedly elsewhere in this codebase (void/discount/refund) — there's no `WITH CHECK` to forget
if there's no policy at all.

**Shared between two call sites.** Both `signIn` (`src/app/actions/auth.ts`) and
`resetOwnPinViaPassword` (`src/app/actions/job-level.ts`) call
`supabase.auth.signInWithPassword` with a raw email/password — the Owner's "ลืม PIN?" flow is a
second, equally viable path to guess a password, so it must share the exact same lockout state
(same table, same key) or an attacker simply switches forms to dodge the counter. This mirrors a
gap the CAPTCHA feature's final review caught after the fact
([[project_login_captcha_feature]]) — building it in from the start this time rather than waiting
for a review round to find it.

A small shared helper, `checkAndRecordLoginAttempt` (new file `src/lib/login-lockout.ts`), wraps
the check-before / record-after logic so both call sites stay in sync automatically instead of
duplicating the increment/lock logic twice and risking drift.

## Data flow

```
signIn / resetOwnPinViaPassword (server action)
  → normalize email = email.trim().toLowerCase()
  → checkLockout(email): admin.from("login_lockouts").select(...).eq("email", email).maybeSingle()
     → if locked_until is in the future:
         return { error: "บัญชีถูกล็อกชั่วคราว ลองใหม่ในอีก N นาที" }   (N = ceil minutes remaining)
         — no call to signInWithPassword at all; a locked account can't burn a real auth attempt
           or a CAPTCHA token for nothing
  → supabase.auth.signInWithPassword({ email, password, options: { captchaToken } })
  → on failure (any error other than captcha_failed, which is unrelated to credential guessing):
       recordFailure(email):
         attempts = (existing row's failed_attempts ?? 0) + 1
         if attempts >= 5:
           upsert { email, failed_attempts: 0, locked_until: now + 15min }
           return { error: "บัญชีถูกล็อกชั่วคราว ลองใหม่ในอีก 15 นาที" }
         else:
           upsert { email, failed_attempts: attempts, locked_until: null }
           return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" }   (unchanged existing message)
  → on success:
       admin.from("login_lockouts").delete().eq("email", email)   (best-effort, do not block login on this)
       proceed with existing success path (redirect, profile lookup, etc.)
```

`captcha_failed` errors are excluded from the failure count — a rejected CAPTCHA says nothing
about whether the submitted password was right or wrong, and counting it would let an attacker
burn through a victim's lockout budget for free by deliberately failing CAPTCHA (a denial-of-
service angle worth closing from the start, same spirit as the `over_email_send_rate_limit`
exemption already applied in `requestPasswordReset`).

## Error handling

- **Locked out**: explicit Thai message stating the account is temporarily locked and how many
  minutes remain — the user's explicit choice, prioritizing clarity for a legitimate user who
  forgot their password over hiding the lockout state from a potential attacker (an attacker who
  has already triggered 5 failures already knows the account exists from context, so this doesn't
  meaningfully worsen enumeration risk beyond what's already true).
- **Wrong credentials, not yet locked**: unchanged existing generic message
  ("อีเมลหรือรหัสผ่านไม่ถูกต้อง"), so nothing about this feature is observable until the threshold
  is actually crossed.
- **CAPTCHA failure**: unchanged existing distinct message, explicitly excluded from the failure
  counter as described above.
- **Successful login**: clears any lockout row for that email. A delete failure here (e.g.
  transient DB error) must not block the login itself — best-effort, matching this codebase's
  existing "best-effort stock deduction" precedent for non-critical side effects
  ([[feedback_key_patterns]]).
- **Lockout table itself unreachable** (transient DB error on the check or the record step): fail
  open, not closed. A read/write error against `login_lockouts` must never block or corrupt the
  actual `signInWithPassword` call or its result — this feature is a hardening layer on top of
  real auth, not a replacement for it, and a database hiccup here must never turn into a login
  outage. Both helper functions catch and log their own errors internally rather than throwing.

## Files touched

- New migration: `supabase/migrations/20260820120000_login_lockouts.sql` — creates
  `login_lockouts (email text primary key, failed_attempts integer not null default 0,
  locked_until timestamptz, updated_at timestamptz not null default now())`, `ENABLE ROW LEVEL
  SECURITY`, no policies.
- New: `src/lib/login-lockout.ts` — `checkLoginLockout(email)` and `recordLoginResult(email,
  succeeded)` helpers, both taking an admin client instance, shared by both call sites.
- Modify: `src/app/actions/auth.ts` — `signIn` calls the helper before and after
  `signInWithPassword`.
- Modify: `src/app/actions/job-level.ts` — `resetOwnPinViaPassword` calls the same helper the same
  way.
- Regenerate `src/types/database.ts` after the migration (via the project's normal Supabase
  type-generation step) so the new table is typed for the admin client.

## Testing

Manual live-browser verification against a disposable QA account, mirroring this session's
established exploit-proof methodology:
1. Five consecutive wrong-password attempts on `/login` lock the account; a 6th attempt (even with
   the correct password) is rejected with the "locked, try again in N minutes" message, without a
   real `signInWithPassword` call being made (confirm via Supabase auth logs — no new
   `invalid_credentials` log entry on the 6th attempt).
2. Confirm the same 5-attempt lockout triggers identically via the Owner's "ลืม PIN?" form
   (`resetOwnPinViaPassword`), and that failures accumulated on one form carry over and lock out
   the other (proves the shared table/key actually shares state, not just parallel copies of the
   same logic).
3. A successful login before reaching the threshold clears the counter (verify by checking the
   `login_lockouts` row is gone, then confirming a fresh set of failed attempts starts counting
   from zero, not resuming a stale partial count).
4. Confirm a `captcha_failed` response does not increment the counter (submit with a deliberately
   invalid Turnstile token several times, then confirm a subsequent real wrong-password attempt is
   still only "attempt 1", not further along).
5. Email-case bypass check: fail login 5 times using varied casing of the same email
   (`User@x.com`, `user@X.com`, ...) and confirm they still count toward the same lockout (not 5
   separate un-throttled rows).
6. Confirm the `login_lockouts` table is unreachable via the public Data API with the anon key
   (direct `fetch`/`curl` against `/rest/v1/login_lockouts` returns a permission error), proving
   the "no policies at all" RLS approach actually holds.

[[project_login_page_security_gap_analysis]] [[project_login_captcha_feature]]
[[feedback_key_patterns]]
