# Stack 1: Infrastructure Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap KIDKUBPOS as a production-ready Next.js 15 app with TypeScript strict mode, Tailwind CSS brand theme, Shadcn UI, Supabase connection, PWA foundation, and Vercel CI/CD.

**Architecture:** Single Next.js App Router application deployed on Vercel, connected to Supabase for data and auth. Tailwind CSS uses custom brand tokens; Shadcn UI provides the component library. next-pwa wires up the service worker so offline capability can be built in later stacks.

**Tech Stack:** Next.js 15, React 19, TypeScript 5 (strict), Tailwind CSS 3, Shadcn UI, @supabase/supabase-js, @supabase/ssr, next-pwa, GitHub Actions, Vercel

## Global Constraints

- TypeScript strict mode enabled in all files — no `any`, no untyped assertions
- Brand colors used via Tailwind tokens only — no raw hex in JSX
- Every DB table must have `tenant_id uuid NOT NULL` — enforced at schema level
- Row Level Security enabled on every table — no table left without a policy
- Touch targets minimum 44×44px on all interactive elements
- Node.js >= 20, npm >= 10
- Language locale: `th` (Thai) on `<html>` tag

---

### Task 1: Initialize Next.js Project

**Files:**
- Create: `E:\KIDKUBPOS\` (project root — initialized by CLI)
- Modify: `tsconfig.json` (add `noUncheckedIndexedAccess`)
- Create: `.gitignore` (auto-generated, verify `.env.local` excluded)

**Interfaces:**
- Produces: Running Next.js 15 dev server at `http://localhost:3000`

- [ ] **Step 1: Create Next.js app (run from parent folder E:\)**

```powershell
cd E:\
npx create-next-app@latest KIDKUBPOS --typescript --eslint --tailwind --app --src-dir --import-alias "@/*" --no-turbopack
cd KIDKUBPOS
```

When prompted interactively choose:
- TypeScript: **Yes**
- ESLint: **Yes**
- Tailwind CSS: **Yes**
- `src/` directory: **Yes**
- App Router: **Yes**
- Import alias: `@/*`

- [ ] **Step 2: Strengthen tsconfig.json with noUncheckedIndexedAccess**

Open `tsconfig.json`. Inside `"compilerOptions"` add the line after `"strict": true`:
```json
"noUncheckedIndexedAccess": true
```

Full relevant section:
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    ...
  }
}
```

- [ ] **Step 3: Run dev server to confirm baseline**

```powershell
npm run dev
```

Expected: Server starts at `http://localhost:3000`, default Next.js welcome page visible. Stop with Ctrl+C.

- [ ] **Step 4: Initial commit**

```powershell
git add .
git commit -m "feat: initialize Next.js 15 project with TypeScript strict mode"
```

---

### Task 2: Configure Tailwind CSS Brand Theme

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: Tailwind from Task 1
- Produces: Tailwind tokens `bg-accent`, `bg-sidebar`, `bg-surface`, `text-success`, `text-danger`, `text-info`, `text-warning` available in all components

- [ ] **Step 1: Replace tailwind.config.ts with brand config**

