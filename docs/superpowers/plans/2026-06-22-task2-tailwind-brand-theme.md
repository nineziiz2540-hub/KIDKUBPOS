# Task 2: Configure Tailwind CSS Brand Theme — Step-by-Step Detail

> **กฎเหล็ก:** นำเสนอแผนเสร็จแล้ว หยุดรอ อย่ารันคำสั่งใดจนกว่าจะได้รับอนุมัติ

**Goal:** ใส่ brand color tokens ของ KIDKUBPOS ลงใน `globals.css` ผ่าน Tailwind v4 `@theme` block เพื่อให้ class เช่น `bg-accent`, `bg-sidebar`, `text-success` ฯลฯ ใช้งานได้ทั่วทั้ง app

---

## การค้นพบสำคัญ: Tailwind CSS v4 (ไม่ใช่ v3)

create-next-app ติดตั้ง **Tailwind CSS v4** มาให้ ซึ่งมีการ config ที่ต่างจาก v3 อย่างสิ้นเชิง:

| v3 (แผนเดิม) | v4 (ความจริง) |
|---|---|
| ใช้ `tailwind.config.ts` | **ไม่มี** `tailwind.config.ts` |
| `@tailwind base/components/utilities` | `@import "tailwindcss"` |
| colors อยู่ใน `theme.extend.colors` | colors อยู่ใน `@theme {}` block ใน CSS |
| token: `--color-accent` ใน config | token: `--color-accent: #ff6b35` ใน `@theme {}` |

**สรุป:** แก้ไขเพียงไฟล์เดียวคือ `src/app/globals.css` เท่านั้น

---

## ไฟล์ที่จะถูกแก้ไข

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `src/app/globals.css` | แทนที่ `@theme inline` ด้วย `@theme {}` + brand tokens + ลบ dark mode |
| `src/app/page.tsx` | เพิ่ม smoke-test สีชั่วคราว แล้ว revert หลังตรวจ |

**ไฟล์ที่ไม่ต้องแตะ:** `tailwind.config.ts` (ไม่มีในโปรเจกต์), `postcss.config.mjs` (ใช้ได้แล้ว)

---

## Brand Colors จาก CLAUDE.md.txt

| Token Name | Hex | ใช้สำหรับ |
|-----------|-----|-----------|
| `--color-accent` | `#ff6b35` | ส้ม — CTA / ปุ่มหลัก / ชำระเงิน |
| `--color-sidebar` | `#0c1a3d` | กรมท่าเข้ม — Sidebar / Header |
| `--color-surface` | `#eef3fc` | ฟ้าอ่อน — Page background |
| `--color-success` | `#00b87a` | เขียว — สำเร็จ / จ่ายแล้ว |
| `--color-danger` | `#f43f5e` | แดง — Error / ยกเลิก / ลบ |
| `--color-info` | `#2563eb` | ฟ้า — Info / Active state |
| `--color-warning` | `#f59e0b` | เหลือง — Warning / Pending / สต็อกใกล้หมด |

---

## Steps

### Step 1: อ่าน globals.css ปัจจุบัน (ยืนยัน baseline)

ตรวจว่าไฟล์เป็น Tailwind v4 format และยังไม่มี brand colors

```powershell
Get-Content "E:\KIDKUBPOS\src\app\globals.css"
```

**Expected:**
```css
@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #171717;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

@media (prefers-color-scheme: dark) { ... }

body { ... }
```

---

### Step 2: เขียนทับ globals.css ด้วย brand theme

แทนที่เนื้อหาทั้งหมดใน `src/app/globals.css` ด้วยโค้ดต่อไปนี้:

```css
@import "tailwindcss";

@theme {
  /* KIDKUBPOS Brand Palette — source: CLAUDE.md §3 */
  --color-accent:  #ff6b35;
  --color-sidebar: #0c1a3d;
  --color-surface: #eef3fc;
  --color-success: #00b87a;
  --color-danger:  #f43f5e;
  --color-info:    #2563eb;
  --color-warning: #f59e0b;

  /* Typography */
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  background-color: #eef3fc;
  color: #171717;
}
```

