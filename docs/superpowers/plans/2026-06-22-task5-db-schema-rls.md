# Task 5: Initial DB Schema + RLS — Step-by-Step Detail

> **กฎเหล็ก:** นำเสนอแผนเสร็จแล้ว หยุดรอ อย่ารันคำสั่งใดจนกว่าจะได้รับอนุมัติ

**Goal:** สร้างตาราง `tenants` และ `profiles` พร้อม RLS policies บน Supabase cloud, แล้ว generate TypeScript types เข้า `src/types/database.ts` แทน placeholder เดิม

---

## ข้อกำหนดจาก CLAUDE.md ที่ Task นี้ต้องปฏิบัติตาม

| กฎเหล็ก | วิธีปฏิบัติ |
|---------|------------|
| ทุก table ต้องมี `tenant_id uuid NOT NULL` | `profiles` มี `tenant_id` FK → `tenants.id` |
| RLS เปิดบน **ทุก** table | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` ทั้ง 2 tables |
| ห้ามข้ามร้านค้ากัน | Policy ตรวจ `tenant_id` ผ่าน `auth.uid()` ทุก query |

---

## ไฟล์ที่จะถูกสร้าง/แก้ไข

| ไฟล์ | หน้าที่ |
|------|---------|
| `supabase/config.toml` | Supabase CLI project config (สร้างโดย `supabase init`) |
| `supabase/migrations/20260622000000_initial_schema.sql` | SQL migration: tables + RLS |
| `src/types/database.ts` | **แทนที่** placeholder ด้วย generated types จาก schema จริง |

---

## Steps

> **สัญลักษณ์:** ✋ = ผู้ใช้ต้องพิมพ์เอง (interactive/sensitive) | 🤖 = ผมรันให้

---

### Step 1: 🤖 ติดตั้ง Supabase CLI

```powershell
npm install -g supabase
```

ตรวจสอบ:
```powershell
supabase --version
```

**Expected:** แสดง version number เช่น `2.x.x`

---

### Step 2: ✋ USER: Login Supabase CLI (ผู้ใช้ทำเอง)

**ผมจะหยุดรอที่ Step นี้** — ผู้ใช้พิมพ์คำสั่งนี้เองใน PowerShell:

```powershell
supabase login
```

**สิ่งที่จะเกิดขึ้น:** เปิด browser → Login ด้วย Supabase account → กลับมาที่ terminal เห็น `You are now logged in`

แจ้งผมเมื่อ login เสร็จแล้ว

---

### Step 3: 🤖 Initialize Supabase project (สร้าง supabase/ directory)

```powershell
cd "E:\KIDKUBPOS"; supabase init
```

**ถ้า prompt ถามว่า "Generate VS Code settings?"** → ตอบ `n`
**ถ้า prompt ถามว่า "Generate IntelliJ Settings?"** → ตอบ `n`

**Expected:** สร้างไฟล์ `supabase/config.toml`

ตรวจสอบ:
```powershell
Test-Path "E:\KIDKUBPOS\supabase\config.toml"
```

**Expected:** `True`

---

### Step 4: ✋ USER: Link project (ผู้ใช้ทำเอง — ต้องใช้ Project Reference ID)

**ผมจะหยุดรอที่ Step นี้** — ผู้ใช้พิมพ์คำสั่งนี้เองใน PowerShell โดยแทนที่ `<your-project-ref>` ด้วย Project Reference ID จริง:

```powershell
supabase link --project-ref <your-project-ref>
```

**หา Project Reference ID ได้ที่:** Supabase Dashboard → เลือกโปรเจกต์ → Settings → General → Project ID (หรือดูใน URL: `https://supabase.com/dashboard/project/<ref>`)

**Expected:** `Finished supabase link.`

แจ้งผมเมื่อ link เสร็จแล้ว

---

### Step 5: 🤖 สร้าง Migration File

สร้างไฟล์ `supabase/migrations/20260622000000_initial_schema.sql`:

