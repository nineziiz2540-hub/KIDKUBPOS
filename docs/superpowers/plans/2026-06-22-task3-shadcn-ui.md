# Task 3: Initialize Shadcn UI — Step-by-Step Detail

> **กฎเหล็ก:** นำเสนอแผนเสร็จแล้ว หยุดรอ อย่ารันคำสั่งใดจนกว่าจะได้รับอนุมัติ

**Goal:** ติดตั้ง Shadcn UI v4.11.0 บน Tailwind v4 และ install base components ที่จำเป็นสำหรับ KIDKUBPOS POS interface

---

## ข้อควรระวังสำคัญ: Shadcn init จะแก้ไข globals.css

shadcn init จะ **เขียนทับหรือเพิ่มเนื้อหาใน `globals.css`** เพื่อใส่ CSS variables ของตัวเอง (oklch format)
มีความเสี่ยงที่ brand colors ของเรา (`--color-accent`, `--color-sidebar` ฯลฯ) จะถูกลบออก
แผนนี้จึงมี Step ตรวจสอบและกู้คืน brand colors หลัง shadcn init เสมอ

---

## ไฟล์ที่จะถูกสร้าง/แก้ไข

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `components.json` | สร้างใหม่ — shadcn config |
| `src/lib/utils.ts` | สร้างใหม่ — `cn()` utility function |
| `src/app/globals.css` | shadcn เพิ่ม CSS variables (oklch) + ต้องตรวจ brand colors ยังอยู่ |
| `src/components/ui/button.tsx` | สร้างใหม่ |
| `src/components/ui/card.tsx` | สร้างใหม่ |
| `src/components/ui/badge.tsx` | สร้างใหม่ |
| `src/components/ui/input.tsx` | สร้างใหม่ |
| `src/components/ui/label.tsx` | สร้างใหม่ |
| `src/components/ui/separator.tsx` | สร้างใหม่ |

---

## Steps

### Step 1: Snapshot brand colors ก่อน (ยืนยันยังอยู่ครบ)

```powershell
Get-Content "E:\KIDKUBPOS\src\app\globals.css"
```

**Expected:** เห็น `@theme {}` block พร้อม 7 brand tokens ครบ (`--color-accent`, `--color-sidebar`, `--color-surface`, `--color-success`, `--color-danger`, `--color-info`, `--color-warning`)

จด/จำว่า brand colors block มีหน้าตาแบบนี้ (เผื่อต้องกู้คืน):
```css
@theme {
  --color-accent:  #ff6b35;
  --color-sidebar: #0c1a3d;
  --color-surface: #eef3fc;
  --color-success: #00b87a;
  --color-danger:  #f43f5e;
  --color-info:    #2563eb;
  --color-warning: #f59e0b;
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
```

---

### Step 2: รัน shadcn init

```powershell
cd "E:\KIDKUBPOS"; npx shadcn@latest init
```

**ตอบ prompts ตามนี้:**

| คำถาม | คำตอบ |
|-------|-------|
| Which style would you like to use? | **Default** |
| Which color would you like to use as base color? | **Neutral** |
| Would you like to use CSS variables? | **Yes** (ถ้าถาม) |

> หาก shadcn auto-detect ทุกอย่างและไม่ถาม prompt ใด → ปล่อยให้ทำงานจนเสร็จ
> คาดใช้เวลา ~30 วินาที

---

### Step 3: ตรวจสอบ globals.css หลัง shadcn init

```powershell
Get-Content "E:\KIDKUBPOS\src\app\globals.css"
```

**ตรวจ 2 สิ่ง:**

**3a) ตรวจว่า brand colors ยังอยู่ใน `@theme {}`**
- ต้องเห็น `--color-accent: #ff6b35` และ token อื่นๆ ครบ
- ถ้าหายไป → ทำ Step 4 (กู้คืน)
- ถ้ายังอยู่ครบ → ข้าม Step 4 ไป Step 5 เลย

