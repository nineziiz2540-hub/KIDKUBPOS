# Task 8: GitHub + Vercel CI/CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ผูก repo กับ GitHub ด้วย CI workflow ตรวจ TypeScript และ deploy-ready `vercel.json` แล้ว push โค้ดทั้งหมดขึ้น `main` branch

**Architecture:** GitHub Actions CI job เดียว (`typecheck`) รัน `npx tsc --noEmit` + `npm run lint` ทุก push/PR บน `main` — Vercel ใช้ `vercel.json` ที่ระบุ `buildCommand: "npm run build"` เพื่อให้ใช้ `--webpack` flag จาก `package.json` ซึ่ง Vercel จะ detect อัตโนมัติ — local branch ถูก rename จาก `master` เป็น `main` ก่อน push

**Tech Stack:** GitHub Actions, Vercel (Next.js framework), ESLint 9 flat config (`eslint.config.mjs`), TypeScript strict

## Global Constraints

- Branch ที่ push: `main` (rename จาก local `master` ก่อน push)
- Remote URL: `https://github.com/nineziiz2540-hub/KIDKUBPOS.git`
- Node.js version ใน CI: 20 LTS (ตรงกับ `@types/node@^20` ใน project)
- ห้าม commit `.env.local` หรือ Supabase keys — ใส่ใน Vercel dashboard เท่านั้น
- ห้าม commit `CLAUDE.md.txt` — duplicate ที่ไม่จำเป็น
- `npm run build/dev` ต้องใช้ `--webpack` (ดูจาก package.json — สำคัญสำหรับ @serwist/next)

---

## ไฟล์ที่จะถูกสร้าง/แก้ไข

| ไฟล์ | สร้าง/แก้ | หน้าที่ |
|------|-----------|---------|
| `.github/workflows/ci.yml` | สร้าง | GitHub Actions: tsc + lint บน push/PR ไปยัง main |
| `vercel.json` | สร้าง | บอก Vercel ใช้ Next.js framework + `npm run build` |

**ไฟล์ untracked ที่จะถูก commit พร้อมกัน:**
| ไฟล์ | เหตุผล |
|------|--------|
| `AGENTS.md` | Project instructions — ควรอยู่ใน repo |
| `CLAUDE.md` | อ้างอิง AGENTS.md — ควรอยู่ใน repo |
| `README.md` | Default Next.js README |
| `docs/` | Plan documents ทั้งหมด |
| `supabase/.gitignore` | สร้างโดย `supabase init` — ควรอยู่ใน repo |
| `package-lock.json` | Lockfile — จำเป็นสำหรับ `npm ci` ใน CI |

---

## Prerequisites (ผู้ใช้ต้องทำก่อน Push)

> **ถ้ายังไม่ได้ทำ:** สร้าง GitHub repo `KIDKUBPOS` ที่ `https://github.com/nineziiz2540-hub` โดยเลือก **Empty repository** (อย่า add README/gitignore — เรามีแล้ว)

> **GitHub Auth:** ตรวจว่า git credential พร้อม (HTTPS token หรือ SSH key) — ถ้า push แล้วถูกขอ username/password ให้ใช้ GitHub Personal Access Token

---

## Steps

---

### Step 1: 🤖 สร้าง `.github/workflows/ci.yml`

- [ ] สร้าง directory และไฟล์:

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  typecheck:
    name: TypeScript + Lint
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: TypeScript check
        run: npx tsc --noEmit

      - name: Lint
        run: npm run lint
```

**หมายเหตุ:**
- `actions/checkout@v4` + `actions/setup-node@v4` — latest stable versions
- `cache: npm` — cache node_modules ด้วย package-lock.json hash → CI เร็วขึ้น
- `npm ci` แทน `npm install` — deterministic install จาก lockfile, เหมาะกับ CI
- `npx tsc --noEmit` — type-check ไม่ emit ไฟล์ (ตรงกับ script เราใช้ใน dev)
- `npm run lint` — รัน `eslint` ด้วย flat config (`eslint.config.mjs` ที่มีอยู่แล้ว)
- ไม่มี `npm run build` ใน CI — Vercel จัดการ production build แยกต่างหาก

---

### Step 2: 🤖 สร้าง `vercel.json`

- [ ] สร้างไฟล์ `vercel.json` ที่ root:

```json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "installCommand": "npm install"
}
```

**หมายเหตุ:**
- `framework: "nextjs"` — บอก Vercel ใช้ Next.js preset
- `buildCommand: "npm run build"` — ใช้ script จาก `package.json` ซึ่งมี `--webpack` flag อยู่แล้ว → `@serwist/next` ทำงานได้
- `installCommand: "npm install"` — ใช้ npm (ไม่ใช่ pnpm/yarn)
- ไม่ต้องระบุ `outputDirectory` — Next.js default คือ `.next` ซึ่ง Vercel รู้อยู่แล้ว

---

### Step 3: 🤖 Commit CI/CD config + untracked project files

- [ ] Stage ทุกไฟล์ที่ต้องการ:

```powershell
cd "E:\KIDKUBPOS"
git add .github/workflows/ci.yml vercel.json AGENTS.md CLAUDE.md README.md docs/ supabase/.gitignore package-lock.json
```

ตรวจ staged files (ต้องไม่มี `.env.local` หรือ `CLAUDE.md.txt`):
```powershell
git status
```

**Expected:** เห็น staged files ตามที่ add ไป และ `CLAUDE.md.txt` ยังอยู่ใน Untracked (ไม่ถูก stage)

- [ ] Commit:
```powershell
git commit -m @'
feat: add GitHub Actions CI (tsc + lint) and Vercel config

