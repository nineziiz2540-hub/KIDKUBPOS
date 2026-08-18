# Pre-Auth CAPTCHA (Cloudflare Turnstile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cloudflare Turnstile bot protection to the Login, Register, and Forgot Password
forms, using Supabase Auth's native CAPTCHA integration so no verification logic is written in
this codebase.

**Architecture:** One shared client component (`TurnstileWidget`) wraps
`@marsidev/react-turnstile` and is reused identically by all three pages. Each page holds the
token in state, includes it as a hidden form field, disables submit until a token exists, and
resets the widget when the corresponding server action returns an error (tokens are single-use).
Each of the three server actions in `src/app/actions/auth.ts` gains a "token present" check and
passes the token through as `captchaToken` to the matching Supabase Auth call — Supabase validates
it against Cloudflare server-side once the user enables CAPTCHA protection in their Supabase
project's Auth settings (an external, non-code step — see the callout below).

**Tech Stack:** Same as the rest of the app — Next.js 16 Server Actions, `useActionState`, React
19. New dependency: `@marsidev/react-turnstile`.

## ⚠️ Steps the user (not the implementer) must do — read before or after implementation

These are Cloudflare/Supabase Dashboard steps, not code, and they are **not blocking** — the code
in this plan works safely before they're done (see Global Constraints below for why). Hand this
list to the user once implementation is complete:

1. **Create a Cloudflare account** (free) at https://dash.cloudflare.com/sign-up if you don't
   already have one.
2. **Create a Turnstile widget**: Cloudflare Dashboard → Turnstile → Add Site. Add both
   `localhost` and your production domain (e.g. `kidkubpos.vercel.app`) as allowed hostnames. This
   gives you a **Site Key** and a **Secret Key**.