```sql
-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- TENANTS: แต่ละร้านค้า/ธุรกิจ = 1 tenant
-- ============================================================
create table public.tenants (
  id         uuid        primary key default uuid_generate_v4(),
  name       text        not null,
  slug       text        unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- PROFILES: ขยาย auth.users ด้วย tenant membership + role
-- ============================================================
create table public.profiles (
  id         uuid        primary key references auth.users(id) on delete cascade,
  tenant_id  uuid        not null references public.tenants(id) on delete cascade,
  full_name  text,
  role       text        not null default 'staff'
             check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_tenant_id_idx on public.profiles(tenant_id);

-- ============================================================
-- ROW LEVEL SECURITY — ทุก table ต้องเปิด RLS (กฎเหล็กจาก CLAUDE.md)
-- ============================================================
alter table public.tenants  enable row level security;
alter table public.profiles enable row level security;

-- tenants: ผู้ใช้เห็นได้เฉพาะ tenant ของตัวเอง
create policy "tenants_select_own_tenant"
  on public.tenants for select
  using (
    id in (
      select tenant_id from public.profiles
      where id = auth.uid()
    )
  );

-- profiles: ผู้ใช้เห็นได้เฉพาะ profiles ใน tenant เดียวกัน
create policy "profiles_select_own_tenant"
  on public.profiles for select
  using (
    tenant_id in (
      select tenant_id from public.profiles
      where id = auth.uid()
    )
  );

-- profiles: ผู้ใช้แก้ได้เฉพาะ profile ของตัวเอง
create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid());

-- ============================================================
-- AUTO-UPDATE updated_at ON CHANGE
-- ============================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
```

ตรวจสอบไฟล์ถูกสร้าง:
```powershell
Test-Path "E:\KIDKUBPOS\supabase\migrations\20260622000000_initial_schema.sql"
```

**Expected:** `True`

---

### Step 6: 🤖 Push migration ไปยัง Supabase cloud

```powershell
cd "E:\KIDKUBPOS"; supabase db push
```

**ถ้า prompt ถามว่า "Do you want to push these migrations?"** → ตอบ `y`

**Expected output:**
```
Applying migration 20260622000000_initial_schema.sql...
Migration successful.
```

**ถ้า error เรื่อง extension/permission:** ตรวจว่า Supabase project เป็น Free tier ซึ่งรองรับ `uuid-ossp` อยู่แล้ว

---

### Step 7: 🤖 Generate TypeScript types จาก schema จริง

```powershell
cd "E:\KIDKUBPOS"; supabase gen types typescript --linked > src/types/database.ts
```

**ไฟล์ `src/types/database.ts` จะถูกแทนที่ทั้งหมด** — ไม่ต้อง merge manual

---

### Step 8: 🤖 ตรวจสอบ generated types มี tenants + profiles

```powershell
Select-String -Path "E:\KIDKUBPOS\src\types\database.ts" -Pattern "tenants|profiles"
```

**Expected:** เห็นบรรทัดที่มี `tenants` และ `profiles` ใน output (ยืนยันว่า migration ขึ้นจริง)

---

### Step 9: 🤖 TypeScript check

```powershell
cd "E:\KIDKUBPOS"; npx tsc --noEmit
```

**Expected:** ไม่มี `error TS` ใด

**ถ้า error เรื่อง Database type:** ตรวจว่า `src/types/database.ts` ถูก generate สำเร็จและไม่ใช่ placeholder เดิม

---

### Step 10: 🤖 Commit

```powershell
cd "E:\KIDKUBPOS"
git add supabase/config.toml supabase/migrations/20260622000000_initial_schema.sql src/types/database.ts
git commit -m "feat: add initial DB schema (tenants + profiles) with RLS policies"
```

ตรวจสอบ:
```powershell
git log --oneline
```

**Expected:** เห็น 5 commits

---

## ลำดับ Steps และผู้รับผิดชอบ

| Step | ผู้ทำ | สิ่งที่ทำ | หยุดรอ? |
|------|-------|-----------|---------|
| 1 | 🤖 ผม | ติดตั้ง Supabase CLI | ไม่ |
| 2 | ✋ ผู้ใช้ | `supabase login` (browser auth) | **ใช่ — รอผู้ใช้แจ้ง** |
| 3 | 🤖 ผม | `supabase init` | ไม่ |
| 4 | ✋ ผู้ใช้ | `supabase link --project-ref <ref>` | **ใช่ — รอผู้ใช้แจ้ง** |
| 5 | 🤖 ผม | สร้าง migration SQL | ไม่ |
| 6 | 🤖 ผม | `supabase db push` | ไม่ |
| 7 | 🤖 ผม | `supabase gen types typescript` | ไม่ |
| 8 | 🤖 ผม | ตรวจ generated types | ไม่ |
| 9 | 🤖 ผม | `npx tsc --noEmit` | ไม่ |
| 10 | 🤖 ผม | `git commit` | ไม่ |

---

## Completion Criteria — ก่อนไป Task 6 ต้องผ่านทุกข้อ

- [ ] `supabase/config.toml` มีอยู่ใน project
- [ ] `supabase/migrations/20260622000000_initial_schema.sql` มีอยู่
- [ ] Supabase Dashboard เห็นตาราง `tenants` และ `profiles` ใน Table Editor
- [ ] `src/types/database.ts` มี `tenants` และ `profiles` (ไม่ใช่ placeholder)
- [ ] `npx tsc --noEmit` ไม่มี error
- [ ] `git log --oneline` แสดง 5 commits
