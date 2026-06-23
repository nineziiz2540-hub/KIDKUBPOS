# Task 7: Root Layout + Brand Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้าง responsive shell layout ประกอบด้วย Sidebar (desktop md+) และ Topbar (mobile <md) ด้วย brand colors จาก globals.css และอัปเดต layout.tsx + page.tsx ให้ใช้ shell นี้

**Architecture:** แบ่งออกเป็น 2 Server Components (`Sidebar`, `Topbar`) ที่ import เข้า `RootLayout` — ไม่มี client state ในขั้นนี้ (Menu button เป็น visual placeholder ไม่มี mobile drawer) ไม่ต้องใช้ `"use client"` เลย Layout body เปลี่ยนจาก `flex flex-col` เป็น `flex` (row) เพื่อให้ Sidebar อยู่ซ้ายและ content อยู่ขวา Content area มี `overflow-y-auto` เพื่อให้ scroll แยกจาก sidebar

**Tech Stack:** Next.js 16.2.9 App Router, Tailwind CSS v4 (`bg-sidebar`, `bg-surface`, `text-accent`), lucide-react v1.21.0, Shadcn UI v4 Card + Badge

## Global Constraints

- Tailwind v4 — brand tokens: `bg-sidebar` = `#0c1a3d`, `bg-surface` = `#eef3fc`, `text-accent` = `#ff6b35`
- TypeScript strict + noUncheckedIndexedAccess — ห้ามใช้ `any`
- Next.js 16 App Router — ไม่มี `pages/` directory
- Server Components only — ไม่มี `"use client"` ใน Task นี้ (ไม่มี client state)
- `npm run dev/build` ใช้ `--webpack` flag (ดูจาก package.json — Next.js 16 ต้องระบุ)
- ห้ามแตะ globals.css หรือ tailwind config

---

## ไฟล์ที่จะถูกสร้าง/แก้ไข

| ไฟล์ | สร้าง/แก้ | หน้าที่ |
|------|-----------|---------|
| `src/components/shell/sidebar.tsx` | สร้าง | Desktop sidebar (hidden บน mobile, flex บน md+) |
| `src/components/shell/topbar.tsx` | สร้าง | Mobile topbar (flex บน mobile, hidden บน md+) |
| `src/app/layout.tsx` | แก้ | เปลี่ยน body เป็น `flex h-full` + import Sidebar/Topbar |
| `src/app/page.tsx` | แก้ | Dashboard placeholder ด้วย 4 stat cards |

---

## Steps

---

### Step 1: 🤖 สร้าง `src/components/shell/sidebar.tsx`

- [ ] สร้างไฟล์ `src/components/shell/sidebar.tsx`:

```typescript
import Link from "next/link";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  BarChart3,
  Settings,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/orders", label: "Orders", icon: ShoppingCart },
  { href: "/products", label: "Products", icon: Package },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar() {
  return (
    <aside className="hidden md:flex flex-col w-16 lg:w-56 h-full shrink-0 bg-sidebar border-r border-white/10">
      <div className="flex items-center justify-center lg:justify-start h-14 px-4 border-b border-white/10 shrink-0">
        <span className="text-accent font-bold text-xl hidden lg:inline">KIDKUBPOS</span>
        <span className="text-accent font-bold text-lg lg:hidden">K</span>
      </div>
      <nav className="flex-1 py-4 flex flex-col gap-1 px-2 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => (
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
    </aside>
  );
}
```

**หมายเหตุ:**
- `hidden md:flex` — ซ่อนบน mobile, แสดงบน md+ (768px+)
- `w-16 lg:w-56` — icon-only (64px) บน md, full width (224px) บน lg+
- `h-full shrink-0` — สูงเต็ม viewport, ไม่ถูก shrink
- `bg-sidebar` = `#0c1a3d` (brand dark navy จาก globals.css)
- `text-accent` = `#ff6b35` (brand orange)
- ไม่มี `"use client"` — Link และ lucide icons ทำงานใน Server Component

