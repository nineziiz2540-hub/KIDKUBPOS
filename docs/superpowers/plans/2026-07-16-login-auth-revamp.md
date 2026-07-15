# Login / Auth Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build self-service Owner registration (+ forgot/reset password, OAuth buttons wired but
inert), and a shared-device Job Level + PIN gate so Manager/Staff (provisioned by the Owner, no
email login of their own) can identify themselves on a POS device that stays logged in as Owner.

**Architecture:** Owner registers via Supabase email/password `signUp`, which also atomically
creates a new `tenants` row + an `owner` `profiles` row via a `SECURITY DEFINER` Postgres function.
Manager/Staff get a hidden ("synthetic") `auth.users` row created by the Owner from Settings → Team,
plus a bcrypt-hashed 6-digit PIN stored on their `profiles` row. The shared `/job-level` screen
verifies a PIN and, for Manager/Staff, uses the Supabase Admin API
(`generateLink` + `verifyOtp`) to swap the device's live session to that person — no password is
ever stored or re-entered for the swap. A `worker_verified` cookie gates the rest of the app,
separate from the underlying Supabase auth cookie, so switching workers doesn't require Owner's
password every time.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Supabase (`@supabase/ssr`,
`@supabase/supabase-js` Admin API), `bcryptjs` (new dependency), existing design-system components
(`Button`, `Input`, `Card`, `Label`).

**Design spec:** `docs/superpowers/specs/2026-07-16-login-auth-revamp-design.md` — read this first
for the full rationale; this plan only restates the exact values needed to implement it.

## Global Constraints

- PINs are always bcrypt-hashed (`pin_hash`) — never stored or logged in plaintext, never emailed
  back to anyone. "Forgot PIN" for Manager/Staff is Owner-mediated only (Owner sets a new PIN from
  the Team page); there is no self-service PIN recovery.
- No raw password is ever stored by the app itself. Login/register/reset forms use
  `autoComplete="username" | "current-password" | "new-password"` so the browser's own password
  manager can offer to remember them — never custom `localStorage`/cookie credential storage.
- Rate limiting for PIN attempts is DB-backed (`profiles.pin_failed_attempts` /
  `profiles.pin_locked_until`), never an in-memory counter — this app deploys to Vercel, where
  consecutive requests can land on different serverless instances.
- The service-role Supabase client (`src/lib/supabase/admin.ts`) is imported only by server-only
  files (Server Actions) — never by a Client Component, never sent to the browser.
- Register always creates a brand-new tenant (registrant becomes its `owner`). There is no
  "join an existing tenant via invite code" flow — that was explicitly rejected during design.
- Existing page-level role gates (`isManagerOrOwner`, inline `profile.role !== "owner"` checks)
  are already correct and are not to be refactored — Task 9 adds exactly one missing gate
  (`/products`) that was found to be inconsistent with the confirmed Staff-access list.
- Every task must pass `npx tsc --noEmit` clean before being considered done.

---

### Task 1: Database Migration (controller runs this directly — not delegated)

**Files:**
- Create: `supabase/migrations/20260716000000_auth_revamp.sql`
- Modify: `src/lib/dal.ts:6-24` (extend `ProfileWithTenant` type)

**Interfaces:**
- Produces: columns `profiles.pin_hash text`, `profiles.recovery_contact text`,
  `profiles.auth_managed boolean`, `profiles.pin_failed_attempts int`,
  `profiles.pin_locked_until timestamptz`; Postgres function
  `public.create_tenant_and_owner(p_user_id uuid, p_store_name text) returns uuid`.

This task touches live database schema — the controller runs it directly via the Supabase MCP
tools (`apply_migration`, then `generate_typescript_types`) rather than dispatching an implementer
subagent, since schema changes against the real project are less reversible than a code edit.

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260716000000_auth_revamp.sql

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

