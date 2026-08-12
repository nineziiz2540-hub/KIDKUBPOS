# Owner PIN Self-Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Owner who forgot their PIN reset it themselves, by re-authenticating with their
account email+password, without needing anyone else's help or a direct database edit.

**Architecture:** One new server action (`resetOwnPinViaPassword` in `src/app/actions/job-level.ts`)
re-authenticates via `signInWithPassword`, verifies the resulting profile is role `owner`, and
clears `pin_hash`/`pin_failed_attempts`/`pin_locked_until` on that profile. One UI change
(`src/components/job-level/owner-tile.tsx`) adds a "ลืม PIN?" link that swaps the PIN pad for a
small email+password form. On success the page redirects to `/job-level`, which re-renders with
`hasPinSet: false`, so the existing (unmodified) `SetOwnerPin` component takes over automatically.

**Tech Stack:** Next.js 16 Server Actions, `@supabase/ssr`, existing `useActionState` + Card/Input/
Button UI primitives already used throughout this codebase's auth screens.

## Global Constraints

- Error messages for failed re-authentication must be the exact generic string
  `"อีเมลหรือรหัสผ่านไม่ถูกต้อง"` — same string used by `signIn` in `src/app/actions/auth.ts` — for
  both a wrong password AND a non-owner account, so the form gives no signal about which failed.
- The profile-row UPDATE (clearing `pin_hash`) must use the regular request-bound Supabase client
  (`createClient()`), never the admin client — this action only ever touches the CALLER's own row,
  immediately after they've freshly authenticated as that exact `auth.uid()`, so RLS's existing
  `profiles_update_own` policy (`id = auth.uid()`) already permits it. Do not introduce
  `createAdminClient()` here — it is unnecessary and would be an unexplained deviation from the
  established pattern (see `setOwnPin`/`verifyOwnPin` in the same file, which use the regular client
  for the identical reason).
- No new pages, no new routes, no database migration. Reuses the existing `pin_hash` /
  `pin_failed_attempts` / `pin_locked_until` columns and the existing `SetOwnerPin` component
  as-is (do not modify `SetOwnerPin`).
- This project has no automated test suite (`package.json` scripts are `dev`/`build`/`start`/`lint`
  only) — verification is `npx tsc --noEmit`, `npm run build`, and manual live-browser QA, matching
  every other task completed in this codebase's auth work.

---

### Task 1: Owner PIN self-reset (server action + UI)

**Files:**
- Modify: `src/app/actions/job-level.ts`
- Modify: `src/components/job-level/owner-tile.tsx`

**Interfaces:**
- Produces: `resetOwnPinViaPassword(prevState: PinState, formData: FormData): Promise<PinState>` —
  exported from `src/app/actions/job-level.ts`, using the same `PinState` type already exported
  from that file (`{ error?: string } | undefined`).
- Consumes: existing `PinState` type, existing `getProfile` from `@/lib/dal`, existing
  `createClient` from `@/lib/supabase/server`, existing `LOCKOUT_THRESHOLD`/`LOCKOUT_SECONDS`
  constants are NOT needed by this action (it clears lockout state, it doesn't create it).

- [ ] **Step 1: Add `resetOwnPinViaPassword` to `src/app/actions/job-level.ts`**

Add this function after `verifyOwnPin` (i.e. between `verifyOwnPin` and `switchToMember`):

```ts
export async function resetOwnPinViaPassword(
  prevState: PinState,
  formData: FormData
): Promise<PinState> {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "กรุณากรอกอีเมลและรหัสผ่าน" };
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  }

  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ pin_hash: null, pin_failed_attempts: 0, pin_locked_until: null })
    .eq("id", profile.id);
  if (updateError) return { error: "รีเซ็ต PIN ไม่สำเร็จ" };

  redirect("/job-level");
}
```

No new imports are needed — `bcrypt`, `cookies`, `redirect`, `createClient`, `getProfile` are
already imported at the top of this file for the other actions.

- [ ] **Step 2: Extend `VerifyOwnerPin` and add `ForgotOwnerPinForm` in `owner-tile.tsx`**

Replace the existing `VerifyOwnerPin` function with this version (adds a `forgotMode` toggle and
the "ลืม PIN?" link — the PIN-pad branch is otherwise unchanged), and add the new
`ForgotOwnerPinForm` function after it:

```tsx
function VerifyOwnerPin() {
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
          <button
            type="button"
            onClick={() => setForgotMode(true)}
            className="text-sm text-accent hover:underline"
          >
            ลืม PIN?
          </button>
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
              disabled={pending}
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

Also update the top-of-file import to pull in the new action:

```tsx
import { setOwnPin, verifyOwnPin, resetOwnPinViaPassword, type PinState } from "@/app/actions/job-level";
```

(replacing the existing `import { setOwnPin, verifyOwnPin, type PinState } from "@/app/actions/job-level";` line). No other imports need to change — `Card`, `CardHeader`, `CardTitle`, `CardContent`, `Input`, `Label`, `Button` are already imported.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compiles successfully, no new warnings beyond the two pre-existing CSS warnings already
present before this change.

- [ ] **Step 5: Manual live-browser verification (iPad-sized preview per project standard)**

Open the app in the Browser pane resized to tablet (768×1024), and walk through:

1. As an Owner with a PIN already set: job-level → OWNER tile → tap "ลืม PIN?" → submit a wrong
   password → generic error shown ("อีเมลหรือรหัสผ่านไม่ถูกต้อง") → tap "ยกเลิก" → confirm the
   normal PIN pad reappears and the OLD PIN still works (nothing was cleared).
2. Same starting point, correct email+password → redirected to `/job-level` → confirm the screen
   now shows `SetOwnerPin` (the "ตั้งรหัส PIN ของคุณ" form with two PIN fields), not the PIN pad →
   set a new PIN → lands on dashboard with no console errors.
3. Reopen job-level, tap OWNER tile, confirm the NEW PIN works and the OLD one no longer does.
4. Confirm Manager/Staff PIN reset (Settings → Team) still works unmodified — this change doesn't
   touch `resetTeamMemberPin` or `SetOwnerPin`.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/job-level.ts src/components/job-level/owner-tile.tsx
git commit -m "feat(auth): let Owner self-reset a forgotten PIN via password re-auth"
```
