# Stack 3: Master Data (Products & Categories) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มระบบจัดการ Master Data — หมวดหมู่สินค้า (Categories) และสินค้า (Products) — พร้อม RLS multi-tenant isolation และ role-based CRUD (manager+)

**Architecture:** ตาราง `categories` + `products` ใน Supabase พร้อม RLS ที่ restrict ตาม `tenant_id`; Server Actions ทำ CRUD + role check ที่ app layer; async Server Component pages fetch ข้อมูล + Client Component forms ที่ใช้ `useActionState` pattern เหมือน login page; `DeleteButton` client component handle confirm dialog

**Tech Stack:** Next.js 16.2.9 (App Router, Webpack), React 19, TypeScript strict + noUncheckedIndexedAccess, Tailwind CSS v4, Shadcn UI v4 (base-nova), Supabase (supabase-js v2, @supabase/ssr v0.12), server-only

## Global Constraints

- Next.js 16.2.9 — ใช้ `--webpack` flag (มีอยู่ใน `package.json` scripts แล้ว), ห้ามใช้ Turbopack
- TypeScript strict + noUncheckedIndexedAccess — ทุก code ต้องผ่าน `npx tsc --noEmit` โดยไม่มี error
- `params` ใน dynamic routes เป็น `Promise<{...}>` — ต้อง `await params` ก่อน access fields เสมอ
- Server Actions: `"use server"` directive ที่ top of file; `useActionState<State, FormData>(action, undefined)` สำหรับ forms ที่ต้องแสดง error/pending state
- Supabase mutations ทั้งหมดผ่าน `createClient()` จาก `src/lib/supabase/server.ts` (server-only)
- Auth checks ใช้ `getProfile()` จาก `src/lib/dal.ts` — ห้ามใช้ `getSession()` สำหรับ auth decisions
- Multi-tenant isolation: ทุก DB row ต้องมี `tenant_id` ตรงกับ profile ของ user; RLS enforce ที่ DB layer
- Role-based CRUD: manager และ owner เท่านั้นที่ create/update/delete ได้; staff ดูได้อย่างเดียว
- Brand colors via CSS vars: `text-accent`, `text-sidebar`, `text-danger`, `bg-accent`, `bg-sidebar`
- ห้าม commit `.env.local` หรือ Supabase keys — ใส่ใน Vercel dashboard เท่านั้น
- Commit หลังแต่ละ Task

---

## File Structure

```
src/
  app/
    actions/
      categories.ts          CREATE — Server Actions: createCategory, updateCategory, deleteCategory
      products.ts            CREATE — Server Actions: createProduct, updateProduct, deleteProduct
    (shell)/
      categories/
        page.tsx             CREATE — List page (Server Component)
        new/
          page.tsx           CREATE — Create form page (Server Component wrapping CategoryForm)
        [id]/
          edit/
            page.tsx         CREATE — Edit form page (Server Component wrapping CategoryForm)
      products/
        page.tsx             CREATE — List page (Server Component)
        new/
          page.tsx           CREATE — Create form page
        [id]/
          edit/
            page.tsx         CREATE — Edit form page
  components/
    categories/
      category-form.tsx      CREATE — Client Component form (useActionState)
    products/
      product-form.tsx       CREATE — Client Component form (useActionState + native select + Textarea)
    ui/
      delete-button.tsx      CREATE — Client Component with confirm() dialog
      textarea.tsx           CREATE — via `npx shadcn add textarea`
    shell/
      sidebar.tsx            MODIFY — เพิ่ม Categories nav item (minRole: manager)
  types/
    database.ts              MODIFY — เพิ่ม categories + products table types
```

---

### Task 1: Database Schema + RLS (Supabase SQL)

**Files:** ไม่มีไฟล์ code — รัน SQL ใน Supabase SQL Editor เท่านั้น

**Interfaces:**
- Produces:
  - `categories(id uuid, tenant_id uuid, name text, created_at timestamptz, updated_at timestamptz)` + RLS 4 policies
  - `products(id uuid, tenant_id uuid, category_id uuid|null, name text, price numeric(10,2), description text|null, is_active boolean, created_at timestamptz, updated_at timestamptz)` + RLS 4 policies
  - trigger function `update_updated_at()` สำหรับ auto-update `updated_at`

