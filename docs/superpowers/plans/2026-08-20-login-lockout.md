# Login Attempt Lockout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock out email/password login attempts (both the main Login page and the Owner's "ลืม PIN?" flow) after 5 consecutive failures against the same normalized email, for 15 minutes.

**Architecture:** A new `login_lockouts` table (keyed by lowercased/trimmed email, zero RLS policies, service-role-only access) backs a small shared helper module used by both `signIn` and `resetOwnPinViaPassword`. The helper fails open on its own DB errors so a lockout-table hiccup never blocks real login.

**Tech Stack:** Supabase Postgres (new table + migration), Next.js Server Actions (existing `signIn`/`resetOwnPinViaPassword`), `@supabase/supabase-js` admin client (already used elsewhere in this codebase).

## Global Constraints

- Lockout threshold: **5** consecutive failed attempts. Lockout duration: **15 minutes**. These are
  the user's explicitly chosen values — do not adjust.
- Lockout key is the **normalized email** (`email.trim().toLowerCase()`), never `profiles.id` and
  never the raw as-submitted email string. This must be applied identically everywhere the key is
  computed (check, record-failure, record-success) or the lockout can be trivially bypassed by case
  variation.
- The `login_lockouts` table gets `ENABLE ROW LEVEL SECURITY` with **no policies created at all** —
  not even a restrictive one. All reads/writes happen exclusively through `createAdminClient()`
  (service-role key), which bypasses RLS entirely. Do not add an anon or authenticated policy "just
  in case."
- A `captcha_failed` error from `signInWithPassword` must **never** increment the failure counter —
  it says nothing about whether the password was correct, and counting it would let an attacker
  burn a victim's lockout budget for free.
- Both DB-touching helper functions must **fail open**: if the `login_lockouts` read or write itself
  errors (e.g. transient DB issue), log the error and treat it as "not locked" / "recording
  skipped" — never throw, never let it block or corrupt the real `signInWithPassword` call or its
  result.
- `src/types/database.ts` must be regenerated via the Supabase MCP `generate_typescript_types` tool
  and overwritten wholesale after the migration is applied — never hand-edited.
- The existing generic wrong-credentials message (`"อีเมลหรือรหัสผ่านไม่ถูกต้อง"`) and the existing
  CAPTCHA-failure message must stay byte-for-byte unchanged; only a NEW locked-out message is added.

---

### Task 1: `login_lockouts` table + migration

**Files:**
- Create: `supabase/migrations/20260820120000_login_lockouts.sql`
- Modify: `src/types/database.ts` (regenerate wholesale — do not hand-edit)

**Interfaces:**
- Produces: table `public.login_lockouts` with columns `email text primary key`,
  `failed_attempts integer not null default 0`, `locked_until timestamptz`,
  `updated_at timestamptz not null default now()`. No RLS policies. Later tasks read/write it only
  through `createAdminClient()`.

- [ ] **Step 1: Write the migration SQL**

```sql
create table public.login_lockouts (
  email text primary key,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.login_lockouts is
  'Tracks failed email/password login attempts, keyed by normalized (trim+lowercase) email.
   Shared by signIn and resetOwnPinViaPassword (see src/lib/login-lockout.ts) so an attacker
   cannot dodge the counter by switching between the two forms. Written exclusively via the
   service-role admin client — RLS is enabled with zero policies, so the anon/authenticated
   Data API can never read or write this table under any circumstance.';

alter table public.login_lockouts enable row level security;
```

- [ ] **Step 2: Apply the migration to the live Supabase project**

Call the Supabase MCP `apply_migration` tool for project `khgahdjfkzpgsvbhfrqx` with the exact SQL
from Step 1 (name it `login_lockouts`).

- [ ] **Step 3: Save the migration file**

Create `supabase/migrations/20260820120000_login_lockouts.sql` with the exact SQL from Step 1
(including the comment).

- [ ] **Step 4: Regenerate `src/types/database.ts`**

Call the Supabase MCP `generate_typescript_types` tool for project `khgahdjfkzpgsvbhfrqx` and
overwrite `src/types/database.ts` with the returned content in full. Verify afterward that
`Database["public"]["Tables"]["login_lockouts"]["Row"]` exists with fields `email`,
`failed_attempts`, `locked_until`, `updated_at`.

- [ ] **Step 5: Verify RLS actually blocks the Data API**

