# Stack 2: Authentication & Multi-tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่ม Supabase Email/Password login, ดึงข้อมูล profile (role + tenant) จาก DB, และ protect routes ด้วย Next.js 16 Proxy

**Architecture:** ใช้ Route Groups (`(auth)` / `(shell)`) แยก layout ของ login page ออกจาก shell — หน้า login ไม่มี Sidebar/Topbar. Session ถูก manage โดย Supabase SSR cookies. Route protection ใช้ `src/proxy.ts` (Next.js 16 รีเนมจาก middleware → proxy) ทำ redirect เร็วก่อน render. Data Access Layer (`src/lib/dal.ts`) ใช้ React `cache()` เพื่อ memoize server-side session + profile fetches. Sidebar กรอง nav items ตาม role จาก DAL.

**Tech Stack:** `@supabase/ssr@^0.12.0`, Next.js 16 App Router (proxy.ts), React 19 `useActionState`, React `cache()`, Tailwind v4, Shadcn UI v4

## Global Constraints

- Next.js version: 16.2.9 — Proxy file is `src/proxy.ts` (NOT `middleware.ts` — deprecated in v16)
- Proxy function export name: `proxy` (NOT `middleware` — renamed in v16)
- All `npm run dev` / `npm run build` MUST include `--webpack` flag (already in package.json scripts — อย่า override)
- TypeScript: strict + `noUncheckedIndexedAccess` — ห้ามใช้ unchecked array access
- ห้าม commit `.env.local` หรือ Supabase keys
- `"use server"` ที่ top ของ actions file; `"use client"` ที่ top ของ Client Components
- Server Components ห้ามใช้ React hooks — Client Components เท่านั้น
- `createClient()` จาก `@/lib/supabase/server` เป็น async function — ต้อง `await`
- Brand colors: accent `#ff6b35`, sidebar `#0c1a3d`, surface `#eef3fc`, danger `#f43f5e`

---

## ไฟล์ที่จะถูกสร้าง/แก้ไข/ลบ

| ไฟล์ | Action | หน้าที่ |
|------|--------|---------|
| `src/app/layout.tsx` | แก้ไข | ลบ Sidebar/Topbar ออก — root layout เหลือแค่ html/body + fonts |
| `src/app/(auth)/layout.tsx` | สร้าง | Centered layout สำหรับ auth pages (ไม่มี shell) |
| `src/app/(auth)/login/page.tsx` | สร้าง | Login form (Client Component — ใช้ useActionState) |
| `src/app/(shell)/layout.tsx` | สร้าง | Shell layout (Sidebar + Topbar) + server-side session guard |
| `src/app/(shell)/page.tsx` | สร้าง | Dashboard (ย้ายมาจาก src/app/page.tsx) |
| `src/app/page.tsx` | ลบ | Moved to (shell)/page.tsx |
| `src/app/actions/auth.ts` | สร้าง | Server Actions: signIn + signOut |
| `src/lib/dal.ts` | สร้าง | Data Access Layer: getAuthUser + getProfile (React cache) |
| `src/proxy.ts` | สร้าง | Route protection — redirect unauthed users to /login |
| `src/components/shell/logout-button.tsx` | สร้าง | Client Component สำหรับ logout (form + signOut action) |
| `src/components/shell/sidebar.tsx` | แก้ไข | Role-based nav filtering + logout button at bottom |
| `src/components/shell/topbar.tsx` | แก้ไข | เพิ่ม LogoutButton สำหรับ mobile |

---

## Task 1: Route Group Layout Restructure

**Goal:** แยก layout ของ auth pages กับ shell pages ด้วย Route Groups  
**Files:**
- Modify: `src/app/layout.tsx`
- Create: `src/app/(auth)/layout.tsx`
- Create: `src/app/(shell)/layout.tsx` (no auth check yet — added in Task 3)
- Create: `src/app/(shell)/page.tsx`
- Delete: `src/app/page.tsx`

**Interfaces:**
- Consumes: `@/components/shell/sidebar`, `@/components/shell/topbar` (existing)
- Produces: `ShellLayout` (used by all protected pages), `AuthLayout` (used by login page)

---

- [ ] **Step 1: แก้ไข `src/app/layout.tsx`** — ลบ Sidebar, Topbar, และ import ที่ไม่จำเป็นออก

```tsx
// src/app/layout.tsx
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#0c1a3d",
};

export const metadata: Metadata = {
  title: "KIDKUBPOS",
  description: "Multi-tenant POS Ecosystem for modern retail businesses",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "KIDKUBPOS",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full">{children}</body>
    </html>
  );
}
```