- [ ] **Step 1: สร้าง trigger function + categories table**

เปิด Supabase Dashboard → SQL Editor → New Query แล้วรัน SQL ต่อไปนี้ทั้งหมด:

```sql
-- Trigger function สำหรับ auto-update updated_at (ใช้ร่วมกันทั้ง 2 tables)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "categories_select" ON categories
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "categories_insert" ON categories
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "categories_update" ON categories
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "categories_delete" ON categories
  FOR DELETE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );
```

Expected output: "Success. No rows returned"

- [ ] **Step 2: สร้าง products table**

รัน SQL ต่อไปนี้ใน SQL Editor (New Query ใหม่):

```sql
CREATE TABLE IF NOT EXISTS products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  name        text NOT NULL,
  price       numeric(10,2) NOT NULL DEFAULT 0,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products_select" ON products
  FOR SELECT USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "products_insert" ON products
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "products_update" ON products
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "products_delete" ON products
  FOR DELETE USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  );
```

Expected output: "Success. No rows returned"

- [ ] **Step 3: ตรวจสอบใน Supabase Dashboard**

- Table Editor → ควรเห็น `categories` และ `products` ปรากฏในรายการ
- Authentication → Policies → เลือก `categories` → ควรเห็น 4 policies (categories_select, categories_insert, categories_update, categories_delete)
- เลือก `products` → ควรเห็น 4 policies เช่นกัน

---

### Task 2: TypeScript Types + UI Primitives

**Files:**
- Modify: `src/types/database.ts`
- Create: `src/components/ui/textarea.tsx` (via shadcn)
- Create: `src/components/ui/delete-button.tsx`
- Modify: `src/components/shell/sidebar.tsx`

**Interfaces:**
- Consumes: ตาราง `categories` + `products` จาก Task 1
- Produces:
  - `Database["public"]["Tables"]["categories"]` type + `Database["public"]["Tables"]["products"]` type
  - `DeleteButton` component: `({ message?: string }) => JSX.Element`
  - Sidebar มี Categories nav item สำหรับ manager+

- [ ] **Step 1: Install Shadcn Textarea component**

```powershell
npx shadcn add textarea
```

Expected: สร้างไฟล์ `src/components/ui/textarea.tsx` พร้อม message "✔ Done."

- [ ] **Step 2: เพิ่ม categories + products types ใน src/types/database.ts**

เปิดไฟล์ `src/types/database.ts` หา section `public: { Tables: {` และเพิ่ม entries ต่อไปนี้ **ก่อน** `profiles:` (เรียงตามตัวอักษร: categories → products → profiles → tenants):

```typescript
      categories: {
        Row: {
          id: string
          tenant_id: string
          name: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          name?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          id: string
          tenant_id: string
          category_id: string | null
          name: string
          price: number
          description: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          category_id?: string | null
          name: string
          price?: number
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          category_id?: string | null
          name?: string
          price?: number
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
```

ผล: `src/types/database.ts` มี 4 tables ใน `public.Tables`: categories, products, profiles, tenants

- [ ] **Step 3: สร้าง src/components/ui/delete-button.tsx**

```tsx
"use client";
import { Button } from "@/components/ui/button";

export function DeleteButton({ message = "ยืนยันการลบ?" }: { message?: string }) {
  return (
    <Button
      type="submit"
      variant="destructive"
      size="sm"
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      ลบ
    </Button>
  );
}
```

- [ ] **Step 4: เพิ่ม Categories nav item ใน src/components/shell/sidebar.tsx**

แก้ไข 2 จุด:

**จุดที่ 1** — เพิ่ม `Tag` ใน lucide-react import:
```typescript
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Tag,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";
```