---

### Step 2: 🤖 สร้าง `src/components/shell/topbar.tsx`

- [ ] สร้างไฟล์ `src/components/shell/topbar.tsx`:

```typescript
import { Menu } from "lucide-react";

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
      <span className="text-accent font-bold text-lg">KIDKUBPOS</span>
    </header>
  );
}
```

**หมายเหตุ:**
- `flex md:hidden` — แสดงบน mobile เท่านั้น
- `sticky top-0 z-10` — ค้างอยู่ด้านบนเมื่อ scroll
- `<button>` ไม่มี `onClick` — visual placeholder, mobile drawer จะ implement ใน Task ภายหลัง
- ไม่มี `"use client"` — button ที่ไม่มี handler ใช้ใน Server Component ได้

---

### Step 3: 🤖 อัปเดต `src/app/layout.tsx` — เพิ่ม shell

เปลี่ยน `<body>` จาก `flex flex-col` เป็น `flex` (row) และ wrap children ด้วย shell:

- [ ] แก้ไข `src/app/layout.tsx`:

```typescript
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
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
      <body className="flex h-full">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <Topbar />
          <main className="flex-1 overflow-y-auto bg-surface p-4 md:p-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
```

**หมายเหตุโครงสร้าง:**
- `body: flex h-full` — row layout, สูงเต็ม viewport (html ก็ h-full)
- `Sidebar` อยู่ซ้าย (hidden md:flex ภายในตัวมันเอง)
- `div flex-col flex-1 min-w-0 overflow-hidden` — คอลัมน์ขวา, `min-w-0` ป้องกัน flex overflow
- `Topbar` อยู่บนสุดของคอลัมน์ขวา (flex md:hidden ภายในตัวมันเอง)
- `main overflow-y-auto` — scroll เฉพาะ content area ไม่ scroll ทั้งหน้า
- `bg-surface` = `#eef3fc` (brand surface)

---

### Step 4: 🤖 อัปเดต `src/app/page.tsx` — Dashboard placeholder

- [ ] แก้ไข `src/app/page.tsx`:

```typescript
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

**หมายเหตุ:**
- `satisfies` keyword (TypeScript 4.9+) — type-check โดยไม่เปลี่ยน inferred type
- `variant: "default" as const` — ป้องกัน TypeScript broadening เป็น `string`
- `text-sidebar` = `#0c1a3d` บน stat values
- Badge `variant="default"` = dark bg (active metrics), `variant="secondary"` = light bg (info metrics)
- `grid-cols-2 lg:grid-cols-4` — 2 คอลัมน์บน mobile/tablet, 4 คอลัมน์บน desktop

---

### Step 5: 🤖 TypeScript check

- [ ] รัน:
```powershell
cd "E:\KIDKUBPOS"; npx tsc --noEmit
```

**Expected:** ไม่มี output (ไม่มี error)

**ถ้า error เรื่อง icon type `(props) => JSX.Element`:** ตรวจว่า destructure เป็น `icon: Icon` (capital I) และใช้เป็น `<Icon .../>` ถูกต้อง

**ถ้า error เรื่อง `satisfies`:** ตรวจว่า `typescript` ≥ 4.9 ใน package.json (project ใช้ `^5` — ผ่านแน่นอน)

---

### Step 6: 🤖 Build verify

- [ ] รัน:
```powershell
cd "E:\KIDKUBPOS"; npm run build
```

**Expected:** Build pass — เห็น `✓ Compiled successfully` และ Route table ไม่มี error

---

### Step 7: ✋ Smoke test (ผู้ใช้ตรวจสอบ)

- [ ] เริ่ม dev server:
```powershell
cd "E:\KIDKUBPOS"; npm run dev
```

เปิด browser ที่ `http://localhost:3000`