**ประเด็นสำคัญในโค้ดนี้:**
- ใช้ `@theme` (ไม่ใช่ `@theme inline`) — v4 ใช้ `@theme` สำหรับ custom tokens
- ลบ dark mode (`prefers-color-scheme`) ออก — CLAUDE.md ไม่ได้กำหนด dark mode, KIDKUBPOS เป็น light-only
- ลบ `:root { --background / --foreground }` เดิมออก — ใช้ `--color-surface` แทน
- Tailwind v4 จะ auto-generate: `bg-accent`, `text-accent`, `border-accent`, `bg-sidebar`, `bg-surface`, `text-success`, `bg-danger`, `text-info`, `bg-warning` ฯลฯ จาก `--color-*` token ทุกตัว

---

### Step 3: ตรวจสอบ syntax ไม่มี error ด้วย build check

```powershell
cd "E:\KIDKUBPOS"; npx tsc --noEmit
```

**Expected:** ไม่มี error TS ใด (TypeScript ไม่ validate CSS แต่ยืนยันว่า project ยังสมบูรณ์)

---

### Step 4: อัปเดต page.tsx เพื่อ smoke-test brand colors

แทนที่เนื้อหา `src/app/page.tsx` ด้วยโค้ด smoke-test ชั่วคราวนี้:

```tsx
export default function Home() {
  return (
    <main className="min-h-screen bg-surface p-8 space-y-4">
      <h1 className="text-2xl font-bold">KIDKUBPOS Brand Color Check</h1>

      <div className="flex flex-wrap gap-3">
        <div className="bg-accent text-white px-4 py-2 rounded">
          accent #ff6b35
        </div>
        <div className="bg-sidebar text-white px-4 py-2 rounded">
          sidebar #0c1a3d
        </div>
        <div className="bg-surface border border-gray-300 px-4 py-2 rounded">
          surface #eef3fc
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="bg-success text-white px-4 py-2 rounded">
          success #00b87a
        </div>
        <div className="bg-danger text-white px-4 py-2 rounded">
          danger #f43f5e
        </div>
        <div className="bg-info text-white px-4 py-2 rounded">
          info #2563eb
        </div>
        <div className="bg-warning text-white px-4 py-2 rounded">
          warning #f59e0b
        </div>
      </div>
    </main>
  );
}
```

---

### Step 5: รัน dev server และตรวจสอบสีใน browser

```powershell
cd "E:\KIDKUBPOS"; npm run dev
```

เปิด browser → `http://localhost:3000`

**Checklist ที่ต้องเห็น:**
- [ ] พื้นหลัง page: ฟ้าอ่อน `#eef3fc` (ไม่ใช่ขาว)
- [ ] กล่อง accent: ส้ม `#ff6b35`
- [ ] กล่อง sidebar: กรมท่าเข้ม `#0c1a3d`
- [ ] กล่อง success: เขียว `#00b87a`
- [ ] กล่อง danger: แดง `#f43f5e`
- [ ] กล่อง info: น้ำเงิน `#2563eb`
- [ ] กล่อง warning: เหลือง `#f59e0b`

หยุด server: **Ctrl+C**

---

### Step 6: Revert page.tsx กลับเป็น placeholder เรียบร้อย

หลังตรวจสีผ่านแล้ว แทนที่ `src/app/page.tsx` กลับด้วย placeholder ที่ clean:

```tsx
export default function Home() {
  return (
    <main className="min-h-screen bg-surface flex items-center justify-center p-4">
      <p className="text-lg font-semibold text-sidebar">KIDKUBPOS — พร้อมใช้งาน</p>
    </main>
  );
}
```

---

### Step 7: Commit

```powershell
cd "E:\KIDKUBPOS"
git add src/app/globals.css src/app/page.tsx
git commit -m "feat: configure Tailwind v4 brand theme (accent, sidebar, surface, status colors)"
```

ตรวจสอบ:
```powershell
git log --oneline
```

**Expected:** เห็น 2 commits (Task 1 + Task 2 นี้)

---

## Completion Criteria — ก่อนไป Task 3 ต้องผ่านทุกข้อ

- [ ] `globals.css` มี `@theme {}` block พร้อม 7 brand color tokens ครบ
- [ ] ไม่มี `@media (prefers-color-scheme: dark)` ใน globals.css
- [ ] `npx tsc --noEmit` ไม่มี error
- [ ] browser แสดงสีครบทั้ง 7 สีถูกต้องตาม hex
- [ ] `git log --oneline` แสดง 2 commits

---

## หมายเหตุสำหรับ Task ถัดไป

- **Task 3 (Shadcn UI):** Shadcn v4 รองรับ Tailwind v4 แต่ต้องใช้ `shadcn@canary` แทน `shadcn@latest` และ CSS variables จะเป็น oklch format แทน HSL — จะ handle ใน Task 3
