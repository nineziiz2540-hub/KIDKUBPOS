# Stack 8: Clean Up & Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ยืนยัน TypeScript clean, ลบ dead code, และปิดช่องโหว่ด้าน security ทั้ง auth middleware และ tenant isolation ใน Server Actions

**Architecture:** Three independent cleanup passes — compile-check first (catch type regressions from Stacks 1–7), then dead-code removal (one unused component + one wrong CSS class), then two security hardening fixes that are independently verifiable.

**Tech Stack:** TypeScript 5, Next.js 16 App Router, Supabase SSR (@supabase/ssr)

## Global Constraints

- ห้าม commit `.env.local` หรือ Supabase keys
- ห้ามแก้ไข `tsconfig.json` เพื่อ suppress errors — fix the code instead
- แก้ตาม Supabase SSR patterns ที่ใช้อยู่ (`@supabase/ssr` via `createServerClient`)
- ห้ามเพิ่ม dependency ใหม่ — ใช้เฉพาะ API ที่มีอยู่แล้ว

---

### Task 1: TypeScript Clean Check

**Files:**
- No new files
- Modify: ถ้าพบ error ให้แก้ที่ไฟล์นั้นๆ ตรงๆ

**Interfaces:**
- Consumes: ไม่มี
- Produces: ไม่มี — task นี้เป็น verification pass

- [ ] **Step 1: Run TypeScript check**

```powershell
npx tsc --noEmit 2>&1
```

Expected output (clean): ไม่มี output เลย หรือ `Found 0 errors.`

ถ้ามี error ให้ดูรูปแบบ:
```
src/path/file.tsx(42,5): error TS2322: Type 'X' is not assignable to type 'Y'.
```

- [ ] **Step 2: Fix errors (ถ้ามี)**

ตัวอย่าง error ที่อาจพบและวิธีแก้:

**TS2322 — type mismatch:** ดู return type ของ function vs. type ที่รับ

**TS7006 — implicit any:** เพิ่ม explicit type annotation

**TS2532 — possibly undefined (noUncheckedIndexedAccess):** ใช้ `?? fallback`
```ts
// ก่อน
const label = LABELS[key]
// หลัง
const label = LABELS[key] ?? key
```

- [ ] **Step 3: Verify check passes**

```powershell
npx tsc --noEmit 2>&1
```

Expected: ไม่มี output (zero errors)

- [ ] **Step 4: Commit (เฉพาะถ้ามีไฟล์ที่แก้)**

ถ้า `tsc --noEmit` clean ตั้งแต่ Step 1 ให้ข้าม Step 4

ถ้ามีการแก้ไข:
```powershell
git add <files-you-fixed>
git commit -m "fix: resolve TypeScript errors from tsc --noEmit"
```

---

### Task 2: Dead Code Removal

**Files:**
- Delete: `src/components/ui/separator.tsx`
- Modify: `src/components/products/product-form.tsx` (line 103)

**Interfaces:**
- Consumes: ไม่มี
- Produces: ไม่มี — cleanup only

**Background:** Codebase audit พบ 2 รายการที่ต้องแก้:
1. `separator.tsx` มี 0 import ใน codebase ทั้งหมด (verified via grep)
2. `product-form.tsx` line 103 ใช้ `text-danger` ซึ่งไม่ใช่ CSS class ที่นิยามในโปรเจกต์นี้ — class ที่ถูกต้องคือ `text-destructive` (ใช้ใน stack ต่างๆ ก่อนหน้า)

- [ ] **Step 1: Verify separator.tsx has zero usages**

```powershell
Select-String -Path "src\**\*.tsx","src\**\*.ts" -Pattern "separator" -Recurse
```

Expected: ไม่มี output เลย (0 matches — ถ้ามีผลลัพธ์ ให้ไม่ลบจนกว่าจะตรวจสอบก่อน)

- [ ] **Step 2: Delete separator.tsx**

```powershell
Remove-Item src\components\ui\separator.tsx
```

- [ ] **Step 3: Fix text-danger → text-destructive in product-form**

แก้ไฟล์ `src/components/products/product-form.tsx` บรรทัด 103:

ก่อน:
```tsx
{state?.error !== undefined && (
  <p className="text-sm font-medium text-danger">{state.error}</p>
)}
```

หลัง:
```tsx
{state?.error !== undefined && (
  <p className="text-sm font-medium text-destructive">{state.error}</p>
)}
```

- [ ] **Step 4: Verify TypeScript still clean**

```powershell
npx tsc --noEmit 2>&1
```

Expected: ไม่มี output (zero errors)

- [ ] **Step 5: Commit**