**จุดที่ 2** — เพิ่ม Categories item ใน `allNavItems` array (หลัง Products, ก่อน Reports):
```typescript
const allNavItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, minRole: "staff" },
  { href: "/orders", label: "Orders", icon: ShoppingCart, minRole: "staff" },
  { href: "/products", label: "Products", icon: Package, minRole: "staff" },
  { href: "/categories", label: "Categories", icon: Tag, minRole: "manager" },
  { href: "/reports", label: "Reports", icon: BarChart3, minRole: "manager" },
  { href: "/settings", label: "Settings", icon: Settings, minRole: "owner" },
];
```

- [ ] **Step 5: TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: ไม่มี error output (exit code 0)

- [ ] **Step 6: Commit**

```powershell
git add src/types/database.ts src/components/ui/delete-button.tsx src/components/ui/textarea.tsx src/components/shell/sidebar.tsx
git commit -m "feat: add categories+products DB types, DeleteButton, Textarea, sidebar Categories link"
```

---

### Task 3: Categories CRUD

**Files:**
- Create: `src/app/actions/categories.ts`
- Create: `src/components/categories/category-form.tsx`
- Create: `src/app/(shell)/categories/page.tsx`
- Create: `src/app/(shell)/categories/new/page.tsx`
- Create: `src/app/(shell)/categories/[id]/edit/page.tsx`

**Interfaces:**
- Consumes:
  - `getProfile(): Promise<ProfileWithTenant | null>` จาก `src/lib/dal.ts`
  - `createClient(): Promise<SupabaseClient<Database>>` จาก `src/lib/supabase/server.ts`
  - `DeleteButton` จาก `src/components/ui/delete-button.tsx`
  - `categories` table จาก Task 1; DB types จาก Task 2
- Produces:
  - `createCategory(prevState: CategoryState, formData: FormData): Promise<CategoryState>` — INSERT + redirect("/categories")
  - `updateCategory(prevState: CategoryState, formData: FormData): Promise<CategoryState>` — UPDATE by id + redirect("/categories")
  - `deleteCategory(formData: FormData): Promise<void>` — DELETE by id + redirect("/categories")
  - `CategoryForm({ action, defaultName?, id? })` — reusable client form component
  - Pages: `/categories` (list), `/categories/new`, `/categories/[id]/edit`

- [ ] **Step 1: สร้าง src/app/actions/categories.ts**

```typescript
"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";

export type CategoryState = { error?: string } | undefined;

function isManagerOrOwner(role: string): boolean {
  return role === "owner" || role === "manager";
}

export async function createCategory(
  prevState: CategoryState,
  formData: FormData
): Promise<CategoryState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const name = formData.get("name");
  if (typeof name !== "string" || name.trim() === "") {
    return { error: "กรุณากรอกชื่อหมวดหมู่" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .insert({ name: name.trim(), tenant_id: profile.tenant_id });

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  redirect("/categories");
}

export async function updateCategory(
  prevState: CategoryState,
  formData: FormData
): Promise<CategoryState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const id = formData.get("id");
  const name = formData.get("name");
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    name.trim() === ""
  ) {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .update({ name: name.trim() })
    .eq("id", id);

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  redirect("/categories");
}

export async function deleteCategory(formData: FormData): Promise<void> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return;

  const id = formData.get("id");
  if (typeof id !== "string") return;

  const supabase = await createClient();
  await supabase.from("categories").delete().eq("id", id);
  redirect("/categories");
}
```

- [ ] **Step 2: สร้าง src/components/categories/category-form.tsx**