Using `curl` (or the Bash tool) against the project's REST endpoint with the **anon** key (never
the service-role key) — e.g.
`curl -s "https://khgahdjfkzpgsvbhfrqx.supabase.co/rest/v1/login_lockouts?select=*" -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>"`
— confirm the response is a permission error (empty result due to RLS with no policies), not table
data. This is the live proof the Global Constraint's "no Data API access at all" claim is actually
true, not just assumed.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260820120000_login_lockouts.sql src/types/database.ts
git commit -m "feat(auth): add login_lockouts table for email/password lockout"
```

---

### Task 2: Shared lockout helper

**Files:**
- Create: `src/lib/login-lockout.ts`

**Interfaces:**
- Consumes: `Database["public"]["Tables"]["login_lockouts"]` (from Task 1's regenerated types), a
  `SupabaseClient<Database>` instance created via `createAdminClient()` from
  `src/lib/supabase/admin.ts` (existing helper, signature `createAdminClient(): SupabaseClient<Database>`).
- Produces:
  - `normalizeEmail(email: string): string` — `email.trim().toLowerCase()`.
  - `checkLoginLockout(admin: SupabaseClient<Database>, email: string): Promise<{ locked: true; minutesLeft: number } | { locked: false }>`
  - `recordLoginFailure(admin: SupabaseClient<Database>, email: string): Promise<{ lockedOut: true; minutesLeft: number } | { lockedOut: false }>`
  - `clearLoginLockout(admin: SupabaseClient<Database>, email: string): Promise<void>`

  These four exports are consumed by Task 3 (`signIn`) and Task 4 (`resetOwnPinViaPassword`) —
  their exact names and return shapes are load-bearing; do not rename or reshape them without
  updating both call sites.

- [ ] **Step 1: Write `src/lib/login-lockout.ts`**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function checkLoginLockout(
  admin: SupabaseClient<Database>,
  email: string
): Promise<{ locked: true; minutesLeft: number } | { locked: false }> {
  try {
    const { data, error } = await admin
      .from("login_lockouts")
      .select("locked_until")
      .eq("email", email)
      .maybeSingle();
    if (error) {
      console.error("checkLoginLockout: read failed, failing open:", error);
      return { locked: false };
    }
    if (data?.locked_until && new Date(data.locked_until) > new Date()) {
      const minutesLeft = Math.ceil(
        (new Date(data.locked_until).getTime() - Date.now()) / 60000
      );
      return { locked: true, minutesLeft };
    }
    return { locked: false };
  } catch (err) {
    console.error("checkLoginLockout: unexpected error, failing open:", err);
    return { locked: false };
  }
}

export async function recordLoginFailure(
  admin: SupabaseClient<Database>,
  email: string
): Promise<{ lockedOut: true; minutesLeft: number } | { lockedOut: false }> {
  try {
    const { data: existing } = await admin
      .from("login_lockouts")
      .select("failed_attempts")
      .eq("email", email)
      .maybeSingle();

    const attempts = (existing?.failed_attempts ?? 0) + 1;
    const lockedOut = attempts >= LOCKOUT_THRESHOLD;
    const lockedUntil = lockedOut
      ? new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString()
      : null;

    const { error } = await admin.from("login_lockouts").upsert({
      email,
      failed_attempts: lockedOut ? 0 : attempts,
      locked_until: lockedUntil,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error("recordLoginFailure: write failed:", error);
      return { lockedOut: false };
    }

    return lockedOut ? { lockedOut: true, minutesLeft: LOCKOUT_MINUTES } : { lockedOut: false };
  } catch (err) {
    console.error("recordLoginFailure: unexpected error:", err);
    return { lockedOut: false };
  }
}

export async function clearLoginLockout(
  admin: SupabaseClient<Database>,
  email: string
): Promise<void> {
  try {
    const { error } = await admin.from("login_lockouts").delete().eq("email", email);
    if (error) {
      console.error("clearLoginLockout: delete failed (non-blocking):", error);
    }
  } catch (err) {
    console.error("clearLoginLockout: unexpected error (non-blocking):", err);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors related to `src/lib/login-lockout.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/login-lockout.ts
