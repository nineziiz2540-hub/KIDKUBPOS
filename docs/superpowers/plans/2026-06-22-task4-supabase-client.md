# Task 4: Connect Supabase Client — Step-by-Step Detail

> **กฎเหล็ก:** นำเสนอแผนเสร็จแล้ว หยุดรอ อย่ารันคำสั่งใดจนกว่าจะได้รับอนุมัติ

**Goal:** ติดตั้ง Supabase packages และสร้าง browser/server client พร้อม Database type placeholder — ยังไม่เชื่อมต่อ DB จริง ใช้ mock credentials

**สิ่งที่ Task นี้ไม่ทำ:** ไม่สร้าง schema, ไม่รัน migration, ไม่ตั้งค่า RLS — นั่นคืองานของ Task 5

---

## ไฟล์ที่จะถูกสร้าง/แก้ไข

| ไฟล์ | หน้าที่ | Commit? |
|------|---------|---------|
| `src/types/database.ts` | Database type placeholder (จะ replace ด้วย generated types ใน Task 5) | ✓ |
| `src/lib/supabase/client.ts` | Browser Supabase client (`createBrowserClient`) | ✓ |
| `src/lib/supabase/server.ts` | Server/RSC Supabase client (`createServerClient`) | ✓ |
| `.env.example` | Template env vars (ปลอดภัย commit ได้) | ✓ |
| `.env.local` | Mock credentials จริง (ห้าม commit — ถูก .gitignore แล้ว) | ✗ |

---

## Steps

### Step 1: ตรวจสอบ .gitignore ครอบ .env.local

```powershell
Select-String -Path "E:\KIDKUBPOS\.gitignore" -Pattern "env"
```

**Expected:** เห็น `.env*` หรือ `.env.local` ในผลลัพธ์

ถ้าไม่มี → เพิ่มด้วย:
```powershell
Add-Content "E:\KIDKUBPOS\.gitignore" "`n.env.local`n.env*.local"
```

---

### Step 2: ติดตั้ง Supabase packages

```powershell
cd "E:\KIDKUBPOS"; npm install @supabase/supabase-js @supabase/ssr
```

**Expected output:** `added X packages` ไม่มี error

ตรวจสอบ:
```powershell
Get-Content "E:\KIDKUBPOS\package.json" | Select-String "supabase"
```

**Expected:**
```
"@supabase/ssr": "^x.x.x",
"@supabase/supabase-js": "^x.x.x",
```

---

### Step 3: สร้าง Database type placeholder

สร้างไฟล์ `src/types/database.ts`:

```typescript
export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
```

> **หมายเหตุ:** ไฟล์นี้จะถูก replace ทั้งหมดใน Task 5 ด้วย `supabase gen types typescript` ที่ generate จาก schema จริง

---

### Step 4: สร้าง Browser Supabase client

สร้างไฟล์ `src/lib/supabase/client.ts`:

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

**หน้าที่:** ใช้ใน Client Components (`"use client"`) และ browser-side code เท่านั้น
**ไม่ใช้ใน:** Server Components, Route Handlers, Server Actions (ใช้ `server.ts` แทน)

---

### Step 5: สร้าง Server Supabase client

สร้างไฟล์ `src/lib/supabase/server.ts`:

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
            // Server Component context — cookie mutations are read-only
          }
        },
      },
    }
  );
}
```

**หน้าที่:** ใช้ใน Server Components, Route Handlers (`app/api/`), Server Actions
**เป็น `async`:** เพราะ `cookies()` ใน Next.js 15+ เป็น async

---

### Step 6: สร้าง .env.example (safe to commit)

สร้างไฟล์ `.env.example` ที่ root:

```
# Supabase — copy this file to .env.local and fill in real values
# Get these from: https://supabase.com/dashboard/project/<ref>/settings/api

NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

---

### Step 7: สร้าง .env.local พร้อม mock credentials

สร้างไฟล์ `.env.local` ที่ root (ไฟล์นี้จะ **ไม่ถูก commit** — protected by .gitignore):

```
# MOCK credentials — replace with real values from Supabase dashboard
# Task 5 จะเปลี่ยน credentials เหล่านี้เป็นของจริง

NEXT_PUBLIC_SUPABASE_URL=https://mock-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock-anon-key
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock-service-role-key
```

---

### Step 8: ตรวจสอบ TypeScript compile ผ่าน

```powershell
cd "E:\KIDKUBPOS"; npx tsc --noEmit
```

**Expected:** ไม่มี `error TS` ใด (no output = success)

**ถ้า error เรื่อง `@supabase/ssr` types:** ตรวจสอบว่า `@supabase/supabase-js` ติดตั้งครบ และ `tsconfig.json` มี `"skipLibCheck": true`

---

### Step 9: ตรวจสอบ imports resolve ถูกต้อง (quick sanity check)

```powershell
Get-ChildItem "E:\KIDKUBPOS\src\lib\supabase\"
Get-ChildItem "E:\KIDKUBPOS\src\types\"
```

**Expected:**
```
src\lib\supabase\client.ts
src\lib\supabase\server.ts
src\types\database.ts
```

ตรวจ .env.local ถูกสร้าง (ไม่ต้อง print เนื้อหา เพียงตรวจว่ามีไฟล์):
```powershell
Test-Path "E:\KIDKUBPOS\.env.local"
```

**Expected:** `True`

---

### Step 10: Commit (ไม่รวม .env.local)

```powershell
cd "E:\KIDKUBPOS"
git add src/types/database.ts src/lib/supabase/client.ts src/lib/supabase/server.ts .env.example package.json package-lock.json
git commit -m "feat: add Supabase browser + server clients with Database type placeholder"
```

ตรวจสอบ `.env.local` ไม่ติดไปกับ commit:
```powershell
git status
```

**Expected:** ไม่เห็น `.env.local` ใน output (ต้องอยู่ใน untracked/ignored)

ตรวจสอบ commits:
```powershell
git log --oneline
```

**Expected:** เห็น 4 commits

---

## Completion Criteria — ก่อนไป Task 5 ต้องผ่านทุกข้อ

- [ ] `@supabase/supabase-js` และ `@supabase/ssr` อยู่ใน `package.json`
- [ ] `src/types/database.ts` มี `Database` type placeholder
- [ ] `src/lib/supabase/client.ts` export `createClient()` (browser)
- [ ] `src/lib/supabase/server.ts` export `async createClient()` (server)
- [ ] `.env.example` มีอยู่ที่ root และอยู่ใน git
- [ ] `.env.local` มีอยู่ที่ root แต่ **ไม่อยู่ใน git**
- [ ] `npx tsc --noEmit` ไม่มี error
- [ ] `git log --oneline` แสดง 4 commits
