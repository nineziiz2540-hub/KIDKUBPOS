# Pre-Auth CAPTCHA (Cloudflare Turnstile) — Design

## Problem

`src/app/actions/auth.ts` has no bot protection at all on `signIn`, `signUp`, or
`requestPasswordReset` — confirmed by grepping the whole `src/` tree for
captcha/turnstile/hcaptcha/rate-limit (zero matches). Any of the three public, unauthenticated
forms in `src/app/(auth)/` can be hit an unlimited number of times: `signIn` invites
credential-stuffing/brute-force, `signUp` invites spam-account creation, `requestPasswordReset`
invites mass unsolicited reset emails against arbitrary addresses.

This is the first of a five-item backlog identified in
[[project_login_page_security_gap_analysis]] (2026-08-18); the user is fixing items in that
list's ranked order, starting here.

## Approach

Use Supabase Auth's native CAPTCHA integration (Cloudflare Turnstile) rather than building a
custom verification flow. Supabase Auth already accepts an `options.captchaToken` parameter on
`signInWithPassword`, `signUp`, and `resetPasswordForEmail` — when CAPTCHA protection is enabled
in the Supabase project's Auth settings (a Dashboard toggle, not a code change, done outside this
plan by the user), Supabase itself calls Cloudflare's `siteverify` API server-side using a secret
key configured in *its own* settings. This project's code only ever needs Cloudflare's public
**site key** (safe to expose client-side) and the token Turnstile's widget produces after a user
completes the challenge — never the secret key, which never touches this codebase.

A new shared client component wraps the `@marsidev/react-turnstile` package (a small, typed React
wrapper around Cloudflare's widget script) and is reused identically across all three forms —
Login, Register, Forgot Password (all three per the user's explicit choice; OAuth buttons are a
separate, unaffected code path with their own provider-side bot protection, out of scope here).
Each page holds the resulting token in component state, includes it as a hidden form field, and
resets the widget (Turnstile tokens are single-use) whenever the corresponding server action
returns an error — otherwise a legitimate user's second attempt after a typo would silently fail
CAPTCHA verification on a stale token.

Each of the three server actions gains: (1) a check that a non-empty token was submitted at all
(a request bypassing the widget entirely — e.g. a raw POST — gets rejected before ever reaching
Supabase), and (2) passing that token through as `options.captchaToken` on the corresponding
Supabase Auth call. No new database tables, columns, or RLS changes — this feature has no
persistence layer at all.

**Safe, gradual rollout:** until the user completes the external Cloudflare + Supabase Dashboard
configuration (Cloudflare account → Turnstile widget → site/secret keys → paste secret key into
Supabase's Auth CAPTCHA settings → enable), Supabase's CAPTCHA enforcement stays off at the
platform level, so the code shipping first does not break login for anyone — the widget renders
and a token is collected and sent, but Supabase simply ignores/doesn't require it until the
Dashboard toggle is flipped. This mirrors how the OAuth buttons in this codebase were coded before
Google/Facebook's own dashboards were configured (see [[project_oauth_google_facebook_setup]]).

## Data flow

```
Login/Register/Forgot-Password page (client component)
  → renders <TurnstileWidget> (wraps @marsidev/react-turnstile), holds token in state
  → widget completes → onSuccess(token) → setToken(token)
  → hidden <input name="turnstile_token" value={token} />
  → submit button disabled while token is null
  → form submits (React 19 action) → server action receives FormData including turnstile_token
     → typeof token !== "string" || token === "" → "กรุณายืนยันว่าคุณไม่ใช่บอท"
     → existing validation (email/password format, etc.) unchanged, runs after the token check
     → supabase.auth.{signInWithPassword|signUp|resetPasswordForEmail}(
         ...existing args..., { options: { captchaToken: token } }
       )
     → Supabase validates the token against Cloudflare server-side (once CAPTCHA protection is
       enabled in the Dashboard) — if invalid/expired/reused, Supabase returns an auth error,
       surfaced through each action's existing generic error message (no new Supabase-specific
       error string needs separate handling — a failed CAPTCHA and a failed credential check both
       already fall through to the same catch-all response shape each action already returns)
  → action returns { error } → page's render-time state-sync (same pattern already used by
    void-order-button.tsx/discount's SmartCart in this codebase) detects the new error and calls
    the widget ref's .reset() so the next attempt gets a fresh token
```

## Error handling

- No token submitted (widget never completed, or a request bypassing the client entirely):
  rejected server-side with "กรุณายืนยันว่าคุณไม่ใช่บอท", before any Supabase call — this doubles
  as the mechanism that makes the feature meaningful even for direct API calls that skip the
  rendered page entirely.
- Expired/already-used token: Supabase's own validation rejects it once Dashboard protection is
  enabled; the widget is reset on any action error so the next real attempt works normally.
- Widget fails to load (e.g. ad-blocker, network issue): the submit button stays disabled and a
  short inline note explains why — this is a deliberate fail-closed choice, consistent with this
  project's existing security features (PIN gates, approval triggers) never having a bypass path.

## Files touched

- New dependency: `@marsidev/react-turnstile`.
- New: `src/components/auth/turnstile-widget.tsx` — thin wrapper, `forwardRef` exposing `.reset()`,
  used identically by all three pages.
- Modify: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/register/page.tsx`,
  `src/app/(auth)/forgot-password/page.tsx` — add the widget, hidden token field, disabled-submit
  gating, and reset-on-error wiring.
- Modify: `src/app/actions/auth.ts` — `signIn`, `signUp`, `requestPasswordReset` each gain the
  token presence check and pass `captchaToken` through to their respective Supabase call.
- Modify: `.env.example` — document `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- No migration, no `src/types/database.ts` regeneration — nothing in this feature touches the
  database.

## Testing

Manual live-browser verification (per [[feedback_live_preview_ipad_standard]]):
1. All three pages render the Turnstile widget; submit button stays disabled until the widget
   reports success (Cloudflare's test/dev site keys render a visible, always-passing or
   always-blocking challenge depending on which is used — verify with whichever the user has
   provisioned by the time this is tested).
2. A successful login/signup/reset-request still completes normally with a real token attached
   (confirm via network inspection that `captchaToken` is present in the Supabase Auth request).
3. Submitting with the token cleared via direct DOM manipulation (simulating a bypass attempt) is
   rejected server-side with the Thai error message, before any Supabase call is made.
4. After a failed login attempt (wrong password) with CAPTCHA protection enabled in Supabase's
   Dashboard, the widget visibly resets and a second real attempt with a fresh token succeeds —
   proves the single-use-token reset wiring works, not just that the happy path works once.
5. If the user has not yet completed the external Cloudflare/Supabase Dashboard steps at test
   time, confirm login still works end-to-end regardless (the safe-rollout property) — the widget
   renders and collects a token, but nothing blocks a real user since Supabase isn't enforcing yet.

[[project_login_page_security_gap_analysis]] [[project_oauth_google_facebook_setup]]