---

- [ ] **Step 2: สร้าง `src/app/(auth)/layout.tsx`** — centered container สำหรับ auth pages

```tsx
// src/app/(auth)/layout.tsx
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center bg-surface p-4">
      {children}
    </div>
  );
}
```

---

- [ ] **Step 3: สร้าง `src/app/(shell)/layout.tsx`** — shell layout พร้อม Sidebar + Topbar (auth guard จะเพิ่มใน Task 3)

```tsx
// src/app/(shell)/layout.tsx
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-surface p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
```

---

- [ ] **Step 4: สร้าง `src/app/(shell)/page.tsx`** — dashboard (เนื้อหาเหมือน `src/app/page.tsx` เดิม)

```tsx
// src/app/(shell)/page.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const stats = [
  { title: "ยอดขายวันนี้", value: "฿0", variant: "default" as const },
  { title: "ออเดอร์", value: "0", variant: "default" as const },
  { title: "สินค้า", value: "0", variant: "secondary" as const },
  { title: "ลูกค้า", value: "0", variant: "secondary" as const },
] satisfies { title: string; value: string; variant: "default" | "secondary" }[];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">ยินดีต้อนรับสู่ KIDKUBPOS</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ title, value, variant }) => (
          <Card key={title}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-2">
                <span className="text-2xl font-bold text-sidebar">{value}</span>
                <Badge variant={variant} className="mb-0.5">
                  {variant === "default" ? "live" : "—"}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

---

- [ ] **Step 5: ลบ `src/app/page.tsx`**

```powershell
Remove-Item "E:\KIDKUBPOS\src\app\page.tsx"
```

---

- [ ] **Step 6: TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: ไม่มี error

---

- [ ] **Step 7: ทดสอบ dev server**

```powershell
npm run dev
```

เปิด `http://localhost:3000/` — ควรเห็น Dashboard (ยังไม่มี auth redirect เพราะ proxy ยังไม่ได้สร้าง)  
เปิด `http://localhost:3000/login` — ควรเห็น blank page (auth layout แต่ยังไม่มี login page content)

หยุด dev server ด้วย `Ctrl+C`

---

- [ ] **Step 8: Commit**

```powershell
git add src/app/layout.tsx src/app/(auth)/layout.tsx src/app/(shell)/layout.tsx src/app/(shell)/page.tsx
git status
```

ตรวจว่า `src/app/page.tsx` อยู่ใน "deleted" (staged for deletion):

```powershell
git rm src/app/page.tsx
git commit -m "$(cat <<'EOF'
refactor: restructure to route groups (auth) and (shell)

- Root layout stripped to fonts + html/body only
- (auth)/layout: centered container for auth pages
- (shell)/layout: Sidebar + Topbar shell layout
- Move dashboard to (shell)/page.tsx

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Auth Server Actions + Login UI

**Goal:** สร้าง signIn/signOut Server Actions และหน้า Login ด้วย Shadcn UI + brand colors  
**Files:**
- Create: `src/app/actions/auth.ts`
- Create: `src/app/(auth)/login/page.tsx`

**Interfaces:**
- Consumes: `@/lib/supabase/server` → `createClient()` (existing)
- Produces:
  - `signIn(prevState, formData: FormData): Promise<{ error?: string } | undefined>` — callable from Client Component via useActionState
  - `signOut(): Promise<void>` — callable from form action

---

- [ ] **Step 1: สร้าง `src/app/actions/auth.ts`**

```typescript
// src/app/actions/auth.ts
"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SignInState = { error?: string } | undefined;

export async function signIn(
  prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "กรุณากรอกอีเมลและรหัสผ่าน" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  }

  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

---

- [ ] **Step 2: สร้าง `src/app/(auth)/login/page.tsx`**