- Add .github/workflows/ci.yml: typecheck + lint on push/PR to main
- Add vercel.json with explicit buildCommand to preserve --webpack flag
- Commit project docs, AGENTS.md, CLAUDE.md, supabase gitignore

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
```

ตรวจสอบ:
```powershell
git log --oneline
```

**Expected:** เห็น 8 commits

---

### Step 4: 🤖 Rename local branch `master` → `main`

GitHub ใช้ `main` เป็น default branch — rename local ก่อน push เพื่อให้ตรงกัน

- [ ] รัน:
```powershell
git branch -m master main
```

ตรวจสอบ:
```powershell
git branch
```

**Expected:** เห็น `* main` (ไม่มี `master` แล้ว)

---

### Step 5: 🤖 Add remote origin

- [ ] รัน:
```powershell
git remote add origin https://github.com/nineziiz2540-hub/KIDKUBPOS.git
```

ตรวจสอบ:
```powershell
git remote -v
```

**Expected:**
```
origin  https://github.com/nineziiz2540-hub/KIDKUBPOS.git (fetch)
origin  https://github.com/nineziiz2540-hub/KIDKUBPOS.git (push)
```

---

### Step 6: 🤖 Push ขึ้น GitHub

- [ ] รัน:
```powershell
git push -u origin main
```

**Expected:** เห็น output ประมาณนี้:
```
Enumerating objects: ...
Counting objects: ...
Writing objects: 100% ...
Branch 'main' set up to track remote branch 'main' from 'origin'.
```

**ถ้า error "Authentication failed":** ใช้ GitHub Personal Access Token แทน password — สร้างที่ GitHub → Settings → Developer Settings → Personal Access Tokens → Tokens (classic) → scope: `repo`

**ถ้า error "remote: Repository not found":** ตรวจว่าสร้าง GitHub repo ที่ `https://github.com/nineziiz2540-hub/KIDKUBPOS` แล้ว

---

### Step 7: 🤖 ตรวจสอบ push สำเร็จ

- [ ] รัน:
```powershell
git log --oneline origin/main
```

**Expected:** เห็น 8 commits เหมือน local

- [ ] ตรวจว่า CI trigger — เปิด `https://github.com/nineziiz2540-hub/KIDKUBPOS/actions` ใน browser และดูว่า workflow "CI" เริ่มรัน (อาจใช้เวลา 1-2 นาที)

---

### Step 8: ✋ Manual — Connect Vercel + เพิ่ม Env Vars

**ผมหยุดรอที่ Step นี้** — ผู้ใช้ทำเองใน browser:

1. ไปที่ [vercel.com](https://vercel.com) → **Add New Project**
2. เลือก **Import Git Repository** → เลือก `nineziiz2540-hub/KIDKUBPOS`
3. Vercel จะ auto-detect Next.js — ตรวจว่า settings ตรง:
   - **Framework Preset:** Next.js
   - **Build Command:** `npm run build` (ดึงจาก `vercel.json` — มี `--webpack` อยู่แล้ว)
   - **Install Command:** `npm install`
4. คลิก **Environment Variables** และเพิ่มทั้ง 3 ค่า (ดูจาก `.env.local`):

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | ค่าจาก `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ค่าจาก `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | ค่าจาก `.env.local` |

5. คลิก **Deploy**
6. รอ deploy เสร็จ — เห็น URL เช่น `https://kidkubpos.vercel.app`

แจ้งผมเมื่อ Vercel deploy สำเร็จ (หรือถ้า error แจ้ง error message)

---

## ลำดับ Steps และผู้รับผิดชอบ

| Step | ผู้ทำ | สิ่งที่ทำ | หยุดรอ? |
|------|-------|-----------|---------|
| 1 | 🤖 ผม | สร้าง `.github/workflows/ci.yml` | ไม่ |
| 2 | 🤖 ผม | สร้าง `vercel.json` | ไม่ |
| 3 | 🤖 ผม | Commit CI/CD + project files (8 commits) | ไม่ |
| 4 | 🤖 ผม | `git branch -m master main` | ไม่ |
| 5 | 🤖 ผม | `git remote add origin ...` | ไม่ |
| 6 | 🤖 ผม | `git push -u origin main` | ไม่ |
| 7 | 🤖 ผม | ตรวจสอบ 8 commits บน remote | ไม่ |
| 8 | ✋ ผู้ใช้ | Vercel connect + env vars + deploy | **ใช่ — รอผู้ใช้แจ้งผล** |

---

## Completion Criteria — Stack 1 เสร็จสมบูรณ์เมื่อผ่านทุกข้อ

- [ ] `.github/workflows/ci.yml` มี job `typecheck` รัน `tsc --noEmit` + `npm run lint`
- [ ] `vercel.json` มี `buildCommand: "npm run build"`
- [ ] `git log --oneline origin/main` แสดง 8 commits
- [ ] `https://github.com/nineziiz2540-hub/KIDKUBPOS/actions` เห็น CI workflow รัน (green หรือ running)
- [ ] Vercel deploy สำเร็จ — เปิด URL แล้วเห็น Dashboard + Brand Shell ถูกต้อง
