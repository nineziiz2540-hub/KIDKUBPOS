# Stack 7: Store Settings & Team Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้างหน้า /settings ให้ owner แก้ไขชื่อร้านได้ และหน้า /settings/team สำหรับดูรายชื่อพนักงานและเปลี่ยน Role ได้ (เฉพาะ owner)

**Architecture:** ใช้ Server Components สำหรับทั้งสองหน้า, Server Actions สำหรับ mutation (updateStoreName, updateMemberRole), และ Client Components เฉพาะสำหรับ form interaction ที่ต้องใช้ `useActionState`. Sidebar มี `/settings` พร้อม `minRole: "owner"` อยู่แล้ว ไม่ต้องแก้ sidebar.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), Supabase JS client, TypeScript, Tailwind CSS, shadcn/ui Input/Button/Label

## Global Constraints

- Read `node_modules/next/dist/docs/` before touching any Next.js API — breaking changes exist
- Never commit `.env.local` or any Supabase key
- `params` and `searchParams` in page components are `Promise<{...}>` — must `await` before use (Next.js 16 pattern)
- All Supabase queries must include `.eq("tenant_id", profile.tenant_id)` for RLS tenant isolation
- TypeScript must pass `npm run build` with zero `error TS` lines
- Use `?? fallback` for any `Record<string, T>[key]` access (`noUncheckedIndexedAccess` is enabled)
- PowerShell single-quoted here-string `@'...'@` for multiline git commit messages (NOT bash heredoc)
- Role check in every Server Action: ตรวจ `profile.role` ก่อนทำ DB operation เสมอ

## File Map

| Action | Path | หน้าที่ |
|--------|------|---------|
| Modify | `src/lib/dal.ts` | เพิ่ม `TeamMember` type + `getTeamMembers()` |
| Create | `src/app/actions/settings.ts` | Server Actions: `updateStoreName`, `updateMemberRole` |
| Create | `src/app/(shell)/settings/page.tsx` | /settings — Server Component, แก้ชื่อร้าน |
| Create | `src/components/settings/store-name-form.tsx` | Client form สำหรับแก้ชื่อร้าน |
| Create | `src/app/(shell)/settings/team/page.tsx` | /settings/team — Server Component, รายชื่อพนักงาน |
| Create | `src/components/settings/role-select-form.tsx` | Client form สำหรับเปลี่ยน Role (auto-submit on change) |

---

### Task 1: DAL + Server Actions

**Files:**
- Modify: `src/lib/dal.ts`
- Create: `src/app/actions/settings.ts`

**Interfaces:**
- Consumes: `createClient` จาก `@/lib/supabase/server`, `getProfile` จาก `@/lib/dal`
- Produces:
  - `type TeamMember = { id: string; full_name: string | null; role: Role; created_at: string }`
  - `getTeamMembers(tenantId: string): Promise<TeamMember[]>`
  - `type SettingsState = { error?: string; success?: boolean } | undefined`
  - `updateStoreName(prevState: SettingsState, formData: FormData): Promise<SettingsState>`
  - `updateMemberRole(prevState: SettingsState, formData: FormData): Promise<SettingsState>`

- [ ] **Step 1: ตรวจ build ก่อนแตะโค้ด**

```powershell
npm run build 2>&1 | Select-String "error TS"
```
Expected: ไม่มี output (zero errors)

- [ ] **Step 2: เพิ่ม Supabase RLS policies ใน Supabase SQL Editor**

เปิด Supabase Dashboard → SQL Editor → รัน SQL ด้านล่างนี้ทีละ block เพื่อให้ owner มีสิทธิ์ update ข้อมูลได้:

```sql
-- Allow owners to update their tenant's name
CREATE POLICY "owners can update their tenant name"
  ON tenants FOR UPDATE TO authenticated
  USING (
    id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'owner'
  )
  WITH CHECK (
    id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );
```

```sql
-- Allow owners to update roles of other profiles in their tenant
CREATE POLICY "owners can update team member roles"
  ON profiles FOR UPDATE TO authenticated
  USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'owner'
  )
  WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );
```

หากมี policy ชื่อเดิมอยู่แล้ว ให้ `DROP POLICY "..." ON ...` ก่อน แล้วค่อย `CREATE` ใหม่

- [ ] **Step 3: เพิ่ม `TeamMember` type และ `getTeamMembers` ใน `src/lib/dal.ts`**

ต่อท้ายไฟล์ `src/lib/dal.ts` (หลัง `getTopProducts`):

```ts
export type TeamMember = {
  id: string;
  full_name: string | null;
  role: Role;
  created_at: string;
};

export async function getTeamMembers(tenantId: string): Promise<TeamMember[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, role, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  return (data ?? []) as TeamMember[];
}
```