```tsx
"use client";
import { useActionState } from "react";
import type { CategoryState } from "@/app/actions/categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  action: (
    prevState: CategoryState,
    formData: FormData
  ) => Promise<CategoryState>;
  defaultName?: string;
  id?: string;
};

export function CategoryForm({ action, defaultName = "", id }: Props) {
  const [state, formAction, pending] = useActionState<CategoryState, FormData>(
    action,
    undefined
  );
  return (
    <form action={formAction} className="max-w-md space-y-4">
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      <div className="space-y-1.5">
        <Label htmlFor="name">ชื่อหมวดหมู่</Label>
        <Input
          id="name"
          name="name"
          defaultValue={defaultName}
          placeholder="เช่น อาหาร, เครื่องดื่ม"
          required
        />
      </div>
      {state?.error !== undefined && (
        <p className="text-sm font-medium text-danger">{state.error}</p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pending}
          className="bg-accent hover:bg-accent/90 text-white"
        >
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => history.back()}
        >
          ยกเลิก
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: สร้าง src/app/(shell)/categories/page.tsx**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { deleteCategory } from "@/app/actions/categories";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/delete-button";

export default async function CategoriesPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const canManage = profile.role === "owner" || profile.role === "manager";

  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name")
    .order("name");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-sidebar">หมวดหมู่สินค้า</h1>
          <p className="text-sm text-muted-foreground mt-1">
            จัดการหมวดหมู่สินค้าของร้านค้า
          </p>
        </div>
        {canManage && (
          <Button asChild className="bg-accent hover:bg-accent/90 text-white">
            <Link href="/categories/new">
              <Plus size={16} className="mr-1" />
              เพิ่มหมวดหมู่
            </Link>
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-white divide-y divide-border">
        {categories && categories.length > 0 ? (
          categories.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <span className="font-medium text-sidebar">{cat.name}</span>
              {canManage && (
                <div className="flex gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/categories/${cat.id}/edit`}>แก้ไข</Link>
                  </Button>
                  <form action={deleteCategory}>
                    <input type="hidden" name="id" value={cat.id} />
                    <DeleteButton message={`ลบหมวดหมู่ "${cat.name}"?`} />
                  </form>
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="px-4 py-8 text-center text-muted-foreground">
            ยังไม่มีหมวดหมู่
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: สร้าง src/app/(shell)/categories/new/page.tsx**

```tsx
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createCategory } from "@/app/actions/categories";
import { CategoryForm } from "@/components/categories/category-form";

export default async function NewCategoryPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") {
    redirect("/categories");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">เพิ่มหมวดหมู่ใหม่</h1>
        <p className="text-sm text-muted-foreground mt-1">
          กรอกชื่อหมวดหมู่สินค้าที่ต้องการเพิ่ม
        </p>
      </div>
      <CategoryForm action={createCategory} />
    </div>
  );
}
```

- [ ] **Step 5: สร้าง src/app/(shell)/categories/[id]/edit/page.tsx**

```tsx
import { notFound, redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { updateCategory } from "@/app/actions/categories";
import { CategoryForm } from "@/components/categories/category-form";

export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") {
    redirect("/categories");
  }

  const supabase = await createClient();
  const { data: category } = await supabase
    .from("categories")
    .select("id, name")
    .eq("id", id)
    .single();

  if (!category) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">แก้ไขหมวดหมู่</h1>
        <p className="text-sm text-muted-foreground mt-1">{category.name}</p>
      </div>
      <CategoryForm
        action={updateCategory}
        defaultName={category.name}
        id={category.id}
      />
    </div>
  );
}
```

- [ ] **Step 6: TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: ไม่มี error output

- [ ] **Step 7: ทดสอบ Categories CRUD ใน browser**

รัน `npm run dev` แล้วทดสอบ:

1. Login ด้วย manager/owner account → เปิด `/categories` → ควรเห็น "ยังไม่มีหมวดหมู่"
2. คลิก "เพิ่มหมวดหมู่" → กรอก "อาหาร" → คลิก "บันทึก" → ควร redirect กลับ `/categories` พร้อมรายการ
3. คลิก "แก้ไข" → เปลี่ยนชื่อ → คลิก "บันทึก" → ควรอัปเดตในรายการ
4. คลิก "ลบ" → คลิก OK ใน confirm dialog → ควรหายออกจากรายการ
5. ทดสอบ validation: คลิก "เพิ่มหมวดหมู่" → ส่งฟอร์มเปล่า → ควรเห็น error "กรุณากรอกชื่อหมวดหมู่"
6. (ถ้ามี staff account) Login ด้วย staff → `/categories` ควรแสดงรายการ แต่ไม่เห็นปุ่ม เพิ่ม/แก้ไข/ลบ

- [ ] **Step 8: Commit**

```powershell
git add src/app/actions/categories.ts src/components/categories/category-form.tsx "src/app/(shell)/categories"
git commit -m "feat: categories CRUD — server actions + list/new/edit pages"
```

---