git commit -m "feat(auth): add shared login-lockout helper"
```

---

### Task 3: Wire lockout into `signIn`

**Files:**
- Modify: `src/app/actions/auth.ts:10-40` (the `signIn` function)

**Interfaces:**
- Consumes: `normalizeEmail`, `checkLoginLockout`, `recordLoginFailure`, `clearLoginLockout` from
  `src/lib/login-lockout.ts` (Task 2); `createAdminClient` from `src/lib/supabase/admin.ts`
  (existing).

The current `signIn` function (for reference — do not paste this as the target, only as the
starting point to diff against):

```ts
export async function signIn(
  prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = formData.get("email");
  const password = formData.get("password");
  const turnstileToken = formData.get("turnstile_token");

  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "กรุณากรอกอีเมลและรหัสผ่าน" };
  }
  if (typeof turnstileToken !== "string" || turnstileToken === "") {
    return { error: "กรุณายืนยันว่าคุณไม่ใช่บอท" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: turnstileToken },
  });

  if (error) {
    if (error.code === "captcha_failed") {
      return { error: "ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่" };
    }
    return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  }

  redirect("/");
}
```

- [ ] **Step 1: Add imports and the lockout check + record calls**

Replace the function body with:

```ts
export async function signIn(
  prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = formData.get("email");
  const password = formData.get("password");
  const turnstileToken = formData.get("turnstile_token");

  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "กรุณากรอกอีเมลและรหัสผ่าน" };
  }
  if (typeof turnstileToken !== "string" || turnstileToken === "") {
    return { error: "กรุณายืนยันว่าคุณไม่ใช่บอท" };
  }

  const normalizedEmail = normalizeEmail(email);
  const admin = createAdminClient();

  const lockout = await checkLoginLockout(admin, normalizedEmail);
  if (lockout.locked) {
    return { error: `บัญชีถูกล็อกชั่วคราว ลองใหม่ในอีก ${lockout.minutesLeft} นาที` };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: turnstileToken },
  });

  if (error) {
    if (error.code === "captcha_failed") {
      return { error: "ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่" };
    }
    const result = await recordLoginFailure(admin, normalizedEmail);
    if (result.lockedOut) {
      return { error: `บัญชีถูกล็อกชั่วคราว ลองใหม่ในอีก ${result.minutesLeft} นาที` };
    }
    return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  }

  await clearLoginLockout(admin, normalizedEmail);
  redirect("/");
}
```

Add to the top of `src/app/actions/auth.ts`, alongside the existing imports:

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkLoginLockout,
  clearLoginLockout,
  normalizeEmail,
  recordLoginFailure,
} from "@/lib/login-lockout";
```