Overwrite `tailwind.config.ts` entirely:
```typescript
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // KIDKUBPOS Brand Palette
        accent:  "#ff6b35",
        sidebar: "#0c1a3d",
        surface: "#eef3fc",
        success: "#00b87a",
        danger:  "#f43f5e",
        info:    "#2563eb",
        warning: "#f59e0b",
        // Shadcn CSS-variable tokens
        border:      "hsl(var(--border))",
        input:       "hsl(var(--input))",
        ring:        "hsl(var(--ring))",
        background:  "hsl(var(--background))",
        foreground:  "hsl(var(--foreground))",
        primary: {
          DEFAULT:    "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT:    "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT:    "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 2: Replace globals.css with Shadcn-compatible variables**

Overwrite `src/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 220 60% 97%;
    --foreground: 222 84% 5%;
    --card: 0 0% 100%;
    --card-foreground: 222 84% 5%;
    --popover: 0 0% 100%;
    --popover-foreground: 222 84% 5%;
    --primary: 18 100% 60%;
    --primary-foreground: 0 0% 100%;
    --secondary: 220 14% 96%;
    --secondary-foreground: 222 47% 11%;
    --muted: 220 14% 96%;
    --muted-foreground: 215 16% 47%;
    --accent: 18 100% 60%;
    --accent-foreground: 0 0% 100%;
    --destructive: 351 83% 60%;
    --destructive-foreground: 0 0% 100%;
    --border: 220 13% 91%;
    --input: 220 13% 91%;
    --ring: 18 100% 60%;
    --radius: 0.5rem;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-surface text-foreground;
  }
}
```

- [ ] **Step 3: Verify background color change in browser**

```powershell
npm run dev
```

Open `http://localhost:3000` — the page background should now be light blue (`#eef3fc`) instead of white. Stop server.

- [ ] **Step 4: Commit**

```powershell
git add tailwind.config.ts src/app/globals.css
git commit -m "feat: configure Tailwind CSS with KIDKUBPOS brand theme"
```

---

### Task 3: Initialize Shadcn UI

**Files:**
- Create: `components.json`
- Create: `src/lib/utils.ts`
- Create: `src/components/ui/button.tsx` (+ card, badge, input, label, separator — auto-generated)

**Interfaces:**
- Consumes: Tailwind config from Task 2
- Produces: `Button`, `Card`, `CardHeader`, `CardContent`, `CardTitle`, `Badge`, `Input`, `Label`, `Separator` importable from `@/components/ui/*`
- Produces: `cn()` utility at `@/lib/utils`

- [ ] **Step 1: Run Shadcn init**

```powershell
npx shadcn@latest init
```

When prompted:
- Style: **Default**
- Base color: **Slate**
- CSS variables: **Yes**

This creates `components.json` and `src/lib/utils.ts`.

- [ ] **Step 2: Install base UI components**

```powershell
npx shadcn@latest add button card badge input label separator
```

Expected: Files created under `src/components/ui/`.

- [ ] **Step 3: Verify utils.ts**

Open `src/lib/utils.ts` and confirm it contains:
```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Smoke-test components in page.tsx**

Replace `src/app/page.tsx`:
```typescript
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <main className="min-h-screen bg-surface flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>KIDKUBPOS</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button className="bg-accent hover:bg-accent/90 text-white min-h-[44px]">
            เริ่มต้น
          </Button>
          <Button variant="outline" className="min-h-[44px]">
            ออก
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
```

```powershell
npm run dev
```

Open `http://localhost:3000` — orange button labeled "เริ่มต้น" visible on light blue background. Stop server.

- [ ] **Step 5: Commit**

```powershell
git add .
git commit -m "feat: initialize Shadcn UI with base components"
```

---

### Task 4: Connect Supabase Client

**Files:**
- Create: `.env.local`
- Create: `.env.example`
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/types/database.ts`

**Interfaces:**
- Produces: `createClient()` from `@/lib/supabase/client` → `SupabaseClient<Database>` (browser)
- Produces: `createClient()` from `@/lib/supabase/server` → `Promise<SupabaseClient<Database>>` (server / RSC)

- [ ] **Step 1: Install Supabase packages**

```powershell
npm install @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 2: Create .env.example**

Create `.env.example`:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

- [ ] **Step 3: Create .env.local with real values**

Create `.env.local` (fill in from Supabase dashboard → Settings → API):
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Confirm `.gitignore` already contains `.env.local`. If not, add it.

- [ ] **Step 4: Create placeholder Database type**

Create `src/types/database.ts`:
```typescript
export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
```

(This placeholder is replaced by auto-generated types in Task 5.)

- [ ] **Step 5: Create browser Supabase client**