### Task 4: Products CRUD

**Files:**
- Create: `src/app/actions/products.ts`
- Create: `src/components/products/product-form.tsx`
- Create: `src/app/(shell)/products/page.tsx`
- Create: `src/app/(shell)/products/new/page.tsx`
- Create: `src/app/(shell)/products/[id]/edit/page.tsx`

**Interfaces:**
- Consumes:
  - `getProfile()`, `ProfileWithTenant` จาก `src/lib/dal.ts`
  - `createClient()` จาก `src/lib/supabase/server.ts`
  - `DeleteButton` จาก `src/components/ui/delete-button.tsx`
  - `Textarea` จาก `src/components/ui/textarea.tsx`
  - `products` + `categories` tables จาก Task 1; DB types จาก Task 2
- Produces:
  - `createProduct(prevState: ProductState, formData: FormData): Promise<ProductState>` — INSERT + redirect("/products")
  - `updateProduct(prevState: ProductState, formData: FormData): Promise<ProductState>` — UPDATE by id + redirect("/products")
  - `deleteProduct(formData: FormData): Promise<void>` — DELETE by id + redirect("/products")
  - `ProductForm({ action, categories, defaults? })` — client form component
  - Pages: `/products` (list), `/products/new`, `/products/[id]/edit`

- [ ] **Step 1: สร้าง src/app/actions/products.ts**

```typescript
"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";

export type ProductState = { error?: string } | undefined;

function isManagerOrOwner(role: string): boolean {
  return role === "owner" || role === "manager";
}

export async function createProduct(
  prevState: ProductState,
  formData: FormData
): Promise<ProductState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const name = formData.get("name");
  const priceRaw = formData.get("price");
  const description = formData.get("description");
  const categoryId = formData.get("category_id");
  const isActive = formData.get("is_active") === "on";

  if (typeof name !== "string" || name.trim() === "") {
    return { error: "กรุณากรอกชื่อสินค้า" };
  }
  const price = typeof priceRaw === "string" ? parseFloat(priceRaw) : NaN;
  if (isNaN(price) || price < 0) {
    return { error: "กรุณากรอกราคาที่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("products").insert({
    name: name.trim(),
    price,
    description:
      typeof description === "string" && description.trim() !== ""
        ? description.trim()
        : null,
    category_id:
      typeof categoryId === "string" && categoryId !== "" ? categoryId : null,
    is_active: isActive,
    tenant_id: profile.tenant_id,
  });

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  redirect("/products");
}

export async function updateProduct(
  prevState: ProductState,
  formData: FormData
): Promise<ProductState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const id = formData.get("id");
  const name = formData.get("name");
  const priceRaw = formData.get("price");
  const description = formData.get("description");
  const categoryId = formData.get("category_id");
  const isActive = formData.get("is_active") === "on";

  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    name.trim() === ""
  ) {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }
  const price = typeof priceRaw === "string" ? parseFloat(priceRaw) : NaN;
  if (isNaN(price) || price < 0) {
    return { error: "กรุณากรอกราคาที่ถูกต้อง" };
  }

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

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  redirect("/products");
}

export async function deleteProduct(formData: FormData): Promise<void> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return;

  const id = formData.get("id");
  if (typeof id !== "string") return;

  const supabase = await createClient();
  await supabase.from("products").delete().eq("id", id);
  redirect("/products");
}
```

- [ ] **Step 2: สร้าง src/components/products/product-form.tsx**

หมายเหตุ: ใช้ native `<select>` (ไม่ใช่ Shadcn Select) เพราะ Shadcn Select ใช้ Radix UI ที่ไม่ส่ง value ผ่าน form action โดยตรง