```powershell
git add src/components/products/product-form.tsx
git commit -m "fix: remove unused Separator component, fix text-danger to text-destructive"
```

---

### Task 3: Security Hardening

**Files:**
- Modify: `src/proxy.ts`
- Modify: `src/app/actions/products.ts`
- Modify: `src/app/actions/categories.ts`

**Interfaces:**
- Consumes: ไม่มี
- Produces: ไม่มี — security fixes only

**Security issues found:**

**Issue A — `proxy.ts` ใช้ `getSession()` แทน `getUser()`:**
`supabase.auth.getSession()` อ่าน session จาก cookie โดยตรง **โดยไม่** re-validate กับ Supabase auth server ทำให้ถ้า cookie ถูก tamper สามารถ bypass auth middleware ได้ Supabase แนะนำให้ใช้ `getUser()` ใน server-side code ทุกจุด เพราะ `getUser()` ส่ง request ไป auth server เสมอ

**Issue B — Server Actions ไม่ scope mutations ด้วย `tenant_id`:**
`updateProduct`, `deleteProduct`, `updateCategory`, `deleteCategory` filter ด้วย `.eq("id", id)` เท่านั้น โดยพึ่ง RLS อย่างเดียวสำหรับ tenant isolation Defense-in-depth: ควรเพิ่ม `.eq("tenant_id", profile.tenant_id)` ใน query layer ด้วย เพื่อให้ชัดเจนและมี 2 ชั้นป้องกัน

---

#### Step 1: Fix proxy.ts — getSession → getUser

แก้ไฟล์ `src/proxy.ts` เปลี่ยน lines 29–33 จาก:

```ts
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const { pathname } = request.nextUrl;
  const isAuthed = session !== null;
```

เป็น:

```ts
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthed = user !== null;
```

ไฟล์ทั้งหมดหลังแก้จะเป็น:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthed = user !== null;
  const isLoginPage = pathname === "/login";

  if (!isAuthed && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isAuthed && isLoginPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icons|manifest\\.json|sw\\.js|sw\\.js\\.map).*)",
  ],
};
```

- [ ] **Step 1: Apply the proxy.ts fix above**

- [ ] **Step 2: Fix products.ts — add tenant_id scope to updateProduct and deleteProduct**

แก้ไฟล์ `src/app/actions/products.ts`:

**updateProduct** (lines 82–88) เปลี่ยนจาก:
```ts
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({
      name: name.trim(),
      price,
      description:
        typeof description === "string" && description.trim() !== ""
          ? description.trim()
          : null,
      category_id:
        typeof categoryId === "string" && categoryId !== ""
          ? categoryId
          : null,
      is_active: isActive,
    })
    .eq("id", id);
```

เป็น:
```ts
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({
      name: name.trim(),
      price,
      description:
        typeof description === "string" && description.trim() !== ""
          ? description.trim()
          : null,
      category_id:
        typeof categoryId === "string" && categoryId !== ""
          ? categoryId
          : null,
      is_active: isActive,
    })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);
```

**deleteProduct** (lines 110–114) เปลี่ยนจาก:
```ts
  const supabase = await createClient();
  await supabase.from("products").delete().eq("id", id);
  redirect("/products");
```

เป็น:
```ts
  const supabase = await createClient();
  await supabase
    .from("products")
    .delete()
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);
  redirect("/products");
```

- [ ] **Step 3: Fix categories.ts — add tenant_id scope to updateCategory and deleteCategory**

แก้ไฟล์ `src/app/actions/categories.ts`:

**updateCategory** (lines 53–58) เปลี่ยนจาก:
```ts
  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .update({ name: name.trim() })
    .eq("id", id);
```

เป็น:
```ts
  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .update({ name: name.trim() })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);
```

**deleteCategory** (lines 68–73) เปลี่ยนจาก:
```ts
  const supabase = await createClient();
  await supabase.from("categories").delete().eq("id", id);
  redirect("/categories");
```

เป็น:
```ts
  const supabase = await createClient();
  await supabase
    .from("categories")
    .delete()
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);
  redirect("/categories");
```

- [ ] **Step 4: Verify TypeScript still clean**

```powershell
npx tsc --noEmit 2>&1
```

Expected: ไม่มี output (zero errors)

- [ ] **Step 5: Commit**

```powershell
git add src/proxy.ts src/app/actions/products.ts src/app/actions/categories.ts
git commit -m "security: use getUser() in middleware, add tenant_id scope to all mutations"
```

- [ ] **Step 6: Push to GitHub**

```powershell
git push origin main
```

Expected: `main -> main` พร้อม commit hashes ใหม่