3. **Put the Site Key in `.env.local`** (and in Vercel's environment variables for production) as
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — replacing the temporary Cloudflare test key this plan ships
   with by default (see Global Constraints).
4. **Put the Secret Key into Supabase** — Supabase Dashboard → your project → Authentication →
   Attack Protection (or "Bot and Abuse Protection", naming varies by Supabase Dashboard version)
   → enable CAPTCHA protection → select **Turnstile** → paste the Secret Key → Save.
5. Only after step 4 does Supabase actually start rejecting requests with missing/invalid tokens —
   before that, the widget still renders and a token is still collected and sent, but Supabase
   doesn't require it yet, so nothing breaks for real users mid-rollout.

## Global Constraints

- Exact Thai copy strings below are final — use them verbatim, do not rephrase.
- No automated tests exist in this project — do not add a test framework. Verify by running the
  app and clicking through it.
- No database migration, no `src/types/database.ts` regeneration — this feature has no
  persistence layer at all.
- Only the three forms named in the spec get the widget: Login, Register, Forgot Password. Do
  **not** add it to `updatePassword` (reached via an emailed reset link) or `setBackupPassword`
  (requires an existing session) — both are out of scope per the spec.
- Do **not** add CAPTCHA to the OAuth (Google/Facebook) buttons — separate code path, separate
  provider-side bot protection, explicitly out of scope.
- **Use Cloudflare's published always-passing test Site Key
  (`1x00000000000000000000AA`) as the default value in `.env.local` during implementation and QA.**
  This is a real, public, Cloudflare-documented key
  (https://developers.cloudflare.com/turnstile/troubleshooting/testing/) meant exactly for this —
  it renders a real widget and always succeeds, so the implementer can verify the full flow
  end-to-end without needing the user's real Cloudflare account to exist yet. Supabase's own
  CAPTCHA *enforcement* stays off at the platform level until the user completes their own
  Dashboard setup (see the callout above), so using a test key here does not create a false sense
  of security in production — it only affects local `npm run dev` QA during this task.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` must be read with a safe fallback (`?? ""`) wherever used — do
  not assume the env var is always set; a missing/empty site key should not crash the page (the
  widget will simply fail to render/validate, which is an acceptable degraded state, not a crash).

---

### Task 1: Turnstile widget + wiring into Login/Register/Forgot-Password

**Files:**
- Create: `src/components/auth/turnstile-widget.tsx`
- Modify: `src/app/actions/auth.ts`
- Modify: `src/app/(auth)/login/page.tsx`
- Modify: `src/app/(auth)/register/page.tsx`
- Modify: `src/app/(auth)/forgot-password/page.tsx`
- Modify: `.env.example`
- Modify: `.env.local` (add the test site key for local dev/QA — this file is gitignored, not
  committed)
- Modify: `package.json` / `package-lock.json` (new dependency)

**Interfaces:**
- Produces: `TurnstileWidget` from `src/components/auth/turnstile-widget.tsx` — a
  `forwardRef`-wrapped component taking `{ onSuccess: (token: string) => void; onExpireOrError:
  () => void }`, forwarding a ref typed `TurnstileInstance` (from `@marsidev/react-turnstile`) so
  callers can invoke `.reset()`.
- Consumes: `@marsidev/react-turnstile`'s `Turnstile` component and `TurnstileInstance` type.
- `signIn`, `signUp`, `requestPasswordReset` (all in `src/app/actions/auth.ts`) each now read an
  additional `turnstile_token` field from the submitted `FormData` — no change to their existing
  return types (`SignInState`, `SignUpState`, `ForgotPasswordState`).

- [ ] **Step 1: Install the dependency**

```bash
npm install @marsidev/react-turnstile
```

- [ ] **Step 2: Add the test site key to `.env.local` and document it in `.env.example`**

Add this line to `.env.local` (create the key if it isn't already present — do not remove or
modify any other existing lines in that file):

```
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

Add this to `.env.example`, in the same style as the existing Supabase section:

```
# Cloudflare Turnstile — get real values from https://dash.cloudflare.com/ → Turnstile → Add Site
# The value below is Cloudflare's published "always passes" TEST site key, safe for local dev.
# Replace with your real site key before deploying to production, and put the matching secret key
# into Supabase Dashboard → Authentication → Attack Protection → enable Turnstile.
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
```

- [ ] **Step 3: Create `src/components/auth/turnstile-widget.tsx`**

```tsx
"use client";
import { forwardRef } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";

type Props = {
  onSuccess: (token: string) => void;
  onExpireOrError: () => void;
};

export const TurnstileWidget = forwardRef<TurnstileInstance, Props>(function TurnstileWidget(
  { onSuccess, onExpireOrError },
  ref
) {
  return (
    <Turnstile
      ref={ref}
      siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ""}
      onSuccess={onSuccess}
      onExpire={onExpireOrError}
      onError={onExpireOrError}
    />
  );
});
```

- [ ] **Step 4: Add the token check to `signIn`, `signUp`, `requestPasswordReset` in `src/app/actions/orders.ts`**

(Note: the file is `src/app/actions/auth.ts`, not `orders.ts` — this project also has an
unrelated `orders.ts` actions file, don't confuse the two.)

Replace the file's content with:

```ts
"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/dal";

export type SignInState = { error?: string } | undefined;

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
    return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  }

  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete("worker_verified");
  redirect("/login");
}

export type SignUpState = { error?: string; success?: boolean } | undefined;

export async function signUp(
  prevState: SignUpState,
  formData: FormData
): Promise<SignUpState> {
  const storeName = formData.get("store_name");
  const email = formData.get("email");
  const password = formData.get("password");
  const confirmPassword = formData.get("confirm_password");
  const turnstileToken = formData.get("turnstile_token");

  if (
    typeof storeName !== "string" ||
    typeof email !== "string" ||
    typeof password !== "string" ||
    typeof confirmPassword !== "string" ||
    storeName.trim() === ""
  ) {
    return { error: "กรุณากรอกข้อมูลให้ครบถ้วน" };
  }
  if (password !== confirmPassword) {
    return { error: "รหัสผ่านไม่ตรงกัน" };
  }
  if (password.length < 6) {
    return { error: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" };
  }
  if (typeof turnstileToken !== "string" || turnstileToken === "") {
    return { error: "กรุณายืนยันว่าคุณไม่ใช่บอท" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { captchaToken: turnstileToken },
  });
  if (error || !data.user) {
    return { error: "สมัครสมาชิกไม่สำเร็จ อีเมลนี้อาจถูกใช้แล้ว" };
  }

  const { error: rpcError } = await supabase.rpc("create_tenant_and_owner", {
    p_user_id: data.user.id,
    p_store_name: storeName.trim(),
  });
  if (rpcError) {
    const admin = createAdminClient();
    const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
    if (deleteError) {
      console.error("Failed to clean up orphaned auth user:", deleteError);
    }
    console.error("create_tenant_and_owner failed:", rpcError);
    return { error: "สร้างร้านค้าไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ" };
  }

  if (!data.session) {
    return { success: true };
  }

  redirect("/job-level");
}

export type ForgotPasswordState = { error?: string; success?: boolean } | undefined;

export async function requestPasswordReset(
  prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = formData.get("email");
  const turnstileToken = formData.get("turnstile_token");
  if (typeof email !== "string" || email.trim() === "") {
    return { error: "กรุณากรอกอีเมล" };
  }
  if (typeof turnstileToken !== "string" || turnstileToken === "") {
    return { error: "กรุณายืนยันว่าคุณไม่ใช่บอท" };
  }

  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${origin}/reset-password`,
    captchaToken: turnstileToken,
  });

  // Always the same response, regardless of whether the email exists —
  // avoids leaking which emails are registered.
  return { success: true };
}