```tsx
"use client";
import { useActionState } from "react";
import type { ProductState } from "@/app/actions/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Category = { id: string; name: string };

type Defaults = {
  id?: string;
  name?: string;
  price?: number;
  description?: string | null;
  category_id?: string | null;
  is_active?: boolean;
};

type Props = {
  action: (
    prevState: ProductState,
    formData: FormData
  ) => Promise<ProductState>;
  categories: Category[];
  defaults?: Defaults;
};

export function ProductForm({ action, categories, defaults = {} }: Props) {
  const [state, formAction, pending] = useActionState<ProductState, FormData>(
    action,
    undefined
  );
  return (
    <form action={formAction} className="max-w-lg space-y-4">
      {defaults.id !== undefined && (
        <input type="hidden" name="id" value={defaults.id} />
      )}

      <div className="space-y-1.5">
        <Label htmlFor="name">ชื่อสินค้า</Label>
        <Input
          id="name"
          name="name"
          defaultValue={defaults.name ?? ""}
          placeholder="ชื่อสินค้า"
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="price">ราคา (บาท)</Label>
        <Input
          id="price"
          name="price"
          type="number"
          step="0.01"
          min="0"
          defaultValue={defaults.price ?? 0}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="category_id">หมวดหมู่</Label>
        <select
          id="category_id"
          name="category_id"
          defaultValue={defaults.category_id ?? ""}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">— ไม่ระบุ —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">รายละเอียด</Label>
        <Textarea
          id="description"
          name="description"
          defaultValue={defaults.description ?? ""}
          placeholder="รายละเอียดสินค้า (ไม่บังคับ)"
          rows={3}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is_active"
          name="is_active"
          defaultChecked={defaults.is_active ?? true}
          className="h-4 w-4 rounded border-input accent-accent"
        />
        <Label htmlFor="is_active">เปิดใช้งาน</Label>
      </div>

      {state?.error !== undefined && (
        <p className="text-sm font-medium text-danger">{state.error}</p>
      )}

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pending}
          className="bg-accent hover:bg-accent/90 text-white"
        >
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => history.back()}
        >
          ยกเลิก
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: สร้าง src/app/(shell)/products/page.tsx**

หมายเหตุ: ใช้ `as` cast สำหรับ join result type เพราะ Supabase-js type inference กับ nested select อาจไม่ match manual Database type definition

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { deleteProduct } from "@/app/actions/products";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/ui/delete-button";

type ProductRow = {
  id: string;
  name: string;
  price: number;
  is_active: boolean;
  categories: { name: string } | null;
};

export default async function ProductsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const canManage = profile.role === "owner" || profile.role === "manager";

  const supabase = await createClient();
  const { data: products } = (await supabase
    .from("products")
    .select("id, name, price, is_active, categories(name)")
    .order("name")) as { data: ProductRow[] | null };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-sidebar">สินค้า</h1>
          <p className="text-sm text-muted-foreground mt-1">
            จัดการรายการสินค้าทั้งหมด
          </p>
        </div>
        {canManage && (
          <Button asChild className="bg-accent hover:bg-accent/90 text-white">
            <Link href="/products/new">
              <Plus size={16} className="mr-1" />
              เพิ่มสินค้า
            </Link>
          </Button>
        )}
      </div>

      <div className="rounded-lg border bg-white divide-y divide-border">
        {products && products.length > 0 ? (
          products.map((product) => (
            <div
              key={product.id}
              className="flex items-center gap-4 px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sidebar truncate">
                  {product.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {product.categories?.name ?? "ไม่ระบุหมวดหมู่"} ·{" "}
                  ฿{Number(product.price).toFixed(2)}
                </p>
              </div>
              <Badge variant={product.is_active ? "default" : "secondary"}>
                {product.is_active ? "เปิด" : "ปิด"}
              </Badge>
              {canManage && (
                <div className="flex gap-2 shrink-0">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/products/${product.id}/edit`}>แก้ไข</Link>
                  </Button>
                  <form action={deleteProduct}>
                    <input type="hidden" name="id" value={product.id} />
                    <DeleteButton message={`ลบสินค้า "${product.name}"?`} />
                  </form>
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="px-4 py-8 text-center text-muted-foreground">
            ยังไม่มีสินค้า
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: สร้าง src/app/(shell)/products/new/page.tsx**

```tsx
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { createProduct } from "@/app/actions/products";
import { ProductForm } from "@/components/products/product-form";

export default async function NewProductPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") {
    redirect("/products");
  }

  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name")
    .order("name");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">เพิ่มสินค้าใหม่</h1>
        <p className="text-sm text-muted-foreground mt-1">
          กรอกข้อมูลสินค้าที่ต้องการเพิ่ม
        </p>
      </div>
      <ProductForm action={createProduct} categories={categories ?? []} />
    </div>
  );
}
```

