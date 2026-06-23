# Task 1: Initialize Next.js Project — Step-by-Step Detail

> **กฎเหล็ก:** นำเสนอแผนเสร็จแล้ว หยุดรอ อย่ารันคำสั่งใดจนกว่าจะได้รับอนุมัติแต่ละ Step

**Goal:** สร้าง Next.js 15 project ใน `E:\KIDKUBPOS` (ซึ่งมีไฟล์ `CLAUDE.md.txt` อยู่แล้ว) พร้อม TypeScript strict mode, App Router, Tailwind CSS, ESLint, และ git initial commit

**Environment:** Windows 11 Pro · PowerShell · Node.js ≥ 20 · npm ≥ 10

---

## ไฟล์ที่จะถูกสร้างโดย Task นี้

| ไฟล์ | หน้าที่ |
|------|---------|
| `package.json` | Dependencies + scripts |
| `tsconfig.json` | TypeScript config (จะแก้ strict เพิ่ม) |
| `next.config.ts` | Next.js config |
| `tailwind.config.ts` | Tailwind base config (จะแก้ใน Task 2) |
| `postcss.config.mjs` | PostCSS สำหรับ Tailwind |
| `.gitignore` | Exclude node_modules, .next, .env.local |
| `src/app/layout.tsx` | Root layout scaffold |
| `src/app/page.tsx` | Home page scaffold |
| `src/app/globals.css` | Global styles scaffold |
| `public/` | Static assets folder |

---

## Steps

### Step 1: Pre-flight — ตรวจสอบ Node.js และ npm

```powershell
node --version
npm --version
```

**Expected:**
- Node.js: `v20.x.x` หรือสูงกว่า
- npm: `10.x.x` หรือสูงกว่า

**ถ้าต่ำกว่า:** ดาวน์โหลด Node.js LTS จาก https://nodejs.org → ติดตั้ง → เปิด PowerShell ใหม่ → รันคำสั่งนี้อีกครั้ง

---

### Step 2: ตรวจสอบ directory ปัจจุบัน

```powershell
Get-ChildItem "E:\KIDKUBPOS"
```

**Expected:** มีเพียง `CLAUDE.md.txt` ไม่มี `package.json`

---

### Step 3: รัน create-next-app ใน directory ที่มีอยู่

เพราะ `E:\KIDKUBPOS` มีอยู่แล้ว จึงใช้ `.` (current directory):

```powershell
cd E:\KIDKUBPOS
npx create-next-app@latest .
```

**ตอบ interactive prompts ตามนี้ทุกข้อ:**

| คำถาม | คำตอบ |
|-------|-------|
| Would you like to use TypeScript? | **Yes** |
| Would you like to use ESLint? | **Yes** |
| Would you like to use Tailwind CSS? | **Yes** |
| Would you like your code inside a `src/` directory? | **Yes** |
| Would you like to use App Router? | **Yes** |
| Would you like to use Turbopack for `next dev`? | **No** |
| Would you like to customize the import alias (`@/*` by default)? | **No** |

> ถ้า prompt ถามว่า "The directory contains files that could conflict. Continue?" → ตอบ **Yes** (ไฟล์ `CLAUDE.md.txt` ไม่ conflict กับ Next.js)

รอ ~1-2 นาที จนติดตั้ง dependencies เสร็จ

---

### Step 4: ตรวจสอบ structure ที่ถูกสร้าง

```powershell
Get-ChildItem "E:\KIDKUBPOS"
```

**Expected — ต้องเห็นไฟล์เหล่านี้:**
```
src\
public\
package.json
tsconfig.json
next.config.ts
tailwind.config.ts
postcss.config.mjs
.gitignore
node_modules\
CLAUDE.md.txt   ← ยังอยู่ครบ ไม่ถูกลบ
```

---

### Step 5: ตรวจสอบ Next.js version ใน package.json

```powershell
Get-Content "E:\KIDKUBPOS\package.json" | Select-String "next|react"
```

**Expected:**
```
"next": "15.x.x",
"react": "19.x.x",
"react-dom": "19.x.x",
```

---

### Step 6: เพิ่ม `noUncheckedIndexedAccess` ใน tsconfig.json

เปิดไฟล์ `E:\KIDKUBPOS\tsconfig.json` แล้วหาบรรทัด `"strict": true`
เพิ่มบรรทัด `"noUncheckedIndexedAccess": true` ต่อจาก strict ทันที:

```json
{
  "compilerOptions": {
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
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

---

### Step 7: ตรวจสอบ .gitignore ครอบคลุม .env.local

```powershell
Select-String -Path "E:\KIDKUBPOS\.gitignore" -Pattern "env"
```

**Expected:** เห็น line ที่มี `.env*.local` หรือ `.env.local`

**ถ้าไม่มี:** เพิ่มด้วยคำสั่ง:
```powershell
Add-Content "E:\KIDKUBPOS\.gitignore" "`n# Local env`n.env.local`n.env*.local"
```

---

### Step 8: TypeScript pre-check

```powershell
cd E:\KIDKUBPOS
npx tsc --noEmit
```

**Expected:** ไม่มี error ใด (พิมพ์อะไรออกมาก็ตาม ขอแค่ไม่มีบรรทัด `error TS`)

---

### Step 9: รัน dev server และดูผลใน browser

```powershell
npm run dev
```

**Expected output:**
```
▲ Next.js 15.x.x
- Local:        http://localhost:3000
✓ Ready in Xs
```

เปิด browser → `http://localhost:3000` → เห็นหน้า Next.js default welcome page

หยุด server: **Ctrl+C** ใน PowerShell

---

### Step 10: git init และ initial commit

```powershell
cd E:\KIDKUBPOS
git init
git add package.json tsconfig.json next.config.ts tailwind.config.ts postcss.config.mjs .gitignore src/ public/
git commit -m "feat: initialize Next.js 15 project with TypeScript strict mode"
```

> **อย่า `git add`:** `node_modules/`, `.next/`, `CLAUDE.md.txt`

**ตรวจสอบ commit:**
```powershell
git log --oneline
```

Expected: เห็น 1 commit line

---

## Completion Criteria — ก่อนไป Task 2 ต้องผ่านทุกข้อ

- [ ] `npm run dev` เปิดได้ที่ `http://localhost:3000` ไม่มี error
- [ ] `npx tsc --noEmit` ไม่มี `error TS` ใด
- [ ] `tsconfig.json` มีทั้ง `"strict": true` และ `"noUncheckedIndexedAccess": true`
- [ ] `.gitignore` มี `.env.local`
- [ ] `git log --oneline` แสดง 1 commit พอดี