```tsx
// src/app/(auth)/login/page.tsx
"use client";
import { useActionState } from "react";
import { signIn, type SignInState } from "@/app/actions/auth";
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
          {state?.error !== undefined && (
            <p className="text-sm text-danger font-medium">{state.error}</p>
          )}
          <Button
            type="submit"
            disabled={pending}
            className="w-full bg-accent hover:bg-accent/90 text-white"
          >
            {pending ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

---

- [ ] **Step 3: TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: ไม่มี error

---

- [ ] **Step 4: Smoke test — Login UI**

```powershell
npm run dev
```

เปิด `http://localhost:3000/login` — ควรเห็น:
- Card ขาวกลางหน้า (bg-surface พื้นหลัง)
- "KIDKUBPOS" ตัวหนา สีน้ำเงินเข้ม (#0c1a3d)
- Form: อีเมล + รหัสผ่าน input fields
- ปุ่ม "เข้าสู่ระบบ" สีส้ม (#ff6b35)

หยุด dev server ด้วย `Ctrl+C`

---

- [ ] **Step 5: Commit**

```powershell
git add src/app/actions/auth.ts "src/app/(auth)/login/page.tsx"
git commit -m "$(cat <<'EOF'
feat: add signIn/signOut server actions and login UI

- Server Actions: signIn (email/password via Supabase) + signOut
- Login page: Shadcn Card + brand accent button, useActionState for errors

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Data Access Layer (DAL) + Shell Auth Guard

**Goal:** สร้าง server-side session/profile fetching ด้วย React cache + เพิ่ม auth guard ใน shell layout  
**Files:**
- Create: `src/lib/dal.ts`
- Modify: `src/app/(shell)/layout.tsx`

**Interfaces:**
- Consumes: `@/lib/supabase/server` → `createClient()`
- Produces:
  - `getAuthUser(): Promise<User | null>` — memoized per render, verifies token with Supabase
  - `getProfile(): Promise<ProfileWithTenant | null>` — memoized per render, fetches profiles + tenants join
  - `type Role = "owner" | "manager" | "staff"`
  - `type ProfileWithTenant` — profile with nested tenant object

---

- [ ] **Step 1: สร้าง `src/lib/dal.ts`**

```typescript
// src/lib/dal.ts
import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "manager" | "staff";

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

export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getProfile = cache(async (): Promise<ProfileWithTenant | null> => {
  const user = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*, tenants(*)")
    .eq("id", user.id)
    .single();

  return data as ProfileWithTenant | null;
});
```

---

- [ ] **Step 2: อัปเดต `src/app/(shell)/layout.tsx`** — เพิ่ม auth guard โดยใช้ `getAuthUser()`

```tsx
// src/app/(shell)/layout.tsx
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { getAuthUser } from "@/lib/dal";

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-surface p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
```

---

- [ ] **Step 3: TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: ไม่มี error  
ถ้ามี error เกี่ยวกับ `import "server-only"` — ติดตั้ง: `npm install server-only`

---

- [ ] **Step 4: Commit**

```powershell
git add src/lib/dal.ts "src/app/(shell)/layout.tsx"
git commit -m "$(cat <<'EOF'
feat: add DAL (getAuthUser + getProfile) and shell auth guard

- dal.ts: React cache-memoized getAuthUser() + getProfile() with tenant join
- (shell)/layout: redirect to /login if no authenticated user

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Proxy (Route Protection)

**Goal:** สร้าง `src/proxy.ts` ให้ redirect ผู้ใช้ที่ยังไม่ล็อกอินไปหน้า `/login` และผู้ใช้ที่ล็อกอินแล้วออกจากหน้า `/login`  
**Files:**
- Create: `src/proxy.ts`

**หมายเหตุ สำคัญ:**
- Next.js 16 เปลี่ยนชื่อ `middleware.ts` → `proxy.ts` (deprecated ใน v16.0.0)
- ชื่อ export function ต้องเป็น `proxy` (ไม่ใช่ `middleware`)
- ไฟล์อยู่ที่ `src/proxy.ts` (เพราะ project ใช้ `src/` folder)
- Proxy ใน v16 ใช้ Node.js runtime by default (ไม่ใช่ Edge)
- ใช้ `supabase.auth.getSession()` ใน proxy (ไม่ใช่ `getUser()`) เพราะเร็วกว่า — proxy ทำงานทุก request

**Interfaces:**
- Consumes: `@supabase/ssr` → `createServerClient`, `next/server` → `NextRequest`, `NextResponse`
- Produces: `proxy(request: NextRequest)` — exported default function + `config.matcher`

---

- [ ] **Step 1: สร้าง `src/proxy.ts`**

```typescript
// src/proxy.ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { pathname } = request.nextUrl;
  const isAuthed = session !== null;
  const isLoginPage = pathname === "/login";

  if (!isAuthed && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isAuthed && isLoginPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|manifest\\.json|sw\\.js|sw\\.js\\.map).*)",
  ],
};
```

---

- [ ] **Step 2: TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: ไม่มี error

---

- [ ] **Step 3: Smoke test — Route Protection**

```powershell
npm run dev
```

**Test Case 1 — Unauthenticated redirect:**
- เปิด `http://localhost:3000/` (Incognito / ไม่มี session)
- Expected: redirect ไป `http://localhost:3000/login` ทันที
- เห็น Login form

**Test Case 2 — Login page accessible:**
- เปิด `http://localhost:3000/login` (ไม่มี session)
- Expected: เห็น Login form ปกติ (ไม่ redirect)

**Test Case 3 — Login → redirect to dashboard:**
- กรอก email/password ของ Supabase user ที่มี profile อยู่
- กด "เข้าสู่ระบบ"
- Expected: redirect ไป `/` เห็น Dashboard

**Test Case 4 — Authenticated user cannot re-enter login:**
- หลัง login แล้ว เปิด `http://localhost:3000/login`
- Expected: redirect ไป `/` (dashboard) ทันที

หยุด dev server ด้วย `Ctrl+C`

---

- [ ] **Step 4: Commit**

```powershell
git add src/proxy.ts
git commit -m "$(cat <<'EOF'
feat: add proxy.ts route protection (Next.js 16 proxy)

- Redirect unauthenticated users to /login on all protected routes
- Redirect authenticated users away from /login to /
- Matcher excludes static assets, icons, manifest, and sw.js

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Role-based Shell (Sidebar Nav + Topbar Logout)

**Goal:** Sidebar กรอง nav items ตาม role (owner > manager > staff); เพิ่ม logout button + แสดง user info; Topbar มี logout สำหรับ mobile  
**Files:**
- Create: `src/components/shell/logout-button.tsx`
- Modify: `src/components/shell/sidebar.tsx`
- Modify: `src/components/shell/topbar.tsx`

**Role access rules:**
| Nav Item | owner | manager | staff |
|----------|-------|---------|-------|
| Dashboard | ✓ | ✓ | ✓ |
| Orders | ✓ | ✓ | ✓ |
| Products | ✓ | ✓ | ✓ |
| Reports | ✓ | ✓ | ✗ |
| Settings | ✓ | ✗ | ✗ |

**Interfaces:**
- Consumes: `@/lib/dal` → `getProfile()`, `Role`, `ProfileWithTenant` (from Task 3)
- Consumes: `@/app/actions/auth` → `signOut` (from Task 2)
- Produces: `LogoutButton` component — Client Component, exports named `LogoutButton`

---

- [ ] **Step 1: สร้าง `src/components/shell/logout-button.tsx`** — Client Component สำหรับ logout

```tsx
// src/components/shell/logout-button.tsx
"use client";
import { signOut } from "@/app/actions/auth";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="flex items-center gap-3 h-10 px-2 w-full rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="ออกจากระบบ"
      >
        <LogOut size={20} className="shrink-0" />
        <span className="hidden lg:inline text-sm font-medium">ออกจากระบบ</span>
      </button>
    </form>
  );
}
```

---

- [ ] **Step 2: อัปเดต `src/components/shell/sidebar.tsx`** — role-based nav + user info + logout button

```tsx
// src/components/shell/sidebar.tsx
import Link from "next/link";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { LogoutButton } from "./logout-button";
import { getProfile, type Role } from "@/lib/dal";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  minRole: Role;
};

const allNavItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, minRole: "staff" },
  { href: "/orders", label: "Orders", icon: ShoppingCart, minRole: "staff" },
  { href: "/products", label: "Products", icon: Package, minRole: "staff" },
  { href: "/reports", label: "Reports", icon: BarChart3, minRole: "manager" },
  { href: "/settings", label: "Settings", icon: Settings, minRole: "owner" },
];

function getRoleLevel(role: Role): number {
  switch (role) {
    case "owner":
      return 3;
    case "manager":
      return 2;
    case "staff":
      return 1;
  }
}

function canAccess(userRole: Role, minRole: Role): boolean {
  return getRoleLevel(userRole) >= getRoleLevel(minRole);
}

export async function Sidebar() {
  const profile = await getProfile();
  const role = (profile?.role ?? "staff") as Role;
  const visibleItems = allNavItems.filter((item) => canAccess(role, item.minRole));

  return (
    <aside className="hidden md:flex flex-col w-16 lg:w-56 h-full shrink-0 bg-sidebar border-r border-white/10">
      <div className="flex items-center justify-center lg:justify-start h-14 px-4 border-b border-white/10 shrink-0">
        <span className="text-accent font-bold text-xl hidden lg:inline">
          KIDKUBPOS
        </span>
        <span className="text-accent font-bold text-lg lg:hidden">K</span>
      </div>
      <nav className="flex-1 py-4 flex flex-col gap-1 px-2 overflow-y-auto">
        {visibleItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 h-10 px-2 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Icon size={20} className="shrink-0" />
            <span className="hidden lg:inline text-sm font-medium">{label}</span>
          </Link>
        ))}
      </nav>
      <div className="border-t border-white/10 px-2 py-3">
        <div className="hidden lg:block px-2 pb-2">
          <p className="text-xs text-white/50 truncate">
            {profile?.full_name ?? "—"}
          </p>
          <p className="text-xs text-accent font-medium capitalize">{role}</p>
        </div>
        <LogoutButton />
      </div>
    </aside>
  );
}
```

---

- [ ] **Step 3: อัปเดต `src/components/shell/topbar.tsx`** — เพิ่ม LogoutButton สำหรับ mobile

```tsx
// src/components/shell/topbar.tsx
import { Menu } from "lucide-react";
import { LogoutButton } from "./logout-button";