- [ ] **Step 5: สร้าง src/app/(shell)/products/[id]/edit/page.tsx**

```tsx
import { notFound, redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { updateProduct } from "@/app/actions/products";
import { ProductForm } from "@/components/products/product-form";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") {
    redirect("/products");
  }

  const supabase = await createClient();
  const [{ data: product }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, price, description, is_active, category_id")
      .eq("id", id)
      .single(),
    supabase.from("categories").select("id, name").order("name"),
  ]);

  if (!product) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">แก้ไขสินค้า</h1>
        <p className="text-sm text-muted-foreground mt-1">{product.name}</p>
      </div>
      <ProductForm
        action={updateProduct}
        categories={categories ?? []}
        defaults={{
          id: product.id,
          name: product.name,
          price: Number(product.price),
          description: product.description,
          category_id: product.category_id,
          is_active: product.is_active,
        }}
      />
    </div>
  );
}
```

- [ ] **Step 6: TypeScript check**

```powershell
npx tsc --noEmit
```

Expected: ไม่มี error output

- [ ] **Step 7: ทดสอบ Products CRUD ใน browser**

1. เปิด `/products` → ควรเห็น "ยังไม่มีสินค้า"
2. คลิก "เพิ่มสินค้า" → กรอก: ชื่อ "กาแฟ", ราคา 50, หมวดหมู่ (เลือกที่สร้างไว้), รายละเอียด (optional) → คลิก "บันทึก" → ควรเห็นในรายการพร้อมราคา "฿50.00"
3. คลิก "แก้ไข" → แก้ไขราคาเป็น 55 → คลิก "บันทึก" → ราคาควรเปลี่ยน
4. สร้างสินค้าที่ 2 โดยไม่เลือกหมวดหมู่ → ควรแสดง "ไม่ระบุหมวดหมู่"
5. Uncheck "เปิดใช้งาน" → บันทึก → badge ควรเปลี่ยนเป็น "ปิด" (secondary)
6. คลิก "ลบ" → ยืนยัน → ควรหายออกจากรายการ
7. ทดสอบ validation: submit ฟอร์มเปล่า → ควรเห็น browser required validation หรือ error message

- [ ] **Step 8: Commit + Push**

```powershell
git add src/app/actions/products.ts src/components/products/product-form.tsx "src/app/(shell)/products"
git commit -m "feat: products CRUD — server actions + list/new/edit pages"
git push origin main
```

---

## Self-Review

**1. Spec coverage:**
- ✅ ตาราง `categories` พร้อม `tenant_id` + RLS 4 policies (Task 1)
- ✅ ตาราง `products` พร้อม `tenant_id` + RLS 4 policies (Task 1)
- ✅ UI จัดการหมวดหมู่: เพิ่ม/แก้ไข/ลบ (Task 3)
- ✅ UI จัดการสินค้า: ชื่อ, ราคา, หมวดหมู่ พร้อม Server Actions (Task 4)
- ✅ Role-based access: manager+ เท่านั้น create/update/delete ได้ (ทุก action + pages)

**2. Placeholder scan:** ทุก step มีโค้ดครบ ไม่มี "TBD", "TODO", หรือ "implement later"

**3. Type consistency:**
- `CategoryState = { error?: string } | undefined` — defined in `categories.ts`, used in `CategoryForm` props ✅
- `ProductState = { error?: string } | undefined` — defined in `products.ts`, used in `ProductForm` props ✅
- `Category = { id: string; name: string }` — used consistently in `ProductForm` + all product pages ✅
- `params: Promise<{ id: string }>` — ใช้ใน `EditCategoryPage` + `EditProductPage` ทั้งคู่ ✅
- `isManagerOrOwner(role: string): boolean` — defined inline ใน `categories.ts` + `products.ts` (ไม่ import cross-file เพื่อหลีกเลี่ยง dependency ที่ไม่จำเป็น) ✅