(If `createAdminClient` is already imported in this file, do not duplicate the import line.)

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/auth.ts
git commit -m "feat(auth): apply login lockout to signIn"
```

---

### Task 4: Wire lockout into `resetOwnPinViaPassword`

**Files:**
- Modify: `src/app/actions/job-level.ts:105-156` (the `resetOwnPinViaPassword` function)

**Interfaces:**
- Consumes: the same four exports from `src/lib/login-lockout.ts` as Task 3. `createAdminClient`
  is already imported in this file (used by `switchToMember`) — do not duplicate the import.

Current function (reference only, diff against this):

```ts
export async function resetOwnPinViaPassword(
  prevState: PinState,
  formData: FormData
): Promise<PinState> {
  const email = formData.get("email");
  const password = formData.get("password");
  const turnstileToken = formData.get("turnstile_token");
  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "กรุณากรอกอีเมลและรหัสผ่าน" };
  }
  if (typeof turnstileToken !== "string" || turnstileToken === "") {
    return { error: "กรุณายืนยันว่าคุณไม่ใช่บอท" };
  }

  const supabase = await createClient();
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: turnstileToken },
  });
  if (signInError || !signInData.user) {
    return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", signInData.user.id)
    .single();

  if (!profile || profile.role !== "owner") {
    await supabase.auth.signOut();
    (await cookies()).delete(WORKER_COOKIE);
    return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  }

  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update({ pin_hash: null, pin_failed_attempts: 0, pin_locked_until: null })
    .eq("id", profile.id)
    .select("id");
  if (updateError || !updated || updated.length === 0) {
    console.error(
      "resetOwnPinViaPassword: failed to clear pin_hash:",
      updateError ?? "update matched 0 rows (RLS rejected or row missing)"
    );
    return { error: "รีเซ็ต PIN ไม่สำเร็จ" };
  }

  (await cookies()).delete(WORKER_COOKIE);
  redirect("/job-level");
}
```

**Important distinction, easy to get wrong:** only a `signInWithPassword` failure itself (wrong
email/password) is credential-guessing and must call `recordLoginFailure`. The separate branch
where `signInWithPassword` *succeeds* but the account isn't an owner (`if (!profile ||
profile.role !== "owner")`) is NOT a credential-guessing failure — it means someone authenticated
with a genuinely correct email+password (their own real account, e.g. a manager or staff member
who clicked "ลืม PIN?" by mistake). Counting that against the lockout counter would let a
non-owner accidentally lock themselves (or anyone sharing that email) out of the *main* login page
just for trying this owner-only form with their own valid credentials — a self-inflicted denial of
service, not a security improvement. **Do not call `recordLoginFailure` on the not-owner branch.**
It keeps its existing behavior (return the generic error, sign out, clear the worker cookie)
completely unchanged.

- [ ] **Step 1: Apply the lockout check + record calls**

Replace the function body with:

```ts
export async function resetOwnPinViaPassword(
  prevState: PinState,
  formData: FormData
): Promise<PinState> {
  const email = formData.get("email");
  const password = formData.get("password");
  const turnstileToken = formData.get("turnstile_token");
  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "กรุณากรอกอีเมลและรหัสผ่าน" };
  }
  if (typeof turnstileToken !== "string" || turnstileToken === "") {
    return { error: "กรุณายืนยันว่าคุณไม่ใช่บอท" };
  }

  const normalizedEmail = normalizeEmail(email);
  const admin = createAdminClient();

  const lockout = await checkLoginLockout(admin, normalizedEmail);
  if (lockout.locked) {
    return { error: `บัญชีถูกล็อกชั่วคราว ลองใหม่ในอีก ${lockout.minutesLeft} นาที` };
  }

  const supabase = await createClient();
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: turnstileToken },
  });
  if (signInError) {
    if (signInError.code === "captcha_failed") {
      return { error: "ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่" };
    }
    const result = await recordLoginFailure(admin, normalizedEmail);
    if (result.lockedOut) {
      return { error: `บัญชีถูกล็อกชั่วคราว ลองใหม่ในอีก ${result.minutesLeft} นาที` };
    }
    return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  }
  if (!signInData.user) {
    const result = await recordLoginFailure(admin, normalizedEmail);
    if (result.lockedOut) {
      return { error: `บัญชีถูกล็อกชั่วคราว ลองใหม่ในอีก ${result.minutesLeft} นาที` };
    }
    return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", signInData.user.id)
    .single();

  if (!profile || profile.role !== "owner") {
    await supabase.auth.signOut();
    (await cookies()).delete(WORKER_COOKIE);
    return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  }

  await clearLoginLockout(admin, normalizedEmail);

  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update({ pin_hash: null, pin_failed_attempts: 0, pin_locked_until: null })
    .eq("id", profile.id)
    .select("id");
  if (updateError || !updated || updated.length === 0) {
    console.error(
      "resetOwnPinViaPassword: failed to clear pin_hash:",
      updateError ?? "update matched 0 rows (RLS rejected or row missing)"
    );
    return { error: "รีเซ็ต PIN ไม่สำเร็จ" };
  }

  (await cookies()).delete(WORKER_COOKIE);
  redirect("/job-level");
}
```

Add to the top of `src/app/actions/job-level.ts`, alongside the existing imports:

```ts
import {
  checkLoginLockout,
  clearLoginLockout,
  normalizeEmail,
  recordLoginFailure,
} from "@/lib/login-lockout";
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/job-level.ts
git commit -m "feat(auth): apply login lockout to resetOwnPinViaPassword"
```

---

### Task 5: Live verification with a disposable QA account

**Files:** none (verification-only task, no code changes).

**Interfaces:** none — this task exercises Tasks 1-4's combined behavior end-to-end.

- [ ] **Step 1: Create a disposable QA account**

Via the Supabase MCP `execute_sql` tool on project `khgahdjfkzpgsvbhfrqx`, insert a test
`auth.users` row (matching the pattern already used earlier this session — `crypt()`/`gen_salt
('bf')` for the password, all `Insert`-only columns coalesced to `''` rather than left `NULL`,
since a `NULL` in e.g. `email_change` causes GoTrue's Go driver to fail with `"converting NULL to
string is unsupported"` on every subsequent password-grant login attempt against that row), then
call `create_tenant_and_owner(p_user_id, p_store_name)` to give it a tenant + owner profile.

- [ ] **Step 2: Verify the main-login lockout**