Create `src/lib/supabase/client.ts`:
```typescript
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 6: Create server Supabase client**

Create `src/lib/supabase/server.ts`:
```typescript
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component — cookie mutations are no-ops here
          }
        },
      },
    }
  );
}
```

- [ ] **Step 7: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 8: Commit**

```powershell
git add src/lib/supabase/ src/types/database.ts .env.example
git commit -m "feat: add Supabase browser + server clients with typed Database stub"
```

---

### Task 5: Initial Database Schema with RLS

**Files:**
- Create: `supabase/migrations/001_initial_schema.sql`
- Modify: `src/types/database.ts` (regenerated from live schema)

**Interfaces:**
- Produces: `public.tenants` table with `id`, `name`, `slug`, `created_at`, `updated_at`
- Produces: `public.profiles` table with `id`, `tenant_id`, `full_name`, `role`, timestamps
- Produces: RLS policies on both tables enforcing per-tenant isolation
- Produces: `src/types/database.ts` with generated Supabase types for `tenants` and `profiles`

**Prerequisite:** Supabase CLI installed globally and project created on supabase.com.

- [ ] **Step 1: Install Supabase CLI and link project**

```powershell
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Get `YOUR_PROJECT_REF` from the Supabase dashboard URL: `https://supabase.com/dashboard/project/<ref>`.

- [ ] **Step 2: Create the migration file**

Create `supabase/migrations/001_initial_schema.sql`:
```sql
-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- Tenants: each business/shop is one tenant
create table public.tenants (
  id         uuid primary key default uuid_generate_v4(),
  name       text not null,
  slug       text unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Profiles: extends auth.users with tenant membership + role
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  full_name  text,
  role       text not null default 'staff'
             check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_tenant_id_idx on public.profiles(tenant_id);

-- Enable RLS
alter table public.tenants  enable row level security;
alter table public.profiles enable row level security;

-- tenants: users can read their own tenant row
create policy "tenants_select_own_tenant" on public.tenants
  for select using (
    id in (
      select tenant_id from public.profiles where id = auth.uid()
    )
  );

-- profiles: users can read all profiles in their tenant
create policy "profiles_select_own_tenant" on public.profiles
  for select using (
    tenant_id in (
      select tenant_id from public.profiles where id = auth.uid()
    )
  );

-- profiles: users can update only their own row
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

-- Auto-update updated_at on any row change
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
```

- [ ] **Step 3: Push migration to Supabase**

```powershell
supabase db push
```

Expected output: `Applying migration 001_initial_schema.sql... Done.`

- [ ] **Step 4: Regenerate TypeScript types from live schema**

```powershell
supabase gen types typescript --linked > src/types/database.ts
```

Open `src/types/database.ts` and verify it now contains `tenants` and `profiles` table definitions (not empty `Record<string, never>`).

- [ ] **Step 5: Verify TypeScript compiles with real types**