**3b) ตรวจว่า shadcn เพิ่ม variables อะไรบ้าง**
- ควรเห็น `@layer base { :root { --background: oklch(...) ... } }`
- ควรเห็น `--radius`, `--primary`, `--secondary` ฯลฯ

---

### Step 4: (ทำเฉพาะถ้าจำเป็น) กู้คืน brand colors ใน globals.css

**ทำก็ต่อเมื่อ Step 3 พบว่า brand colors หายไป**

หา `@theme` block ใน globals.css และเพิ่ม brand tokens กลับเข้าไป:

```css
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

  /* (shadcn tokens ที่มีอยู่แล้ว — อย่าลบ) */
}
```

> ถ้ามี `@theme` หลาย block → รวมเป็น block เดียวโดยรักษา token ของ shadcn ไว้ด้วย

---

### Step 5: ตรวจสอบ utils.ts ถูกสร้าง

```powershell
Get-Content "E:\KIDKUBPOS\src\lib\utils.ts"
```

**Expected:**
```typescript
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

---

### Step 6: Install base components

```powershell
cd "E:\KIDKUBPOS"; npx shadcn@latest add button card badge input label separator
```

**Expected:** ไฟล์ถูกสร้างใน `src/components/ui/`:
- `button.tsx`
- `card.tsx`
- `badge.tsx`
- `input.tsx`
- `label.tsx`
- `separator.tsx`

ตรวจสอบ:
```powershell
Get-ChildItem "E:\KIDKUBPOS\src\components\ui\"
```

---

### Step 7: Smoke test — ใช้ Button + Card ใน page.tsx

แทนที่ `src/app/page.tsx` ชั่วคราว:

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  return (
    <main className="min-h-screen bg-surface flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            KIDKUBPOS
            <Badge className="bg-success text-white hover:bg-success/90">
              ออนไลน์
            </Badge>
          </CardTitle>
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

รัน dev server:
```powershell
cd "E:\KIDKUBPOS"; npm run dev
```

เปิด browser → `http://localhost:3000`

**Checklist ที่ต้องเห็น:**
- [ ] พื้นหลัง: ฟ้าอ่อน `#eef3fc` (bg-surface ยังทำงาน)
- [ ] Card component render ได้ถูกต้อง (กรอบ, shadow)
- [ ] ปุ่ม "เริ่มต้น": สีส้ม `#ff6b35`
- [ ] ปุ่ม "ออก": outline style
- [ ] Badge "ออนไลน์": สีเขียว `#00b87a`

หยุด server: **Ctrl+C**

---

### Step 8: TypeScript check

```powershell
cd "E:\KIDKUBPOS"; npx tsc --noEmit
```

**Expected:** ไม่มี `error TS` ใด

---

### Step 9: Revert page.tsx กลับ placeholder

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

### Step 10: Commit

```powershell
cd "E:\KIDKUBPOS"
git add components.json src/lib/utils.ts src/app/globals.css src/components/ui/ src/app/page.tsx package.json package-lock.json
git commit -m "feat: initialize Shadcn UI v4 with base components (button, card, badge, input, label, separator)"
```

ตรวจสอบ:
```powershell
git log --oneline
```

**Expected:** เห็น 3 commits

---

## Completion Criteria — ก่อนไป Task 4 ต้องผ่านทุกข้อ

- [ ] `components.json` ถูกสร้างในรูท project
- [ ] `src/lib/utils.ts` มี `cn()` function
- [ ] `globals.css` มี brand colors ครบ 7 สีใน `@theme {}`
- [ ] `src/components/ui/` มีไฟล์ครบ 6 ตัว
- [ ] browser แสดง Card + Button ส้ม + Badge เขียว ถูกต้อง
- [ ] `npx tsc --noEmit` ไม่มี error
- [ ] `git log --oneline` แสดง 3 commits
