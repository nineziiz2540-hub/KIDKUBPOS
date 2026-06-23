# Task 6: Configure Next-PWA — Step-by-Step Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ติดตั้ง PWA infrastructure ด้วย `@serwist/next` (maintained fork สำหรับ Next.js 16 App Router), สร้าง service worker, manifest.json พร้อม brand colors, placeholder icons, และ PWA metadata ใน layout.tsx

**Architecture:** ใช้ `@serwist/next` แทน `next-pwa` ดั้งเดิม เพราะ `next-pwa` ไม่ได้ maintain สำหรับ Next.js 13+ App Router อีกต่อไป — `@serwist/next` คือ official successor ที่ support TypeScript + App Router เต็มรูปแบบ Service worker ถูก build แยกต่างหากจาก Next.js compilation pipeline โดย serwist จัดการ precaching ผ่าน `__SW_MANIFEST` inject ตอน build time

**Tech Stack:** `@serwist/next`, `serwist`, Next.js 16.2.9 App Router, TypeScript strict

## Global Constraints

- Next.js 16.2.9 App Router — ไม่มี `pages/` directory
- TypeScript strict + noUncheckedIndexedAccess — ห้าม `any`, ห้าม non-null assertion โดยไม่จำเป็น
- Tailwind v4 — config ผ่าน CSS เท่านั้น ไม่แตะ tailwind.config.ts
- Brand colors: theme_color `#0c1a3d` (sidebar), background_color `#eef3fc` (surface), accent `#ff6b35`
- กฎเหล็ก: หยุดทันทีหาก build error — อย่า patch ข้ามไป
- `public/sw.js` คือ build artifact — ห้าม commit เข้า git

---

## ไฟล์ที่จะถูกสร้าง/แก้ไข

| ไฟล์ | สร้าง/แก้ | หน้าที่ |
|------|-----------|---------|
| `src/app/sw.ts` | สร้าง | Service worker entry point (compiled แยกโดย serwist) |
| `next.config.ts` | แก้ไข | wrap ด้วย `withSerwistInit` |
| `tsconfig.json` | แก้ไข | exclude `src/app/sw.ts` จาก main TS compilation |
| `public/manifest.json` | สร้าง | PWA Web App Manifest พร้อม brand colors |
| `public/icons/icon-192x192.png` | สร้าง | Placeholder icon (minimal valid PNG) |
| `public/icons/icon-512x512.png` | สร้าง | Placeholder icon (minimal valid PNG) |
| `src/app/layout.tsx` | แก้ไข | เพิ่ม `manifest`, `appleWebApp`, และ `Viewport` export |
| `.gitignore` | แก้ไข | เพิ่ม `public/sw.js` และ `public/sw.js.map` |

---

## Steps

> **สัญลักษณ์:** 🤖 = ผมรันให้ | ✋ = ผู้ใช้ต้องทำเอง

---

### Step 1: 🤖 ติดตั้ง `@serwist/next` และ `serwist`

- [ ] รัน:
```powershell
cd "E:\KIDKUBPOS"; npm install @serwist/next serwist
```

ตรวจสอบ:
```powershell
node -e "require('@serwist/next'); console.log('ok')"
```

**Expected:** พิมพ์ `ok` ไม่มี error

---

### Step 2: 🤖 สร้าง `src/app/sw.ts` (Service Worker entry)

- [ ] สร้างไฟล์ `src/app/sw.ts`:

```typescript
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";
import { defaultCache } from "@serwist/next/worker";

declare global {
  interface ServiceWorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST ?? [],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
```

---

### Step 3: 🤖 อัปเดต `tsconfig.json` — exclude sw.ts จาก main compilation

`sw.ts` ใช้ `ServiceWorkerGlobalScope` ซึ่งต้องการ `webworker` lib แต่ main tsconfig ใช้ `dom` lib — ถ้าไม่ exclude จะเกิด type conflict

- [ ] แก้ `tsconfig.json` เพิ่ม `"src/app/sw.ts"` ใน `exclude` array:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": ["node_modules", "src/app/sw.ts"]
}
```

---

### Step 4: 🤖 อัปเดต `next.config.ts` — wrap ด้วย `withSerwistInit`

- [ ] เขียนทับ `next.config.ts`:

```typescript
import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {};