```powershell
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```powershell
git add supabase/ src/types/database.ts
git commit -m "feat: add initial DB schema (tenants + profiles) with RLS policies"
```

---

### Task 6: Configure Next-PWA

**Files:**
- Modify: `next.config.ts`
- Create: `public/manifest.json`
- Create: `public/icons/icon-192x192.png` (placeholder)
- Create: `public/icons/icon-512x512.png` (placeholder)
- Modify: `src/app/layout.tsx` (add manifest metadata)

**Interfaces:**
- Consumes: Next.js config from Task 1
- Produces: `public/sw.js` generated at build time; app PWA-installable

- [ ] **Step 1: Install next-pwa**

```powershell
npm install next-pwa
npm install --save-dev @types/next-pwa
```

- [ ] **Step 2: Update next.config.ts**

Overwrite `next.config.ts`:
```typescript
import type { NextConfig } from "next";
import withPWA from "next-pwa";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withPWA({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
})(nextConfig);
```

- [ ] **Step 3: Create public/manifest.json**

Create `public/manifest.json`:
```json
{
  "name": "KIDKUBPOS",
  "short_name": "KIDKUBPOS",
  "description": "ระบบจัดการร้านค้าอัจฉริยะ",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#eef3fc",
  "theme_color": "#0c1a3d",
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

- [ ] **Step 4: Add placeholder icons**

Create the icons directory and add placeholder PNGs (any valid PNG files renamed to match):
```powershell
New-Item -ItemType Directory -Force "public\icons"
```

Place any valid 192×192 PNG as `public/icons/icon-192x192.png` and any valid 512×512 PNG as `public/icons/icon-512x512.png`. Real branded icons are created in the UI design phase.

- [ ] **Step 5: Add manifest to layout metadata**

Modify `src/app/layout.tsx` — update the `metadata` export:
```typescript
export const metadata: Metadata = {
  title: "KIDKUBPOS",
  description: "ระบบจัดการร้านค้าอัจฉริยะ",
  manifest: "/manifest.json",
  themeColor: "#0c1a3d",
};
```

- [ ] **Step 6: Build and verify service worker is generated**

```powershell
npm run build
```

Expected: Build succeeds. Files `public/sw.js` and `public/workbox-*.js` are generated.

- [ ] **Step 7: Commit**

```powershell
git add next.config.ts public/manifest.json public/icons/ src/app/layout.tsx
git commit -m "feat: configure Next-PWA with KIDKUBPOS manifest and service worker"
```

---

### Task 7: Root Layout with Brand Shell

**Files:**
- Create: `src/components/shell/sidebar.tsx`
- Create: `src/components/shell/topbar.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: Brand tokens from Task 2, `cn()` from Task 3, `Badge` from Task 3
- Produces: Responsive layout — sidebar (md+) + topbar (mobile) wrapping all pages

- [ ] **Step 1: Create Sidebar component**

Create `src/components/shell/sidebar.tsx`:
```typescript
"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

interface SidebarProps {
  items: NavItem[];
  className?: string;
}

export function Sidebar({ items, className }: SidebarProps) {
  return (
    <aside
      className={cn(
        "hidden md:flex flex-col w-60 min-h-screen bg-sidebar text-white shrink-0",
        className
      )}
    >
      <div className="flex items-center gap-1 px-6 py-5 border-b border-white/10">
        <span className="text-accent font-bold text-xl">KIDKUB</span>
        <span className="font-bold text-xl text-white">POS</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 px-3 rounded-md text-sm text-white/80 hover:text-white hover:bg-white/10 transition-colors min-h-[44px]"
          >
            <span className="text-base w-5 text-center">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Create Topbar component (mobile only)**

Create `src/components/shell/topbar.tsx`:
```typescript
interface TopbarProps {
  title?: string;
}

export function Topbar({ title }: TopbarProps) {
  return (
    <header className="md:hidden flex items-center px-4 h-14 bg-sidebar text-white shrink-0">
      <span className="font-bold text-lg">
        <span className="text-accent">KIDKUB</span>POS
      </span>
      {title && (
        <span className="ml-auto text-sm text-white/70">{title}</span>
      )}
    </header>
  );
}
```

- [ ] **Step 3: Update root layout with shell**

Overwrite `src/app/layout.tsx`:
```typescript
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KIDKUBPOS",
  description: "ระบบจัดการร้านค้าอัจฉริยะ",
  manifest: "/manifest.json",
};

const NAV_ITEMS = [
  { href: "/",         label: "หน้าหลัก",      icon: "🏠" },
  { href: "/orders",   label: "รายการออเดอร์", icon: "📋" },
  { href: "/products", label: "สินค้า",        icon: "🛒" },
  { href: "/reports",  label: "รายงาน",        icon: "📊" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body className={`${geistSans.variable} antialiased bg-surface`}>
        <div className="flex min-h-screen">
          <Sidebar items={NAV_ITEMS} />
          <div className="flex-1 flex flex-col min-w-0">
            <Topbar />
            <main className="flex-1 p-4 md:p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Update page.tsx to dashboard placeholder**

Overwrite `src/app/page.tsx`:
```typescript
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-foreground">หน้าหลัก</h1>
        <Badge className="bg-success text-white hover:bg-success/90">ออนไลน์</Badge>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">KIDKUBPOS พร้อมใช้งาน</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Infrastructure setup เสร็จสมบูรณ์ พร้อมพัฒนาระบบต่อไป
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Visually verify responsive layout**

```powershell
npm run dev
```

Open `http://localhost:3000`:
- **Desktop (≥ 768px):** Left sidebar navy `#0c1a3d`, content area light blue, "KIDKUB" in orange `#ff6b35`
- **Mobile (< 768px):** Sidebar hidden, navy topbar 56px tall appears at top
- Both: Green "ออนไลน์" badge, card renders correctly

Stop server.

- [ ] **Step 6: TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Commit**

```powershell
git add src/components/shell/ src/app/layout.tsx src/app/page.tsx
git commit -m "feat: add responsive brand shell layout (sidebar + mobile topbar)"
```

---

### Task 8: GitHub Repository + Vercel CI/CD

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `vercel.json`

**Interfaces:**
- Produces: Auto-deploy on push to `main`, TypeScript + lint check on PRs

**Prerequisite:** GitHub account, Vercel account linked to GitHub.

- [ ] **Step 1: Push to GitHub**

Create a new empty repository named `KIDKUBPOS` on GitHub, then:
```powershell
git remote add origin https://github.com/<your-username>/KIDKUBPOS.git
git branch -M main
git push -u origin main
```

- [ ] **Step 2: Create GitHub Actions CI workflow**

Create `.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  typecheck:
    name: TypeScript
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npx tsc --noEmit

  lint:
    name: ESLint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run lint
```

- [ ] **Step 3: Create vercel.json**

Create `vercel.json`:
```json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "devCommand": "npm run dev",
  "installCommand": "npm install"
}
```

- [ ] **Step 4: Connect Vercel**

1. Go to https://vercel.com/new
2. Import the `KIDKUBPOS` GitHub repository
3. Add environment variables in Vercel dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Click **Deploy**

Expected: Vercel deployment URL appears (e.g., `kidkubpos.vercel.app`).

- [ ] **Step 5: Push CI config and verify green pipeline**

```powershell
git add .github/ vercel.json
git commit -m "feat: add GitHub Actions CI and Vercel deployment config"
git push
```

Expected: GitHub Actions shows green checks, Vercel auto-deploys from `main`.

---

## Self-Review

### Spec Coverage

| Requirement (CLAUDE.md) | Covered in |
|---|---|
| Next.js + TypeScript strict mode | Task 1 |
| Tailwind CSS brand palette | Task 2 |
| Shadcn UI component library | Task 3 |
| Supabase client (browser + server) | Task 4 |
| `tenant_id` on all tables | Task 5 |
| RLS on all tables | Task 5 |
| PWA / Service Worker (Next-PWA) | Task 6 |
| Touch-first 44×44px targets | Tasks 3, 7 |
| Responsive layout (Notebook/iPad/Mobile) | Task 7 |
| Vercel CI/CD via GitHub | Task 8 |

### Intentional Deferrals (not gaps)

- **IndexedDB offline queue** — PWA foundation is in Task 6; the queue implementation belongs in the Orders feature stack where actual data exists to queue.
- **Supabase Auth middleware** — belongs in Stack 2 (Authentication feature) where login/session flows are defined.
- **Webhook system** — belongs in a later stack (AI Readiness / Notifications).

### Placeholder Scan

No TBD, TODO, or vague steps. Every step contains runnable commands or complete code.

### Type Consistency

- `Database` type (`src/types/database.ts`) imported the same way in both `client.ts` and `server.ts`
- `NavItem` interface defined and used only within `sidebar.tsx`
- `createClient()` named identically in both Supabase files (distinguished by import path)