export type UpdatePasswordState = { error?: string; success?: boolean } | undefined;

export async function updatePassword(
  prevState: UpdatePasswordState,
  formData: FormData
): Promise<UpdatePasswordState> {
  const password = formData.get("password");
  const confirmPassword = formData.get("confirm_password");

  if (typeof password !== "string" || typeof confirmPassword !== "string") {
    return { error: "กรุณากรอกรหัสผ่านให้ครบถ้วน" };
  }
  if (password !== confirmPassword) {
    return { error: "รหัสผ่านไม่ตรงกัน" };
  }
  if (password.length < 6) {
    return { error: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "เปลี่ยนรหัสผ่านไม่สำเร็จ ลิงก์อาจหมดอายุ" };

  return { success: true };
}

export type SetBackupPasswordState = { error?: string } | undefined;

export async function setBackupPassword(
  prevState: SetBackupPasswordState,
  formData: FormData
): Promise<SetBackupPasswordState> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบใหม่" };

  const password = formData.get("password");
  const confirmPassword = formData.get("confirm_password");
  if (typeof password !== "string" || typeof confirmPassword !== "string") {
    return { error: "กรุณากรอกรหัสผ่านให้ครบถ้วน" };
  }
  if (password !== confirmPassword) {
    return { error: "รหัสผ่านไม่ตรงกัน" };
  }
  if (password.length < 6) {
    return { error: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" };
  }

  const supabase = await createClient();
  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) return { error: "ตั้งรหัสผ่านไม่สำเร็จ กรุณาลองใหม่" };

  const { data: updated, error: profileError } = await supabase
    .from("profiles")
    .update({ has_backup_password: true })
    .eq("id", profile.id)
    .select("id");
  if (profileError || !updated || updated.length === 0) {
    console.error(
      "setBackupPassword: failed to flag has_backup_password:",
      profileError ?? "update matched 0 rows (RLS rejected or row missing)"
    );
    return { error: "ตั้งรหัสผ่านไม่สำเร็จ กรุณาลองใหม่" };
  }

  redirect("/job-level");
}
```

(Everything below `signUp` is unchanged from the current file — `requestPasswordReset` gains the
token check as shown; `updatePassword` and `setBackupPassword` are copied verbatim, untouched, per
the Global Constraints scope boundary.)

- [ ] **Step 5: Wire the widget into `src/app/(auth)/login/page.tsx`**

Replace the file's content with:

```tsx
"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { signIn, type SignInState } from "@/app/actions/auth";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [state, action, pending] = useActionState<SignInState, FormData>(
    signIn,
    undefined
  );
  const [token, setToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);

  // Synchronize local UI state with the latest action result during render (React's "adjust
  // state while rendering" pattern), same convention already used by void-order-button.tsx in
  // this codebase — avoids the react-hooks/set-state-in-effect lint violation a useEffect-based
  // version would trigger.
  const [handledState, setHandledState] = useState<SignInState>(undefined);
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
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl text-sidebar">KIDKUBPOS</CardTitle>
        <CardDescription>เข้าสู่ระบบเพื่อดำเนินการต่อ</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">อีเมล</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">รหัสผ่าน</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          <Link
            href="/forgot-password"
            className="block text-right text-sm text-accent hover:underline"
          >
            ลืมรหัสผ่าน?
          </Link>
          <input type="hidden" name="turnstile_token" value={token ?? ""} />
          <TurnstileWidget
            ref={turnstileRef}
            onSuccess={setToken}
            onExpireOrError={() => setToken(null)}
          />
          {state?.error !== undefined && (
            <p className="text-sm text-destructive font-medium">{state.error}</p>
          )}
          <Button
            type="submit"
            disabled={pending || !token}
            className="w-full bg-accent hover:bg-accent/90 text-white"
          >
            {pending ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            ยังไม่มีบัญชี?{" "}
            <Link href="/register" className="text-accent font-medium hover:underline">
              สมัครใช้งาน
            </Link>
          </p>
        </form>
        <div className="relative py-2">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-2 text-muted-foreground">หรือ</span>
          </div>
        </div>
        <OAuthButtons />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Wire the widget into `src/app/(auth)/register/page.tsx`**

Replace the file's content with:

```tsx
"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { signUp, type SignUpState } from "@/app/actions/auth";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function RegisterPage() {
  const [state, action, pending] = useActionState<SignUpState, FormData>(
    signUp,
    undefined
  );
  const [token, setToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);

  const [handledState, setHandledState] = useState<SignUpState>(undefined);
  if (state !== handledState) {
    setHandledState(state);
    if (state?.error !== undefined) {
      setToken(null);
    }
  }

  useEffect(() => {
    if (state?.error !== undefined) {
      turnstileRef.current?.reset();
    }
  }, [state]);

  if (state?.success) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-sidebar">สมัครสำเร็จ</CardTitle>
          <CardDescription>
            กรุณาตรวจสอบอีเมลของคุณและกดยืนยันตัวตน ก่อนเข้าสู่ระบบครั้งแรก
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/login"
            className="block text-center text-sm text-accent font-medium hover:underline"
          >
            กลับไปเข้าสู่ระบบ
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl text-sidebar">สมัครใช้งาน KIDKUBPOS</CardTitle>
        <CardDescription>สร้างร้านค้าของคุณ</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="store_name">ชื่อร้าน</Label>
            <Input id="store_name" name="store_name" type="text" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">อีเมล</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">รหัสผ่าน</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm_password">ยืนยันรหัสผ่าน</Label>
            <Input
              id="confirm_password"
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          <input type="hidden" name="turnstile_token" value={token ?? ""} />
          <TurnstileWidget
            ref={turnstileRef}
            onSuccess={setToken}
            onExpireOrError={() => setToken(null)}
          />
          {state?.error !== undefined && (
            <p className="text-sm text-destructive font-medium">{state.error}</p>
          )}
          <Button
            type="submit"
            disabled={pending || !token}
            className="w-full bg-accent hover:bg-accent/90 text-white"
          >
            {pending ? "กำลังสมัคร…" : "สมัครใช้งาน"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            มีบัญชีอยู่แล้ว?{" "}
            <Link href="/login" className="text-accent font-medium hover:underline">
              เข้าสู่ระบบ
            </Link>
          </p>
        </form>
        <div className="relative py-2">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-2 text-muted-foreground">หรือ</span>
          </div>
        </div>
        <OAuthButtons />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Wire the widget into `src/app/(auth)/forgot-password/page.tsx`**

Replace the file's content with:

```tsx
"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { requestPasswordReset, type ForgotPasswordState } from "@/app/actions/auth";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState<ForgotPasswordState, FormData>(
    requestPasswordReset,
    undefined
  );
  const [token, setToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);

  const [handledState, setHandledState] = useState<ForgotPasswordState>(undefined);
  if (state !== handledState) {
    setHandledState(state);
    if (state?.error !== undefined) {
      setToken(null);
    }
  }

  useEffect(() => {
    if (state?.error !== undefined) {
      turnstileRef.current?.reset();
    }
  }, [state]);

  if (state?.success) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-sidebar">ส่งอีเมลแล้ว</CardTitle>
          <CardDescription>
            ถ้าอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้แล้ว
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/login"
            className="block text-center text-sm text-accent font-medium hover:underline"
          >
            กลับไปเข้าสู่ระบบ
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl text-sidebar">ลืมรหัสผ่าน</CardTitle>
        <CardDescription>กรอกอีเมลของคุณเพื่อรับลิงก์ตั้งรหัสผ่านใหม่</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">อีเมล</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required />
          </div>
          <input type="hidden" name="turnstile_token" value={token ?? ""} />
          <TurnstileWidget
            ref={turnstileRef}
            onSuccess={setToken}
            onExpireOrError={() => setToken(null)}
          />
          {state?.error !== undefined && (
            <p className="text-sm text-destructive font-medium">{state.error}</p>
          )}
          <Button
            type="submit"
            disabled={pending || !token}
            className="w-full bg-accent hover:bg-accent/90 text-white"
          >
            {pending ? "กำลังส่ง…" : "ส่งลิงก์"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 8: Type-check, lint, build**

Run:
```bash
npx tsc --noEmit
npm run lint
npm run build
```
Expected: all three clean (0 errors).

- [ ] **Step 9: Manual live-browser verification**

Verify on localhost via the Browser pane at tablet size, per
[[feedback_live_preview_ipad_standard]] — using the test site key from Step 2, no real Cloudflare
account needed for this step:

1. `/login`, `/register`, `/forgot-password` each render the Turnstile widget below their form
   fields. The submit button is disabled until the widget shows a completed checkmark.
2. Complete the widget on `/login` and submit valid credentials for a disposable QA account →
   succeeds normally. Confirm via the Browser pane's network inspector that the
   `signInWithPassword` (or equivalent Supabase Auth) network request body includes a
   `gotrue_meta_security.captcha_token` field (or similarly named — check the actual request body
   Supabase's client sends) with a non-empty value.
3. On `/login`, submit with a deliberately wrong password (after completing the widget normally)
   → rejected with the existing "อีเมลหรือรหัสผ่านไม่ถูกต้อง" message, AND the widget visibly
   resets (its checkmark disappears / it re-renders) — confirms the `.reset()` wiring works, not
   just that the happy path works once. Complete the widget again and retry with the correct
   password → succeeds.
4. Attempt to submit `/login` with the hidden `turnstile_token` field manually cleared via
   `javascript_tool` (simulating a request that bypassed the widget) → rejected server-side with
   "กรุณายืนยันว่าคุณไม่ใช่บอท", confirming the check fires before Supabase is ever called.
5. Repeat scenario 1 (widget renders, submit works) on `/register` and `/forgot-password`.
6. Confirm `npm run build` output does not warn about `NEXT_PUBLIC_TURNSTILE_SITE_KEY` being
   inlined incorrectly (Next.js public env vars are replaced at build time — this is expected
   behavior, just confirm no unexpected warning appears).

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json .env.example \
  src/components/auth/turnstile-widget.tsx src/app/actions/auth.ts \
  "src/app/(auth)/login/page.tsx" "src/app/(auth)/register/page.tsx" \
  "src/app/(auth)/forgot-password/page.tsx"
git commit -m "feat(auth): add Cloudflare Turnstile CAPTCHA to login/register/forgot-password"
```

Do **not** commit `.env.local` (it's gitignored already — verify with `git status` that it does
not appear in the files to be committed).