Using the Browser pane or Claude in Chrome (whichever is working — see
[[feedback_browser_pane_crash_use_chrome]] if the in-app Browser pane crashes) against a **local
`npm run build && npm run start` production build** (not `next dev`, to avoid Strict Mode /
Fast Refresh noise, matching this session's established practice for this codebase), submit 5
consecutive wrong-password attempts on `/login` with the QA account's real email. Confirm:
- Attempts 1-4 show the unchanged "อีเมลหรือรหัสผ่านไม่ถูกต้อง" message.
- Attempt 5 (or the response after it, depending on exact off-by-one — confirm which) shows the
  new "บัญชีถูกล็อกชั่วคราว ลองใหม่ในอีก 15 นาที" message.
- A 6th attempt, even with the **correct** password, is still rejected with the locked-out message
  — confirm via Supabase MCP `query_logs` (source `auth_logs`) that no new `invalid_credentials` or
  successful `password` grant_type entry appears for that attempt, proving the real
  `signInWithPassword` call was skipped entirely, not just that the UI showed an error.

- [ ] **Step 3: Verify cross-form shared state**

Reset the QA account's lockout (delete its `login_lockouts` row via `execute_sql`, or wait out the
15 minutes — deleting is faster for testing). Fail login 3 times via `/login`, then fail 2 more
times via the Owner's "ลืม PIN?" form (`resetOwnPinViaPassword`, reached from the job-level PIN
screen). Confirm the 5th failure (on the PIN-reset form) triggers the lockout, and that a
subsequent attempt on the **main `/login` page** (not the PIN-reset form) is also locked — proving
the two call sites genuinely share one counter, not two independent ones that happen to look alike.

- [ ] **Step 3b: Verify the not-owner branch does NOT count toward lockout**

Reset the lockout state. Create (or reuse) a second QA profile in the same tenant with role
`manager` or `staff` (their own real, correct password). Submit that account's correct email and
password to the Owner's "ลืม PIN?" form 5 times in a row (each attempt authenticates successfully
but is rejected for not being owner). Confirm via `execute_sql` that no `login_lockouts` row was
created for that email, and that account can still log in normally via the main `/login` page
afterward — proving the fix in Task 4 (only real credential failures count, not valid-login-wrong-
role) actually prevents the self-lockout scenario it was written to avoid.

- [ ] **Step 4: Verify successful login clears the counter**

Reset the lockout state again. Fail login 3 times (attempts recorded, not yet locked), then submit
the correct password. Confirm login succeeds, then check via `execute_sql` that the
`login_lockouts` row for that email is gone (or `failed_attempts` back to a fresh state) — then
fail once more and confirm it's treated as "attempt 1", not "attempt 4".

- [ ] **Step 5: Verify `captcha_failed` doesn't count**

Using `javascript_tool` (or equivalent), submit the login form with a deliberately invalid/garbage
`turnstile_token` value several times in a row (bypassing the real widget by setting the hidden
field's value directly, then calling `form.requestSubmit()` — the pattern already established
this session). Confirm each attempt returns the CAPTCHA-failure message, then submit one real wrong
password attempt and confirm — via `execute_sql` on `login_lockouts` — that `failed_attempts` is
`1`, not `4`+.

- [ ] **Step 6: Verify email-case bypass is closed**

Fail login using `User@x.com`, then `user@X.com`, then `USER@X.COM`, etc. (5 total across varied
casing, all resolving to the same underlying QA account's email). Confirm the 5th attempt (across
all the case variants combined) triggers lockout — proving they share one normalized row, not five
separate ones.

- [ ] **Step 7: Clean up**

Delete the QA account's `tenants` row and `auth.users` row via `execute_sql` (same teardown
pattern used earlier this session), and delete any leftover `login_lockouts` row for its email.
Confirm via a final `select count(*)` that 0 rows remain in all three tables for this QA account.

- [ ] **Step 8: Revert any local-only test config**

If `next.config.ts`, `.env.local`, or any other local-only file was temporarily changed to support
this verification (e.g. switching the Turnstile site key, disabling Strict Mode), revert it back
to its committed/original state before finishing. Confirm `git status` shows no unintended diffs
outside this plan's own files.

---

## Notes for the implementer/reviewer

- This plan deliberately does **not** touch `signUp` or `requestPasswordReset` — neither involves
  guessing an existing password (see spec's "Not in scope" reasoning).
- No scheduled cleanup job for old `login_lockouts` rows is being built — accepted as a low-growth
  table for v1, matching the spec's explicit YAGNI call.
- Task 4 deliberately does **not** call `recordLoginFailure` on the "signed in but not an owner"
  branch — see the note directly above Task 4 Step 1 for why (it would let a non-owner accidentally
  lock themselves out of the main login page via their own valid credentials). Only the actual
  `signInWithPassword` credential-failure paths count toward the lockout.

[[project_login_page_security_gap_analysis]] [[project_login_captcha_feature]]
[[feedback_key_patterns]]