export default withSerwist(nextConfig);
```

**หมายเหตุ:** `disable: process.env.NODE_ENV === "development"` ปิด service worker ใน dev mode เพื่อหลีกเลี่ยง caching ที่รบกวนการพัฒนา

---

### Step 5: 🤖 สร้าง `public/manifest.json`

- [ ] สร้างไฟล์ `public/manifest.json`:

```json
{
  "name": "KIDKUBPOS",
  "short_name": "KIDKUBPOS",
  "description": "Multi-tenant POS Ecosystem for modern retail businesses",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#eef3fc",
  "theme_color": "#0c1a3d",
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    }
  ]
}
```

---

### Step 6: 🤖 สร้าง placeholder icons ใน `public/icons/`

สร้าง 2 ไฟล์ PNG ขนาด 1×1 pixel เป็น placeholder (minimal valid PNG) — จะถูกแทนที่ด้วยไอคอนจริงในภายหลัง

- [ ] รัน:
```powershell
New-Item -ItemType Directory -Path "E:\KIDKUBPOS\public\icons" -Force
$iconBytes = [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
[System.IO.File]::WriteAllBytes("E:\KIDKUBPOS\public\icons\icon-192x192.png", $iconBytes)
[System.IO.File]::WriteAllBytes("E:\KIDKUBPOS\public\icons\icon-512x512.png", $iconBytes)
```

ตรวจสอบ:
```powershell
(Get-Item "E:\KIDKUBPOS\public\icons\icon-192x192.png").Length
(Get-Item "E:\KIDKUBPOS\public\icons\icon-512x512.png").Length
```

**Expected:** ทั้งสองไฟล์มีขนาด > 0 bytes (ประมาณ 68 bytes)

---

### Step 7: 🤖 อัปเดต `src/app/layout.tsx` — เพิ่ม PWA metadata

เพิ่ม `Viewport` export (Next.js 15+ แยก themeColor ออกจาก Metadata) และเพิ่ม manifest + appleWebApp ใน metadata

- [ ] แก้ไข `src/app/layout.tsx`:

```typescript
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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

---

### Step 8: 🤖 อัปเดต `.gitignore` — เพิ่ม build artifacts ของ serwist

`public/sw.js` และ `public/sw.js.map` ถูก generate ขณะ build — ไม่ควร commit เข้า git

- [ ] เพิ่มใน `.gitignore` ท้ายหัวข้อ `# next.js`:

```
# pwa / serwist
/public/sw.js
/public/sw.js.map
```

---

### Step 9: 🤖 ตรวจสอบ TypeScript — ไม่มี error

- [ ] รัน:
```powershell
cd "E:\KIDKUBPOS"; npx tsc --noEmit
```

**Expected:** ไม่มี `error TS` ใด ๆ

**ถ้า error เรื่อง `ServiceWorkerGlobalScope`:** ตรวจว่า `src/app/sw.ts` อยู่ใน `exclude` array ใน `tsconfig.json` แล้วหรือยัง

---

### Step 10: 🤖 Build verify

- [ ] รัน:
```powershell
cd "E:\KIDKUBPOS"; npm run build
```

**Expected:** Build สำเร็จ — เห็น `✓ Compiled successfully` หรือ `Route (app)` table ไม่มี error

**ตรวจสอบไฟล์ sw.js ถูกสร้าง:**
```powershell
Test-Path "E:\KIDKUBPOS\public\sw.js"
```

**Expected:** `True`

**ถ้า build error เรื่อง `swSrc`:** ตรวจว่า path `src/app/sw.ts` ถูกต้อง (relative จาก project root)

---

### Step 11: 🤖 Commit

- [ ] รัน:
```powershell
cd "E:\KIDKUBPOS"
git add src/app/sw.ts next.config.ts tsconfig.json public/manifest.json public/icons/icon-192x192.png public/icons/icon-512x512.png src/app/layout.tsx .gitignore
git status
```

ตรวจว่าไม่มี `public/sw.js` ถูก stage (ถ้ามีให้รัน `git reset HEAD public/sw.js` ก่อน)

- [ ] สร้าง commit:
```powershell
git commit -m "$(cat <<'EOF'
feat: configure PWA with @serwist/next, manifest.json, and placeholder icons

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

ตรวจสอบ:
```powershell
git log --oneline
```

**Expected:** เห็น 6 commits (5 เดิม + commit ใหม่)

---

## ลำดับ Steps และผู้รับผิดชอบ

| Step | ผู้ทำ | สิ่งที่ทำ | หยุดรอ? |
|------|-------|-----------|---------|
| 1 | 🤖 ผม | `npm install @serwist/next serwist` | ไม่ |
| 2 | 🤖 ผม | สร้าง `src/app/sw.ts` | ไม่ |
| 3 | 🤖 ผม | แก้ `tsconfig.json` — exclude sw.ts | ไม่ |
| 4 | 🤖 ผม | แก้ `next.config.ts` — withSerwistInit | ไม่ |
| 5 | 🤖 ผม | สร้าง `public/manifest.json` | ไม่ |
| 6 | 🤖 ผม | สร้าง placeholder icons ใน `public/icons/` | ไม่ |
| 7 | 🤖 ผม | แก้ `src/app/layout.tsx` — metadata + Viewport | ไม่ |
| 8 | 🤖 ผม | แก้ `.gitignore` — เพิ่ม sw.js | ไม่ |
| 9 | 🤖 ผม | `npx tsc --noEmit` | ไม่ |
| 10 | 🤖 ผม | `npm run build` — verify สำเร็จ | ไม่ |
| 11 | 🤖 ผม | `git commit` | ไม่ |

---

## Completion Criteria — ก่อนไป Task 7 ต้องผ่านทุกข้อ

- [ ] `npm install @serwist/next serwist` สำเร็จ, ปรากฏใน `package.json` dependencies
- [ ] `src/app/sw.ts` มีอยู่และมี `serwist.addEventListeners()`
- [ ] `next.config.ts` ใช้ `withSerwistInit`
- [ ] `public/manifest.json` มี `theme_color: "#0c1a3d"` และ `background_color: "#eef3fc"`
- [ ] `public/icons/icon-192x192.png` และ `icon-512x512.png` มีอยู่ (ขนาด > 0)
- [ ] `src/app/layout.tsx` มี `Viewport` export และ `manifest: "/manifest.json"` ใน metadata
- [ ] `.gitignore` มี `/public/sw.js`
- [ ] `npx tsc --noEmit` ไม่มี error
- [ ] `npm run build` สำเร็จ, `public/sw.js` ถูกสร้าง
- [ ] `git log --oneline` แสดง 6 commits