- [ ] **Step 4: สร้าง `src/app/actions/settings.ts`**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";

export type SettingsState = { error?: string; success?: boolean } | undefined;

export async function updateStoreName(
  prevState: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const name = formData.get("name");
  if (typeof name !== "string" || name.trim() === "") {
    return { error: "กรุณากรอกชื่อร้านค้า" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tenants")
    .update({ name: name.trim() })
    .eq("id", profile.tenant_id);

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/settings");
  return { success: true };
}

export async function updateMemberRole(
  prevState: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const memberId = formData.get("member_id");
  const role = formData.get("role");

  if (typeof memberId !== "string" || typeof role !== "string") {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }
  if (!["owner", "manager", "staff"].includes(role)) {
    return { error: "role ไม่ถูกต้อง" };
  }
  if (memberId === profile.id) {
    return { error: "ไม่สามารถเปลี่ยน role ของตัวเองได้" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", memberId)
    .eq("tenant_id", profile.tenant_id);

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/settings/team");
  return { success: true };
}
```

- [ ] **Step 5: ตรวจ TypeScript**

```powershell
npm run build 2>&1 | Select-String "error TS"
```
Expected: ไม่มี output

- [ ] **Step 6: Commit**

```powershell
git add src/lib/dal.ts src/app/actions/settings.ts
git commit -m @'
feat: add getTeamMembers to DAL and settings server actions

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
```

---

### Task 2: /settings Page — Store Name Edit

**Files:**
- Create: `src/app/(shell)/settings/page.tsx`
- Create: `src/components/settings/store-name-form.tsx`

**Interfaces:**
- Consumes:
  - `getProfile` จาก `@/lib/dal` — `profile.tenants.name` คือชื่อร้านปัจจุบัน
  - `updateStoreName` จาก `@/app/actions/settings`
  - `type SettingsState` จาก `@/app/actions/settings`
- Produces: ไม่มี export ที่ task อื่นใช้

- [ ] **Step 1: สร้าง `src/components/settings/store-name-form.tsx`**

```tsx
"use client";
import { useActionState } from "react";
import type { SettingsState } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  action: (
    prevState: SettingsState,
    formData: FormData
  ) => Promise<SettingsState>;
  defaultName: string;
};

export function StoreNameForm({ action, defaultName }: Props) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="store-name">ชื่อร้านค้า</Label>
        <Input
          id="store-name"
          name="name"
          defaultValue={defaultName}
          placeholder="ชื่อร้านค้าของคุณ"
          required
        />
      </div>
      {state?.error && (
        <p className="text-sm font-medium text-destructive">{state.error}</p>
      )}
      {state?.success && (
        <p className="text-sm font-medium text-green-600">บันทึกเรียบร้อย</p>
      )}
      <Button
        type="submit"
        disabled={pending}
        className="bg-accent hover:bg-accent/90 text-white"
      >
        {pending ? "กำลังบันทึก…" : "บันทึก"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: สร้าง `src/app/(shell)/settings/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { getProfile } from "@/lib/dal";
import { updateStoreName } from "@/app/actions/settings";
import { StoreNameForm } from "@/components/settings/store-name-form";

export default async function SettingsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner") redirect("/");

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">ตั้งค่าร้านค้า</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          จัดการข้อมูลร้านของคุณ
        </p>
      </div>

      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-sidebar">ข้อมูลร้านค้า</h2>
        <StoreNameForm
          action={updateStoreName}
          defaultName={profile.tenants.name}
        />
      </div>

      <div className="rounded-lg border bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-sidebar">จัดการทีม</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              ดูและแก้ไข Role ของพนักงาน
            </p>
          </div>
          <Link
            href="/settings/team"
            className="flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            <Users size={16} />
            ดูทีมงาน
          </Link>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: ตรวจ TypeScript**

```powershell
npm run build 2>&1 | Select-String "error TS"
```
Expected: ไม่มี output

- [ ] **Step 4: Commit**

```powershell
git add src/app/(shell)/settings/page.tsx src/components/settings/store-name-form.tsx
git commit -m @'
feat: add settings page with store name edit form

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
```

---

### Task 3: /settings/team Page — Role Management

**Files:**
- Create: `src/app/(shell)/settings/team/page.tsx`
- Create: `src/components/settings/role-select-form.tsx`

**Interfaces:**
- Consumes:
  - `getProfile` จาก `@/lib/dal`
  - `getTeamMembers(tenantId: string): Promise<TeamMember[]>` จาก `@/lib/dal` (Task 1)
  - `type TeamMember` จาก `@/lib/dal` (Task 1)
  - `updateMemberRole` จาก `@/app/actions/settings` (Task 1)
  - `type SettingsState` จาก `@/app/actions/settings` (Task 1)
  - `type Role` จาก `@/lib/dal`
- Produces: ไม่มี export ที่ task อื่นใช้

- [ ] **Step 1: สร้าง `src/components/settings/role-select-form.tsx`**

เป็น Client Component ที่ auto-submit เมื่อ select เปลี่ยนค่า ไม่มีปุ่ม Submit แยก

```tsx
"use client";
import { useActionState } from "react";
import type { SettingsState } from "@/app/actions/settings";
import type { Role } from "@/lib/dal";

type Props = {
  action: (
    prevState: SettingsState,
    formData: FormData
  ) => Promise<SettingsState>;
  memberId: string;
  currentRole: Role;
};

export function RoleSelectForm({ action, memberId, currentRole }: Props) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="member_id" value={memberId} />
      <select
        name="role"
        defaultValue={currentRole}
        disabled={pending}
        onChange={(e) => {
          const form = e.currentTarget.form;
          if (form) form.requestSubmit();
        }}
        className="text-xs rounded border border-input bg-transparent px-2 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      >
        <option value="owner">Owner</option>
        <option value="manager">Manager</option>
        <option value="staff">Staff</option>
      </select>
      {state?.error && (
        <span className="text-xs text-destructive">{state.error}</span>
      )}
    </form>
  );
}
```

- [ ] **Step 2: สร้าง `src/app/(shell)/settings/team/page.tsx`**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getProfile, getTeamMembers } from "@/lib/dal";
import { updateMemberRole } from "@/app/actions/settings";
import { RoleSelectForm } from "@/components/settings/role-select-form";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  staff: "Staff",
};

export default async function TeamPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner") redirect("/");

  const members = await getTeamMembers(profile.tenant_id);

  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center gap-3">
        <Link
          href="/settings"
          className="text-muted-foreground hover:text-sidebar transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-sidebar">จัดการทีม</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {members.length} คนในร้าน
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-white divide-y divide-border">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center gap-4 px-4 py-3"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sidebar text-sm truncate">
                {member.full_name ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {ROLE_LABELS[member.role] ?? member.role}
              </p>
            </div>
            {member.id === profile.id ? (
              <span className="text-xs text-muted-foreground italic px-2 py-1">
                คุณ
              </span>
            ) : (
              <RoleSelectForm
                action={updateMemberRole}
                memberId={member.id}
                currentRole={member.role}
              />
            )}
          </div>
        ))}
        {members.length === 0 && (
          <p className="px-4 py-12 text-center text-muted-foreground text-sm">
            ยังไม่มีพนักงาน
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: ตรวจ TypeScript**

```powershell
npm run build 2>&1 | Select-String "error TS"
```
Expected: ไม่มี output

- [ ] **Step 4: Commit**

```powershell
git add src/app/(shell)/settings/team/page.tsx src/components/settings/role-select-form.tsx
git commit -m @'
feat: add team management page with role change for owner

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
```

- [ ] **Step 5: Push to GitHub**

```powershell
git push origin main
```
Expected: `main -> main` พร้อม 3 commits ของ Stack 7

---

## Self-Review Checklist

**Spec coverage:**
1. ✅ หน้า /settings แก้ไขชื่อร้าน (update `tenants.name`) → Task 2
2. ✅ หน้า /settings/team แสดงรายชื่อพนักงาน (ดึงจาก `profiles` ที่ `tenant_id` ตรงกัน) → Task 3
3. ✅ Server Actions เปลี่ยน Role พนักงาน → Task 1 (`updateMemberRole`)
4. ✅ เฉพาะ Owner เท่านั้น — ทั้งสองหน้า `redirect("/")` ถ้าไม่ใช่ owner, Actions ตรวจ `profile.role !== "owner"` ด้วย

**Placeholder scan:** ไม่มี TBD/TODO — ทุก step มีโค้ดครบถ้วน

**Type consistency:**
- `SettingsState` กำหนดใน `settings.ts` (Task 1) → ใช้ใน `StoreNameForm` (Task 2) และ `RoleSelectForm` (Task 3) ✅
- `TeamMember` กำหนดใน `dal.ts` (Task 1) → ใช้ใน `team/page.tsx` (Task 3) ผ่าน `getTeamMembers` return type ✅
- `Role` import จาก `@/lib/dal` ใน `RoleSelectForm` ✅
- `updateStoreName` / `updateMemberRole` signatures ตรงกันระหว่าง Task 1 และ Task 2/3 ✅

**Edge cases covered:**
- Owner ไม่สามารถเปลี่ยน role ของตัวเองได้ → แสดง "คุณ" label แทน select, และ action check `memberId === profile.id` ✅
- members.length === 0 → แสดง empty state ✅
- `ROLE_LABELS[member.role] ?? member.role` → ป้องกัน `noUncheckedIndexedAccess` ✅