export function Topbar() {
  return (
    <header className="flex md:hidden items-center gap-4 h-14 px-4 bg-sidebar border-b border-white/10 sticky top-0 z-10 shrink-0">
      <button
        type="button"
        aria-label="Open menu"
        className="text-white/70 hover:text-white transition-colors"
      >
        <Menu size={22} />
      </button>
      <span className="text-accent font-bold text-lg flex-1">KIDKUBPOS</span>
      <LogoutButton />
    </header>
  );
}
```

---

- [ ] **Step 4: TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: ไม่มี error

---

- [ ] **Step 5: Smoke test — Role-based Navigation**

```powershell
npm run dev
```

**ตรวจสอบโดยใช้ Supabase Dashboard:**

1. ไปที่ Supabase Dashboard → Table Editor → `profiles`
2. ตรวจว่ามี user ที่มี role ต่างกัน (ถ้ายังไม่มี ให้เพิ่ม profile ใน Supabase dashboard)

**Test as `owner`:**
- Login ด้วย account ที่มี role = 'owner'
- ควรเห็น nav items: Dashboard, Orders, Products, Reports, **Settings**
- ด้านล่าง sidebar: ชื่อ, "owner" สีส้ม, ปุ่ม logout

**Test as `staff`:**
- Logout แล้ว login ด้วย account ที่มี role = 'staff'
- ควรเห็น nav items: Dashboard, Orders, Products (ไม่มี Reports, ไม่มี Settings)

**Test logout button:**
- กด "ออกจากระบบ" (หรือไอคอน LogOut บน mobile)
- ควร redirect ไป `/login`

หยุด dev server ด้วย `Ctrl+C`

---

- [ ] **Step 6: Commit + Push**

```powershell
git add src/components/shell/logout-button.tsx src/components/shell/sidebar.tsx src/components/shell/topbar.tsx
git commit -m "$(cat <<'EOF'
feat: role-based sidebar nav + logout button (Shell Task 5)

- LogoutButton: Client Component using signOut server action
- Sidebar: async Server Component — filters nav by role level (owner > manager > staff)
- Sidebar footer: shows full_name + role badge + logout
- Topbar: adds LogoutButton for mobile view

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## ลำดับ Tasks และผู้รับผิดชอบ

| Task | สิ่งที่ทำ | หยุดรอ? |
|------|-----------|---------|
| 1 | Route Group Restructure (layout refactor + move dashboard) | ไม่ |
| 2 | Auth Server Actions + Login UI | ไม่ |
| 3 | DAL + Shell Auth Guard | ไม่ |
| 4 | Proxy (Route Protection) + Smoke Test | **Smoke test ที่ login flow** |
| 5 | Role-based Sidebar + Topbar Logout + Push | ไม่ |

---

## Completion Criteria — Stack 2 เสร็จสมบูรณ์เมื่อผ่านทุกข้อ

- [ ] `npx tsc --noEmit` ผ่านไม่มี error
- [ ] `/` (unauthenticated) → redirect ไป `/login` ทันที
- [ ] `/login` → แสดง login form, background สี surface (#eef3fc), ปุ่มสีส้ม (#ff6b35)
- [ ] Login ด้วย email/password ที่ถูกต้อง → redirect ไป `/` เห็น Dashboard
- [ ] Login ผิด → เห็น error message "อีเมลหรือรหัสผ่านไม่ถูกต้อง" สีแดง
- [ ] User role `owner` → เห็น 5 nav items (รวม Reports + Settings)
- [ ] User role `staff` → เห็น 3 nav items (ไม่มี Reports, Settings)
- [ ] ปุ่ม logout ทำงาน → redirect ไป `/login`
- [ ] `/login` หลัง login แล้ว → redirect ไป `/` (ไม่ให้ login ซ้ำ)
- [ ] `git log --oneline origin/main` แสดง 5 commits ใหม่ (Tasks 1-5)
- [ ] Vercel deploy สำเร็จหลัง push