create or replace function public.create_tenant_and_owner(
  p_user_id    uuid,
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

- [ ] **Step 2: Apply the migration via the Supabase MCP tool**

Call `mcp__<supabase-server>__apply_migration` with `name: "auth_revamp"` and `query` set to the
full SQL above. Confirm it returns success.

- [ ] **Step 3: Regenerate TypeScript types**

Call `mcp__<supabase-server>__generate_typescript_types` and overwrite
`src/types/database.ts` with the result, exactly as done in Stack 9 Task 6.

- [ ] **Step 4: Extend `ProfileWithTenant` in `src/lib/dal.ts`**

Current (`src/lib/dal.ts:10-24`):

```ts
export type ProfileWithTenant = {
  id: string;
  full_name: string | null;
  role: Role;
  tenant_id: string;
  created_at: string;
  updated_at: string;
  tenants: {
    id: string;
    name: string;
    slug: string;
    created_at: string;
    updated_at: string;
  };
};
```

Change to:

```ts
export type ProfileWithTenant = {
  id: string;
  full_name: string | null;
  role: Role;
  tenant_id: string;
  pin_hash: string | null;
  pin_failed_attempts: number;
  pin_locked_until: string | null;
  created_at: string;
  updated_at: string;
  tenants: {
    id: string;
    name: string;
    slug: string;
    created_at: string;
    updated_at: string;
  };
};
```

(`recovery_contact` and `auth_managed` are intentionally omitted here — only consumed directly via
`getTeamMembers`/team-management queries in later tasks, not through `getProfile()`.)

- [ ] **Step 5: Verify**

Run `npx tsc --noEmit` — expect clean (no consumer of `ProfileWithTenant` breaks, since fields were
only added, not changed/removed).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260716000000_auth_revamp.sql src/types/database.ts src/lib/dal.ts
git commit -m "feat(auth): add PIN/tenant-creation schema for login revamp"
```

---

### Task 2: Dependencies + Supabase Admin Client

**Files:**
- Modify: `package.json` (add `bcryptjs`)
- Create: `src/lib/supabase/admin.ts`

**Interfaces:**
- Produces: `createAdminClient(): SupabaseClient<Database>` — service-role client for
  synthetic-account creation and session-switch magic links. Consumed by Tasks 6 and 8.

- [ ] **Step 1: Install `bcryptjs`**

```bash
npm install bcryptjs
npm install -D @types/bcryptjs
```

- [ ] **Step 2: Create the admin client helper**

```ts
// src/lib/supabase/admin.ts
import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
```

The `server-only` import ensures any accidental Client Component import fails at build time,
matching this codebase's existing convention (see `src/lib/dal.ts:1`).

- [ ] **Step 3: Verify**

Run `npx tsc --noEmit` — expect clean.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/supabase/admin.ts
git commit -m "feat(auth): add bcryptjs and service-role admin client"
```

---

### Task 3: Register Page + signUp Action

**Files:**
- Create: `src/app/(auth)/register/page.tsx`
- Modify: `src/app/actions/auth.ts` (add `signUp`)
- Modify: `src/app/(auth)/login/page.tsx` (add a link to `/register`)

**Interfaces:**
- Consumes: `create_tenant_and_owner` RPC from Task 1.
- Produces: `signUp(prevState: SignUpState, formData: FormData): Promise<SignUpState>`, exported
  from `src/app/actions/auth.ts`, consumed only by `register/page.tsx`.

- [ ] **Step 1: Add the `signUp` action**

Append to `src/app/actions/auth.ts` (existing file — keep `signIn`/`signOut` as-is):

```ts
export type SignUpState = { error?: string } | undefined;

export async function signUp(
  prevState: SignUpState,
  formData: FormData
): Promise<SignUpState> {
  const storeName = formData.get("store_name");
  const email = formData.get("email");
  const password = formData.get("password");
  const confirmPassword = formData.get("confirm_password");

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

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.user) {
    return { error: "สมัครสมาชิกไม่สำเร็จ อีเมลนี้อาจถูกใช้แล้ว" };
  }

  const { error: rpcError } = await supabase.rpc("create_tenant_and_owner", {
    p_user_id: data.user.id,
    p_store_name: storeName.trim(),
  });
  if (rpcError) {
    return { error: "สร้างร้านค้าไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ" };
  }

  redirect("/job-level");
}
```

- [ ] **Step 2: Create the Register page**

```tsx
// src/app/(auth)/register/page.tsx
"use client";
import { useActionState } from "react";
import Link from "next/link";
import { signUp, type SignUpState } from "@/app/actions/auth";
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
            {pending ? "กำลังสมัคร…" : "สมัครใช้งาน"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            มีบัญชีอยู่แล้ว?{" "}
            <Link href="/login" className="text-accent font-medium hover:underline">
              เข้าสู่ระบบ
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Add a Register link to the Login page**

In `src/app/(auth)/login/page.tsx`, add directly after the closing `</form>`'s submit `Button`
(inside the `<form>`, after the `Button` element, before `</form>`):

```tsx
          <p className="text-center text-sm text-muted-foreground">
            ยังไม่มีบัญชี?{" "}
            <Link href="/register" className="text-accent font-medium hover:underline">
              สมัครใช้งาน
            </Link>
          </p>
```

Add `import Link from "next/link";` to the top of that file.

- [ ] **Step 4: Verify**

Run `npx tsc --noEmit` — expect clean. This task's live-browser check happens later in Task 10
(full walk-through), since `/job-level` (the signup redirect target) doesn't exist until Task 7.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/auth.ts src/app/\(auth\)/register/page.tsx src/app/\(auth\)/login/page.tsx
git commit -m "feat(auth): add self-service registration (creates tenant + owner)"
```

---

### Task 4: Forgot Password + Reset Password

**Files:**
- Create: `src/app/(auth)/forgot-password/page.tsx`
- Create: `src/app/(auth)/reset-password/page.tsx`
- Modify: `src/app/actions/auth.ts` (add `requestPasswordReset`, `updatePassword`)
- Modify: `src/app/(auth)/login/page.tsx` (add a "ลืมรหัสผ่าน?" link)

**Interfaces:**
- Produces: `requestPasswordReset(prevState, formData)`, `updatePassword(prevState, formData)`,
  both exported from `src/app/actions/auth.ts`.

- [ ] **Step 1: Add the two actions**

Append to `src/app/actions/auth.ts`:

```ts
export type ForgotPasswordState = { error?: string; success?: boolean } | undefined;

export async function requestPasswordReset(
  prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = formData.get("email");
  if (typeof email !== "string" || email.trim() === "") {
    return { error: "กรุณากรอกอีเมล" };
  }

  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/reset-password`,
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
```

`NEXT_PUBLIC_SITE_URL` is a new optional env var (falls back to localhost for local dev); note it
in `.env.example` as an addition in this step: append
`NEXT_PUBLIC_SITE_URL=http://localhost:3000` with a comment `# Used for password-reset email links; set to the real deployed URL in production`.

- [ ] **Step 2: Create the Forgot Password page**

```tsx
// src/app/(auth)/forgot-password/page.tsx
"use client";
import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, type ForgotPasswordState } from "@/app/actions/auth";
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
          {state?.error !== undefined && (
            <p className="text-sm text-destructive font-medium">{state.error}</p>
          )}
          <Button
            type="submit"
            disabled={pending}
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

- [ ] **Step 3: Create the Reset Password page**

```tsx
// src/app/(auth)/reset-password/page.tsx
"use client";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { updatePassword, type UpdatePasswordState } from "@/app/actions/auth";
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

export default function ResetPasswordPage() {
  const router = useRouter();
  const [state, action, pending] = useActionState<UpdatePasswordState, FormData>(
    updatePassword,
    undefined
  );

  useEffect(() => {
    if (state?.success) {
      const timer = setTimeout(() => router.push("/login"), 2000);
      return () => clearTimeout(timer);
    }
  }, [state?.success, router]);

  if (state?.success) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-sidebar">เปลี่ยนรหัสผ่านสำเร็จ</CardTitle>
          <CardDescription>กำลังพาไปหน้าเข้าสู่ระบบ…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl text-sidebar">ตั้งรหัสผ่านใหม่</CardTitle>
        <CardDescription>กรอกรหัสผ่านใหม่ของคุณ</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">รหัสผ่านใหม่</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm_password">ยืนยันรหัสผ่านใหม่</Label>
            <Input
              id="confirm_password"
              name="confirm_password"
              type="password"
              autoComplete="new-password"
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
            {pending ? "กำลังบันทึก…" : "เปลี่ยนรหัสผ่าน"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

Supabase's client SDK automatically detects the recovery token in the URL fragment and establishes
a temporary recovery session before this page's `action` fires — no manual token handling needed,
matching Supabase's documented `resetPasswordForEmail` flow.

- [ ] **Step 4: Add a "ลืมรหัสผ่าน?" link to the Login page**

In `src/app/(auth)/login/page.tsx`, directly below the password `Input`'s closing `</div>` (i.e.,
right after the password field's wrapper `div`, before the error-message paragraph):

```tsx
          <Link
            href="/forgot-password"
            className="block text-right text-sm text-accent hover:underline"
          >
            ลืมรหัสผ่าน?
          </Link>
```

- [ ] **Step 5: Verify**

Run `npx tsc --noEmit` — expect clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/auth.ts src/app/\(auth\)/forgot-password src/app/\(auth\)/reset-password src/app/\(auth\)/login/page.tsx .env.example
git commit -m "feat(auth): add forgot/reset password flow"
```

---

### Task 5: OAuth Buttons (inert) + Callback Route

**Files:**
- Create: `src/app/auth/callback/route.ts`
- Modify: `src/app/(auth)/login/page.tsx` (add Google/Facebook buttons)
- Modify: `src/app/(auth)/register/page.tsx` (add Google/Facebook buttons)

**Interfaces:**
- Produces: `GET /auth/callback` route handler exchanging an OAuth `code` for a session.

This task's buttons will not work end-to-end until the user configures Google/Facebook OAuth apps
in the Supabase Dashboard (out of scope — see spec Section 8) — the code path is complete and
correct, but clicking the buttons before that configuration exists will surface a Supabase-side
"provider not enabled" error, which is expected.

- [ ] **Step 1: Create the callback route handler**

```ts
// src/app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/job-level`);
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
```

- [ ] **Step 2: Add a client-side OAuth trigger component**

```tsx
// src/components/auth/oauth-buttons.tsx
"use client";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function OAuthButtons() {
  const supabase = createClient();

  async function handleOAuth(provider: "google" | "facebook") {
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => handleOAuth("google")}
      >
        เข้าสู่ระบบด้วย Google
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => handleOAuth("facebook")}
      >
        เข้าสู่ระบบด้วย Facebook
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into Login and Register pages**

In both `src/app/(auth)/login/page.tsx` and `src/app/(auth)/register/page.tsx`, import
`{ OAuthButtons }` from `@/components/auth/oauth-buttons` and render it inside `<CardContent>`,
after the closing `</form>` tag:

```tsx
          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-muted-foreground">หรือ</span>
            </div>
          </div>
          <OAuthButtons />
```

- [ ] **Step 4: Verify**

Run `npx tsc --noEmit` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/auth/callback/route.ts src/components/auth/oauth-buttons.tsx src/app/\(auth\)/login/page.tsx src/app/\(auth\)/register/page.tsx
git commit -m "feat(auth): wire Google/Facebook OAuth buttons (inert until provider config)"
```

---

### Task 6: Team Management Extension (Owner adds Manager/Staff)

**Files:**
- Modify: `src/app/actions/settings.ts` (add `createTeamMember`, `resetTeamMemberPin`)
- Modify: `src/app/(shell)/settings/team/page.tsx` (add the create form + reset-PIN button)
- Create: `src/components/settings/team-member-form.tsx`
- Create: `src/components/settings/reset-pin-form.tsx`

**Interfaces:**
- Consumes: `createAdminClient()` from Task 2.
- Produces: `createTeamMember(prevState, formData)`, `resetTeamMemberPin(prevState, formData)`,
  both exported from `src/app/actions/settings.ts`.

- [ ] **Step 1: Add the two actions**

First, add these two lines to the existing top-of-file import block in
`src/app/actions/settings.ts` (alongside the current `revalidatePath`/`createClient`/`getProfile`
imports — do not place them mid-file):

```ts
import bcrypt from "bcryptjs";
import { createAdminClient } from "@/lib/supabase/admin";
```

Then append the following to the bottom of the same file:

```ts
function isSixDigitPin(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

export type TeamMemberState = { error?: string; success?: boolean } | undefined;

export async function createTeamMember(
  prevState: TeamMemberState,
  formData: FormData
): Promise<TeamMemberState> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const fullName = formData.get("full_name");
  const role = formData.get("role");
  const pin = formData.get("pin");
  const pinConfirm = formData.get("pin_confirm");
  const recoveryContact = formData.get("recovery_contact");

  if (typeof fullName !== "string" || fullName.trim() === "") {
    return { error: "กรุณากรอกชื่อ-นามสกุล" };
  }
  if (role !== "manager" && role !== "staff") {
    return { error: "ตำแหน่งไม่ถูกต้อง" };
  }
  if (!isSixDigitPin(pin) || pin !== pinConfirm) {
    return { error: "PIN ต้องเป็นตัวเลข 6 หลัก และตรงกันทั้ง 2 ช่อง" };
  }

  const supabase = await createClient();
  const { data: existingMembers } = await supabase
    .from("profiles")
    .select("pin_hash")
    .eq("tenant_id", profile.tenant_id)
    .not("pin_hash", "is", null);

  for (const member of existingMembers ?? []) {
    if (member.pin_hash && (await bcrypt.compare(pin, member.pin_hash))) {
      return { error: "PIN นี้ถูกใช้แล้วในร้านนี้ กรุณาใช้ PIN อื่น" };
    }
  }

  const admin = createAdminClient();
  const syntheticEmail = `staff.${crypto.randomUUID()}@internal.kidkubpos.local`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: syntheticEmail,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (createError || !created.user) {
    return { error: "สร้างบัญชีพนักงานไม่สำเร็จ" };
  }

  const pinHash = await bcrypt.hash(pin, 10);
  const { error: insertError } = await admin.from("profiles").insert({
    id: created.user.id,
    tenant_id: profile.tenant_id,
    full_name: fullName.trim(),
    role,
    pin_hash: pinHash,
    recovery_contact: typeof recoveryContact === "string" ? recoveryContact.trim() : null,
    auth_managed: false,
  });
  if (insertError) {
    return { error: "บันทึกข้อมูลพนักงานไม่สำเร็จ" };
  }

  revalidatePath("/settings/team");
  return { success: true };
}

export async function resetTeamMemberPin(
  prevState: TeamMemberState,
  formData: FormData
): Promise<TeamMemberState> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const memberId = formData.get("member_id");
  const pin = formData.get("pin");
  const pinConfirm = formData.get("pin_confirm");

  if (typeof memberId !== "string") {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }
  if (!isSixDigitPin(pin) || pin !== pinConfirm) {
    return { error: "PIN ต้องเป็นตัวเลข 6 หลัก และตรงกันทั้ง 2 ช่อง" };
  }

  const supabase = await createClient();
  const { data: existingMembers } = await supabase
    .from("profiles")
    .select("id, pin_hash")
    .eq("tenant_id", profile.tenant_id)
    .not("pin_hash", "is", null);

  for (const member of existingMembers ?? []) {
    if (
      member.id !== memberId &&
      member.pin_hash &&
      (await bcrypt.compare(pin, member.pin_hash))
    ) {
      return { error: "PIN นี้ถูกใช้แล้วในร้านนี้ กรุณาใช้ PIN อื่น" };
    }
  }

  const pinHash = await bcrypt.hash(pin, 10);
  const { error } = await supabase
    .from("profiles")
    .update({ pin_hash: pinHash, pin_failed_attempts: 0, pin_locked_until: null })
    .eq("id", memberId)
    .eq("tenant_id", profile.tenant_id);
  if (error) return { error: "ตั้ง PIN ใหม่ไม่สำเร็จ" };

  revalidatePath("/settings/team");
  return { success: true };
}
```

Note: `crypto.randomUUID()` is a global in the Node.js runtime Next.js Server Actions run on — no
import needed. `admin.from("profiles")` uses the service-role client to bypass RLS for this one
insert (there is no `profiles` INSERT policy for regular authenticated users, matching the
project's existing pattern of provisioning `profiles` rows only through privileged paths).

- [ ] **Step 2: Create the "add team member" form component**

```tsx
// src/components/settings/team-member-form.tsx
"use client";
import { useActionState, useRef } from "react";
import { createTeamMember, type TeamMemberState } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TeamMemberForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<TeamMemberState, FormData>(
    async (prevState, formData) => {
      const result = await createTeamMember(prevState, formData);
      if (result?.success) formRef.current?.reset();
      return result;
    },
    undefined
  );

  return (
    <form ref={formRef} action={action} className="space-y-3 rounded-lg border bg-white p-4">
      <div className="space-y-1.5">
        <Label htmlFor="full_name">ชื่อ-นามสกุล</Label>
        <Input id="full_name" name="full_name" type="text" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="role">ตำแหน่ง</Label>
        <select
          id="role"
          name="role"
          required
          className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="manager">Manager</option>
          <option value="staff">Staff</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
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
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="recovery_contact">ช่องทางติดต่อ (ไม่บังคับ)</Label>
        <Input id="recovery_contact" name="recovery_contact" type="text" />
      </div>
      {state?.error !== undefined && (
        <p className="text-sm text-destructive font-medium">{state.error}</p>
      )}
      {state?.success && (
        <p className="text-sm text-success font-medium">เพิ่มพนักงานสำเร็จ</p>
      )}
      <Button
        type="submit"
        disabled={pending}
        className="w-full bg-accent hover:bg-accent/90 text-white"
      >
        {pending ? "กำลังบันทึก…" : "+ เพิ่มพนักงาน"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Create the reset-PIN form component**

```tsx
// src/components/settings/reset-pin-form.tsx
"use client";
import { useActionState, useState } from "react";
import { resetTeamMemberPin, type TeamMemberState } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ResetPinForm({ memberId }: { memberId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<TeamMemberState, FormData>(
    resetTeamMemberPin,
    undefined
  );

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        ตั้ง PIN ใหม่
      </Button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="member_id" value={memberId} />
      <Input
        name="pin"
        type="password"
        inputMode="numeric"
        maxLength={6}
        placeholder="PIN ใหม่"
        required
        className="w-24"
      />
      <Input
        name="pin_confirm"
        type="password"
        inputMode="numeric"
        maxLength={6}
        placeholder="ยืนยัน"
        required
        className="w-24"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "…" : "บันทึก"}
      </Button>
      {state?.error !== undefined && (
        <p className="text-xs text-destructive">{state.error}</p>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Wire both into the Team page**

In `src/app/(shell)/settings/team/page.tsx`, add imports:

```ts
import { TeamMemberForm } from "@/components/settings/team-member-form";
import { ResetPinForm } from "@/components/settings/reset-pin-form";
```

Replace the `<RoleSelectForm .../>` line (currently the sole action per non-self row) with both
controls side by side:

```tsx
              <div className="flex items-center gap-2">
                <RoleSelectForm
                  action={updateMemberRole}
                  memberId={member.id}
                  currentRole={member.role}
                />
                <ResetPinForm memberId={member.id} />
              </div>
```

Add `<TeamMemberForm />` right after the closing `</div>` of the members list container (i.e.,
after the `divide-y` list `<div>` and its `{members.length === 0 && (...)}` block), before the
outer wrapping `<div>` closes.

- [ ] **Step 5: Verify**

Run `npx tsc --noEmit` — expect clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/settings.ts src/app/\(shell\)/settings/team/page.tsx src/components/settings/team-member-form.tsx src/components/settings/reset-pin-form.tsx
git commit -m "feat(settings): add team member creation with PIN + PIN reset"
```

---

### Task 7: PIN Pad Component + Job Level Screen (Owner tile)

**Files:**
- Create: `src/components/ui/pin-pad.tsx`
- Create: `src/app/(auth)/job-level/page.tsx`
- Create: `src/app/actions/job-level.ts`
- Modify: `src/app/(auth)/layout.tsx` (confirm it renders `{children}` centered — read before
  editing; if it already just centers content with no auth check, as found during design
  research, no change is needed here)

**Interfaces:**
- Consumes: `getProfile()` from `src/lib/dal.ts`.
- Produces: `setOwnPin(prevState, formData)`, `verifyOwnPin(prevState, formData)` exported from
  `src/app/actions/job-level.ts`. Consumed by this task's page now; `switchToMember` (Task 8) and
  the shell gate (Task 9) build on the same file.

- [ ] **Step 1: Create the reusable PIN pad component**

```tsx
// src/components/ui/pin-pad.tsx
"use client";
import { useState } from "react";
import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";

export function PinPad({
  length = 6,
  onComplete,
  disabled,
}: {
  length?: number;
  onComplete: (pin: string) => void;
  disabled?: boolean;
}) {
  const [digits, setDigits] = useState<string[]>([]);

  function pressDigit(d: string) {
    if (disabled || digits.length >= length) return;
    const next = [...digits, d];
    setDigits(next);
    if (next.length === length) {
      onComplete(next.join(""));
      setDigits([]);
    }
  }

  function backspace() {
    if (disabled) return;
    setDigits((prev) => prev.slice(0, -1));
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex gap-3">
        {Array.from({ length }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "size-3.5 rounded-full border-2 border-sidebar/30",
              i < digits.length && "bg-sidebar border-sidebar"
            )}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            onClick={() => pressDigit(d)}
            className="size-14 rounded-full text-xl font-medium text-sidebar hover:bg-muted/40 active:bg-muted/60 disabled:opacity-50 transition-colors"
          >
            {d}
          </button>
        ))}
        <div />
        <button
          type="button"
          disabled={disabled}
          onClick={() => pressDigit("0")}
          className="size-14 rounded-full text-xl font-medium text-sidebar hover:bg-muted/40 active:bg-muted/60 disabled:opacity-50 transition-colors"
        >
          0
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={backspace}
          className="size-14 rounded-full flex items-center justify-center text-sidebar hover:bg-muted/40 active:bg-muted/60 disabled:opacity-50 transition-colors"
        >
          <Delete size={20} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/actions/job-level.ts` with the Owner-facing actions**

```ts
"use server";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_SECONDS = 30;
const WORKER_COOKIE = "worker_verified";

export type PinState = { error?: string } | undefined;

export async function setOwnPin(
  prevState: PinState,
  formData: FormData
): Promise<PinState> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบใหม่" };
  if (profile.pin_hash !== null) return { error: "คุณตั้ง PIN ไว้แล้ว" };

  const pin = formData.get("pin");
  const pinConfirm = formData.get("pin_confirm");
  if (
    typeof pin !== "string" ||
    typeof pinConfirm !== "string" ||
    !/^\d{6}$/.test(pin) ||
    pin !== pinConfirm
  ) {
    return { error: "PIN ต้องเป็นตัวเลข 6 หลัก และตรงกันทั้ง 2 ช่อง" };
  }

  const supabase = await createClient();
  const pinHash = await bcrypt.hash(pin, 10);
  const { error } = await supabase
    .from("profiles")
    .update({ pin_hash: pinHash })
    .eq("id", profile.id);
  if (error) return { error: "ตั้ง PIN ไม่สำเร็จ" };

  const cookieStore = await cookies();
  cookieStore.set(WORKER_COOKIE, profile.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect("/");
}

export async function verifyOwnPin(
  prevState: PinState,
  formData: FormData
): Promise<PinState> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบใหม่" };
  if (profile.pin_hash === null) return { error: "ยังไม่ได้ตั้ง PIN" };

  if (profile.pin_locked_until && new Date(profile.pin_locked_until) > new Date()) {
    const secondsLeft = Math.ceil(
      (new Date(profile.pin_locked_until).getTime() - Date.now()) / 1000
    );
    return { error: `ลองใหม่ในอีก ${secondsLeft} วินาที` };
  }

  const pin = formData.get("pin");
  if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
    return { error: "PIN ไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const correct = await bcrypt.compare(pin, profile.pin_hash);

  if (!correct) {
    const attempts = profile.pin_failed_attempts + 1;
    const lockedOut = attempts >= LOCKOUT_THRESHOLD;
    await supabase
      .from("profiles")
      .update({
        pin_failed_attempts: lockedOut ? 0 : attempts,
        pin_locked_until: lockedOut
          ? new Date(Date.now() + LOCKOUT_SECONDS * 1000).toISOString()
          : null,
      })
      .eq("id", profile.id);
    return { error: "PIN ไม่ถูกต้อง" };
  }

  await supabase
    .from("profiles")
    .update({ pin_failed_attempts: 0, pin_locked_until: null })
    .eq("id", profile.id);

  const cookieStore = await cookies();
  cookieStore.set(WORKER_COOKIE, profile.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect("/");
}
```

- [ ] **Step 3: Create the Job Level page (Owner tile only for this task)**

```tsx
// src/app/(auth)/job-level/page.tsx
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { OwnerTile } from "@/components/job-level/owner-tile";

export default async function JobLevelPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <div className="w-full max-w-md space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold text-sidebar">KIDKUB JOB LEVEL</h1>
        <p className="text-sm text-muted-foreground">เลือกตำแหน่งของคุณเพื่อเข้าใช้งาน</p>
      </div>
      <OwnerTile hasPinSet={profile.pin_hash !== null} />
    </div>
  );
}
```

This task ships only the Owner tile end-to-end so it can be verified independently; Task 8 adds
the Manager/Staff tiles into the same page (extending, not replacing, this file).

- [ ] **Step 4: Create the Owner tile client component**

```tsx
// src/components/job-level/owner-tile.tsx
"use client";
import { useActionState, useState } from "react";
import { setOwnPin, verifyOwnPin, type PinState } from "@/app/actions/job-level";
import { PinPad } from "@/components/ui/pin-pad";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function OwnerTile({ hasPinSet }: { hasPinSet: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full rounded-lg border bg-white p-6 text-center hover:shadow-md transition-shadow"
      >
        <p className="text-lg font-semibold text-sidebar">OWNER</p>
      </button>
    );
  }

  return hasPinSet ? <VerifyOwnerPin /> : <SetOwnerPin />;
}

function SetOwnerPin() {
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

function VerifyOwnerPin() {
  const [state, action, pending] = useActionState<PinState, FormData>(verifyOwnPin, undefined);
  const [formRef, setFormRef] = useState<HTMLFormElement | null>(null);

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
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Verify**

Run `npx tsc --noEmit` — expect clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/pin-pad.tsx src/app/\(auth\)/job-level src/app/actions/job-level.ts src/components/job-level/owner-tile.tsx
git commit -m "feat(auth): add PIN pad + job-level screen (Owner tile)"
```

---

### Task 8: Job Level Screen — Manager/Staff Tiles + Session Switch

**Files:**
- Modify: `src/app/(auth)/job-level/page.tsx` (add Manager/Staff tiles)
- Modify: `src/app/actions/job-level.ts` (add `switchToMember`)
- Create: `src/components/job-level/role-tile.tsx`
- Modify: `src/lib/dal.ts` (add `getTeamMembersByRole`)

**Interfaces:**
- Consumes: `createAdminClient()` from Task 2, `getTeamMembers`-style query pattern already in
  `src/lib/dal.ts:174-182`.
- Produces: `switchToMember(prevState, formData)` exported from `src/app/actions/job-level.ts`.

- [ ] **Step 1: Add `getTeamMembersByRole` to `src/lib/dal.ts`**

Add directly after the existing `getTeamMembers` function (`src/lib/dal.ts:174-182`):

```ts
export async function getTeamMembersByRole(
  tenantId: string,
  role: "manager" | "staff"
): Promise<Pick<TeamMember, "id" | "full_name">[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("tenant_id", tenantId)
    .eq("role", role)
    .order("full_name", { ascending: true });
  return (data ?? []) as Pick<TeamMember, "id" | "full_name">[];
}
```

- [ ] **Step 2: Add `switchToMember` to `src/app/actions/job-level.ts`**

First, add this line to the existing top-of-file import block in `src/app/actions/job-level.ts`
(alongside the `bcrypt`/`cookies`/`redirect`/`createClient`/`getProfile` imports from Task 7 —
do not place it mid-file):

```ts
import { createAdminClient } from "@/lib/supabase/admin";
```

Then append the following to the bottom of the same file (reuses the
`LOCKOUT_THRESHOLD`/`LOCKOUT_SECONDS`/`WORKER_COOKIE` constants already defined in this file from
Task 7):

```ts

export async function switchToMember(
  prevState: PinState,
  formData: FormData
): Promise<PinState> {
  const callerProfile = await getProfile();
  if (!callerProfile) return { error: "กรุณาเข้าสู่ระบบใหม่" };

  const memberId = formData.get("member_id");
  const pin = formData.get("pin");
  if (typeof memberId !== "string" || typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("id, pin_hash, pin_failed_attempts, pin_locked_until")
    .eq("id", memberId)
    .eq("tenant_id", callerProfile.tenant_id)
    .single();

  if (!target || !target.pin_hash) {
    return { error: "ไม่พบข้อมูลพนักงาน" };
  }
  if (target.pin_locked_until && new Date(target.pin_locked_until) > new Date()) {
    const secondsLeft = Math.ceil(
      (new Date(target.pin_locked_until).getTime() - Date.now()) / 1000
    );
    return { error: `ลองใหม่ในอีก ${secondsLeft} วินาที` };
  }

  const correct = await bcrypt.compare(pin, target.pin_hash);
  if (!correct) {
    const attempts = target.pin_failed_attempts + 1;
    const lockedOut = attempts >= LOCKOUT_THRESHOLD;
    await supabase
      .from("profiles")
      .update({
        pin_failed_attempts: lockedOut ? 0 : attempts,
        pin_locked_until: lockedOut
          ? new Date(Date.now() + LOCKOUT_SECONDS * 1000).toISOString()
          : null,
      })
      .eq("id", target.id);
    return { error: "PIN ไม่ถูกต้อง" };
  }

  await supabase
    .from("profiles")
    .update({ pin_failed_attempts: 0, pin_locked_until: null })
    .eq("id", target.id);

  const admin = createAdminClient();
  const { data: authUser, error: getUserError } = await admin.auth.admin.getUserById(target.id);
  if (getUserError || !authUser.user?.email) {
    return { error: "สลับผู้ใช้งานไม่สำเร็จ" };
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: authUser.user.email,
  });
  if (linkError || !linkData) {
    return { error: "สลับผู้ใช้งานไม่สำเร็จ" };
  }

  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError) {
    return { error: "สลับผู้ใช้งานไม่สำเร็จ" };
  }

  const cookieStore = await cookies();
  cookieStore.set(WORKER_COOKIE, target.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect("/");
}
```

- [ ] **Step 3: Create the Manager/Staff role-tile component**

```tsx
// src/components/job-level/role-tile.tsx
"use client";
import { useActionState, useState } from "react";
import { switchToMember, type PinState } from "@/app/actions/job-level";
import { PinPad } from "@/components/ui/pin-pad";
import { Card, CardContent } from "@/components/ui/card";

export function RoleTile({
  label,
  members,
}: {
  label: string;
  members: { id: string; full_name: string | null }[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [formRef, setFormRef] = useState<HTMLFormElement | null>(null);
  const [state, action, pending] = useActionState<PinState, FormData>(
    switchToMember,
    undefined
  );

  if (members.length === 0) {
    return (
      <div className="w-full rounded-lg border bg-white/50 p-6 text-center opacity-50">
        <p className="text-lg font-semibold text-sidebar">{label}</p>
        <p className="text-xs text-muted-foreground mt-1">
          ให้ Owner เพิ่มพนักงานที่ตั้งค่า &gt; ทีมงาน
        </p>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="w-full rounded-lg border bg-white p-4 space-y-2">
        <p className="text-lg font-semibold text-sidebar text-center">{label}</p>
        {members.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setSelected(m.id)}
            className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted/40 transition-colors"
          >
            {m.full_name ?? "—"}
          </button>
        ))}
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form ref={setFormRef} action={action} className="flex flex-col items-center gap-4">
          <input type="hidden" name="member_id" value={selected} />
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
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Extend the Job Level page with the two tiles**

Replace the whole file `src/app/(auth)/job-level/page.tsx` with:

```tsx
import { redirect } from "next/navigation";
import { getProfile, getTeamMembersByRole } from "@/lib/dal";
import { OwnerTile } from "@/components/job-level/owner-tile";
import { RoleTile } from "@/components/job-level/role-tile";

export default async function JobLevelPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const [managers, staff] = await Promise.all([
    getTeamMembersByRole(profile.tenant_id, "manager"),
    getTeamMembersByRole(profile.tenant_id, "staff"),
  ]);

  return (
    <div className="w-full max-w-md space-y-4">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold text-sidebar">KIDKUB JOB LEVEL</h1>
        <p className="text-sm text-muted-foreground">เลือกตำแหน่งของคุณเพื่อเข้าใช้งาน</p>
      </div>
      <OwnerTile hasPinSet={profile.pin_hash !== null} />
      <RoleTile label="MANAGER" members={managers} />
      <RoleTile label="STAFF" members={staff} />
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run `npx tsc --noEmit` — expect clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(auth\)/job-level/page.tsx src/app/actions/job-level.ts src/components/job-level/role-tile.tsx src/lib/dal.ts
git commit -m "feat(auth): add Manager/Staff job-level tiles with session-switch PIN"
```

---

### Task 9: Shell Gate + Switch-Worker Button + Products Staff-Restriction Fix

**Files:**
- Modify: `src/app/(shell)/layout.tsx` (add `worker_verified` cookie check)
- Modify: `src/app/actions/job-level.ts` (add `switchWorker`)
- Modify: `src/components/shell/sidebar.tsx` (add switch-worker button; fix Products `minRole`)
- Create: `src/components/shell/switch-worker-button.tsx`
- Modify: `src/app/(shell)/products/page.tsx` (add the missing staff redirect)

**Interfaces:**
- Produces: `switchWorker()` exported from `src/app/actions/job-level.ts`.

Research during design found every other back-office page (`Inventory`, `Customers`, `Categories`,
`Modifiers`, `Settings`) already redirects Staff away — `/products` is the one gap, where Staff can
currently view (though not edit) the page. This task closes that gap to match the confirmed
"Staff: Dashboard, POS, Orders, Shifts only" access list.

- [ ] **Step 1: Add `switchWorker` to `src/app/actions/job-level.ts`**

```ts
export async function switchWorker(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(WORKER_COOKIE);
  redirect("/job-level");
}
```

- [ ] **Step 2: Add the cookie gate to the shell layout**

Modify `src/app/(shell)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { getAuthUser } from "@/lib/dal";

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const cookieStore = await cookies();
  if (!cookieStore.has("worker_verified")) redirect("/job-level");

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-surface p-4 pb-20 md:p-6 md:pb-6">
          {children}
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the switch-worker button**

```tsx
// src/components/shell/switch-worker-button.tsx
"use client";
import { switchWorker } from "@/app/actions/job-level";
import { Repeat } from "lucide-react";

export function SwitchWorkerButton() {
  return (
    <form action={switchWorker}>
      <button
        type="submit"
        className="flex items-center gap-3 h-10 px-2 w-full rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="สลับผู้ใช้งาน"
      >
        <Repeat size={20} className="shrink-0" />
        <span className="hidden lg:inline text-sm font-medium">สลับผู้ใช้งาน</span>
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Wire it into the sidebar + fix Products `minRole`**

In `src/components/shell/sidebar.tsx`:
- Change `{ href: "/products", label: "Products", icon: Package, minRole: "staff" }` to
  `{ href: "/products", label: "Products", icon: Package, minRole: "manager" }` (line 30).
- Add `import { SwitchWorkerButton } from "./switch-worker-button";`.
- Add `<SwitchWorkerButton />` directly above `<LogoutButton />` (inside the same bottom `<div>`).

- [ ] **Step 5: Add the missing Staff redirect to the Products page**

In `src/app/(shell)/products/page.tsx`, directly after the existing:

```tsx
  const profile = await getProfile();
  if (!profile) redirect("/login");
```

Add:

```tsx
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");
```

(matching the exact pattern already used in `src/app/(shell)/inventory/page.tsx:23` and
`src/app/(shell)/customers/page.tsx:8`). Also remove the now-redundant `canManage` gating on the
"+ Add Product" link/actions only if it becomes dead code after this redirect — check
`src/app/(shell)/products/page.tsx:29`'s `canManage` usage first; if it still gates anything for
`owner`/`manager` differently (it does not, both pass this new redirect identically) leave it as
harmless — do not remove `canManage` in this task, it is out of scope.

- [ ] **Step 6: Verify**

Run `npx tsc --noEmit` — expect clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(shell\)/layout.tsx src/app/actions/job-level.ts src/components/shell/switch-worker-button.tsx src/components/shell/sidebar.tsx src/app/\(shell\)/products/page.tsx
git commit -m "feat(auth): add job-level shell gate, switch-worker button, restrict Products to manager+"
```

---

### Task 10: Full-Build Check + Consolidated Live-Browser QA

**Files:** none (verification only, matches the established project convention from Stack 8/13's
"Full-build check + consolidated live-browser QA" task).

- [ ] **Step 1: Full type/build check**

```bash
npx tsc --noEmit
npm run build
```

Both must be clean.

- [ ] **Step 2: Live walk-through (controller drives the browser directly)**

1. `/register` → fill store name, email, password → lands on `/job-level`.
2. Owner tile → no PIN set yet → set a 6-digit PIN → lands on `/` (Dashboard).
3. Confirm sidebar shows the new "สลับผู้ใช้งาน" button above "ออกจากระบบ".
4. `/settings/team` → add a Staff member with a PIN → confirm success message.
5. Click "สลับผู้ใช้งาน" → back on `/job-level` → STAFF tile → pick the new name → enter their
   PIN → lands on `/`.
6. Confirm the Staff session actually switched: sidebar should now show only
   Dashboard/POS/Orders/Shifts (no Products/Categories/Inventory/Modifiers/Customers/Settings).
   Directly navigating to `/inventory`, `/settings`, and now `/products` should each redirect to
   `/`.
7. Click "สลับผู้ใช้งาน" again → back on `/job-level` → OWNER tile → enter the PIN set in step 2 →
   confirm full sidebar returns.
8. Enter a wrong PIN 5 times in a row on any tile → confirm the "ลองใหม่ในอีก 30 วินาที" lockout
   message appears, and a 6th attempt within the window is rejected without even checking the PIN.
9. `/forgot-password` → submit the Owner's email → confirm the generic success message (cannot
   verify actual email delivery without mail access, but confirm no error and no crash).
10. Confirm the OAuth buttons render on both `/login` and `/register` and that clicking one
    redirects toward Google/Facebook (or shows a clear Supabase "provider not enabled" state,
    which is the expected outcome before the user configures OAuth apps).

- [ ] **Step 3: Fix anything found, re-run Steps 1–2 until clean.**

- [ ] **Step 4: Report to the user** which of the walk-through items passed, and remind them that
  actual Google/Facebook sign-in requires configuring OAuth apps in Google Cloud Console / Facebook
  Developers and pasting the Client ID/Secret into the Supabase Dashboard (their own follow-up,
  per the spec's Section 8).