**ตรวจสอบ Desktop (window ≥ 768px):**

| องค์ประกอบ | สิ่งที่ต้องเห็น | Tailwind class | Brand hex |
|-----------|----------------|----------------|-----------|
| Sidebar (ซ้าย) | แถบสีเข้มซ้ายมือ | `bg-sidebar` | `#0c1a3d` |
| Logo "KIDKUBPOS" | สีส้ม | `text-accent` | `#ff6b35` |
| Main area (ขวา) | พื้นหลังฟ้าอ่อน | `bg-surface` | `#eef3fc` |
| Stat values | สีน้ำเงินเข้ม | `text-sidebar` | `#0c1a3d` |
| Topbar | ไม่มองเห็น (hidden) | `md:hidden` | — |

**ตรวจสอบ Mobile (window < 768px หรือ DevTools responsive):**

| องค์ประกอบ | สิ่งที่ต้องเห็น | Tailwind class | Brand hex |
|-----------|----------------|----------------|-----------|
| Topbar (บน) | แถบสีเข้มด้านบน | `bg-sidebar` | `#0c1a3d` |
| Logo "KIDKUBPOS" | สีส้ม | `text-accent` | `#ff6b35` |
| Menu icon | ไอคอน hamburger | — | white/70 |
| Sidebar | ไม่มองเห็น | `hidden md:flex` | — |
| Main area | พื้นหลังฟ้าอ่อน | `bg-surface` | `#eef3fc` |

แจ้งผลสีครับ (ถูก/ไม่ถูก)

---

### Step 8: 🤖 Commit (หลัง smoke test ผ่าน)

- [ ] Stage และ commit:
```powershell
cd "E:\KIDKUBPOS"
git add src/components/shell/sidebar.tsx src/components/shell/topbar.tsx src/app/layout.tsx src/app/page.tsx
git commit -m @'
feat: add responsive brand shell (Sidebar + Topbar) and dashboard placeholder

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
```

ตรวจสอบ:
```powershell
git log --oneline
```

**Expected:** 7 commits

---

## ลำดับ Steps และผู้รับผิดชอบ

| Step | ผู้ทำ | สิ่งที่ทำ | หยุดรอ? |
|------|-------|-----------|---------|
| 1 | 🤖 ผม | สร้าง `sidebar.tsx` | ไม่ |
| 2 | 🤖 ผม | สร้าง `topbar.tsx` | ไม่ |
| 3 | 🤖 ผม | แก้ `layout.tsx` — shell body | ไม่ |
| 4 | 🤖 ผม | แก้ `page.tsx` — dashboard cards | ไม่ |
| 5 | 🤖 ผม | `npx tsc --noEmit` | ไม่ |
| 6 | 🤖 ผม | `npm run build` | ไม่ |
| 7 | ✋ ผู้ใช้ | Smoke test สีใน browser | **ใช่ — รอผู้ใช้แจ้งสีถูก/ผิด** |
| 8 | 🤖 ผม | `git commit` (หลัง step 7 ผ่าน) | ไม่ |

---

## Completion Criteria — ก่อนไป Task 8 ต้องผ่านทุกข้อ

- [ ] `src/components/shell/sidebar.tsx` มี `hidden md:flex` และ `bg-sidebar`
- [ ] `src/components/shell/topbar.tsx` มี `flex md:hidden` และ `bg-sidebar`
- [ ] `src/app/layout.tsx` body เป็น `flex h-full` + import Sidebar/Topbar
- [ ] `src/app/page.tsx` มี 4 stat cards ด้วย Card + Badge
- [ ] `npx tsc --noEmit` ไม่มี error
- [ ] `npm run build` สำเร็จ
- [ ] Smoke test: Sidebar `#0c1a3d` บน desktop, Topbar `#0c1a3d` บน mobile, Logo `#ff6b35`, Main `#eef3fc`
- [ ] `git log --oneline` แสดง 7 commits
