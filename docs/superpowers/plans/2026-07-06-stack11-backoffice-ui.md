# Stack 11 — Back-Office UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the owner/manager-facing management screens: `/inventory`, `/modifiers`, enhanced `/products/[id]/edit` (with tabs for Recipe + Modifiers + image upload), and `/settings` (with business settings fields).

**Architecture:** All pages are Next.js App Router Server Components. Actions already exist from Stack 10 — this stack is UI-only (no new server action logic). Inline action state uses URL searchParams (`?action=X&id=Y`) for clean server-first rendering. Tab state uses URL searchParams (`?tab=X`) so tabs are shareable links.

**Tech Stack:** Next.js 16 App Router, Supabase SSR, TypeScript strict, shadcn/ui components (`Button`, `Input`, `Label`, `Textarea`, `Badge`, `DeleteButton`), Lucide icons.

## Global Constraints

- Multi-tenant: all pages call `getProfile()` → check auth → scope queries to `profile.tenant_id`
- `getProfile()` (not `getSession()`) in all auth checks
- TypeScript strict + noUncheckedIndexedAccess: `npx tsc --noEmit` = zero errors after each task
- No `.env.local` committed. Supabase keys in Vercel dashboard only.
- Owner-only pages: `/settings` — redirect non-owners to `/`
- Manager-or-owner pages: `/inventory`, `/modifiers`, `/products/[id]/edit` (existing role check)
- IMPORTANT: Read `node_modules/next/dist/docs/` for App Router conventions before writing pages. `params` and `searchParams` are both `Promise<T>` in this version — always `await` them.
- Server actions come from Stack 10 (already written, do NOT rewrite them). Import from their existing paths.
- Color/style follow existing pages: headings `text-sidebar`, accents `text-accent`, cards `rounded-lg border bg-white p-5`

---

## File Map

```
New files:
  src/app/(shell)/inventory/page.tsx
  src/app/(shell)/modifiers/page.tsx
  src/components/inventory/raw-material-form.tsx
  src/components/inventory/stock-action-form.tsx
  src/components/modifiers/modifier-form.tsx
  src/components/modifiers/modifier-option-form.tsx
  src/components/modifiers/modifier-card.tsx
  src/components/products/recipe-tab.tsx
  src/components/products/modifiers-tab.tsx
  src/components/products/image-upload-section.tsx
  src/components/settings/business-settings-form.tsx

Modified files:
  src/lib/dal.ts               — add getModifiers(tenantId)
  src/components/shell/sidebar.tsx — add Inventory + Modifiers nav items
  src/app/(shell)/products/[id]/edit/page.tsx — tab layout + new data fetches
  src/components/products/product-form.tsx    — add drink_type field
  src/app/actions/settings.ts  — add updateBusinessSettings
  src/app/(shell)/settings/page.tsx           — add business settings card
```

---

### Task 1: Inventory Page (`/inventory`)

**Files:**
- Create: `src/app/(shell)/inventory/page.tsx`
- Create: `src/components/inventory/raw-material-form.tsx`
- Create: `src/components/inventory/stock-action-form.tsx`
- Modify: `src/lib/dal.ts` — add `getModifiers` DAL function (needed for Task 2, but add here for single DAL commit)
- Modify: `src/components/shell/sidebar.tsx` — add Inventory nav item (minRole: "manager")

**Interfaces:**
- Consumes: `getRawMaterials(tenantId)` from `@/lib/dal` (exists from Stack 10)
- Consumes: `createRawMaterial`, `updateRawMaterial`, `deleteRawMaterial`, `receiveStock`, `adjustStock` from `@/app/actions/inventory` (all exist from Stack 10)
- Consumes: `RawMaterial` type from `@/lib/dal`
- Produces: `/inventory` route, `RawMaterialForm` and `StockActionForm` components used only in this task

**Verification:** `npx tsc --noEmit` — zero errors

- [ ] **Step 1: Add `getModifiers` to `src/lib/dal.ts`**

Add this function after the `getRawMaterials` function (around line 204):

```typescript
export async function getModifiers(tenantId: string): Promise<ModifierWithOptions[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("modifiers")
    .select(
      `id, name, is_required, is_multi_select, sort_order,
       modifier_options(id, name, price_delta, sort_order)`
    )
    .eq("tenant_id", tenantId)
    .order("sort_order");

  if (!data) return [];

  type ModRow = {
    id: string;
    name: string;
    is_required: boolean;
    is_multi_select: boolean;
    sort_order: number | null;
    modifier_options: Array<{
      id: string;
      name: string;
      price_delta: number | null;
      sort_order: number | null;
    }>;
  };

  return (data as ModRow[]).map((m) => ({
    id: m.id,
    name: m.name,
    isRequired: m.is_required,
    isMultiSelect: m.is_multi_select,
    sortOrder: m.sort_order ?? 0,
    options: (m.modifier_options ?? [])
      .map((o) => ({
        id: o.id,
        name: o.name,
        priceDelta: Number(o.price_delta ?? 0),
        sortOrder: o.sort_order ?? 0,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
  }));
}
```

- [ ] **Step 2: Update sidebar with Inventory and Modifiers links**

In `src/components/shell/sidebar.tsx`, add two new nav items to `allNavItems` array. Import `FlaskConical` and `Sliders` from lucide-react (add to existing import). Insert after the `categories` entry:

```typescript
import {
  LayoutDashboard,
  CreditCard,
  ShoppingBag,
  Package,
  Tag,
  FlaskConical,
  Sliders,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";

// In allNavItems array, insert after the categories item:
{ href: "/inventory", label: "Inventory", icon: FlaskConical, minRole: "manager" },
{ href: "/modifiers", label: "Modifiers", icon: Sliders, minRole: "manager" },
```

- [ ] **Step 3: Create `src/components/inventory/raw-material-form.tsx`**

```typescript
"use client";
import { useActionState } from "react";
import Link from "next/link";
import type { InventoryState } from "@/app/actions/inventory";
import type { RawMaterial } from "@/lib/dal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  action: (prevState: InventoryState, formData: FormData) => Promise<InventoryState>;
  defaults?: RawMaterial;
};

export function RawMaterialForm({ action, defaults }: Props) {
  const [state, formAction, pending] = useActionState<InventoryState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="space-y-4 max-w-lg">
      {defaults?.id && <input type="hidden" name="id" value={defaults.id} />}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5 col-span-2 sm:col-span-1">
          <Label htmlFor="rm-name">ชื่อวัตถุดิบ</Label>
          <Input
            id="rm-name"
            name="name"
            defaultValue={defaults?.name ?? ""}
            placeholder="เช่น นมสด, กาแฟ"
            required
          />
        </div>
        <div className="space-y-1.5 col-span-2 sm:col-span-1">
          <Label htmlFor="rm-unit">หน่วย</Label>
          <Input
            id="rm-unit"
            name="unit"
            defaultValue={defaults?.unit ?? ""}
            placeholder="เช่น มล., กรัม, ชิ้น"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rm-cost">ต้นทุน / หน่วย (บาท)</Label>
          <Input
            id="rm-cost"
            name="cost_per_unit"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={defaults?.cost_per_unit ?? 0}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rm-min">แจ้งเตือนเมื่อสต็อก ≤</Label>
          <Input
            id="rm-min"
            name="min_stock_alert"
            type="number"
            step="0.001"
            min="0"
            defaultValue={defaults?.min_stock_alert ?? 0}
          />
        </div>
      </div>

      {state?.error && (
        <p className="text-sm font-medium text-destructive">{state.error}</p>
      )}

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pending}
          className="bg-accent hover:bg-accent/90 text-white"
        >
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/inventory">ยกเลิก</Link>
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Create `src/components/inventory/stock-action-form.tsx`**

```typescript
"use client";
import { useActionState } from "react";
import Link from "next/link";
import type { InventoryState } from "@/app/actions/inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  action: (prevState: InventoryState, formData: FormData) => Promise<InventoryState>;
  rawMaterialId: string;
  type: "receive" | "adjust";
  materialName: string;
  currentStock: number;
  unit: string;
};

export function StockActionForm({ action, rawMaterialId, type, materialName, currentStock, unit }: Props) {
  const [state, formAction, pending] = useActionState<InventoryState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="space-y-4 max-w-lg">
      <input type="hidden" name="raw_material_id" value={rawMaterialId} />
      <p className="text-sm text-muted-foreground">
        สต็อกปัจจุบัน: <span className="font-semibold text-foreground">{currentStock} {unit}</span>
      </p>

      {type === "receive" ? (
        <div className="space-y-1.5">
          <Label htmlFor="sa-qty">จำนวนที่รับเพิ่ม ({unit})</Label>
          <Input
            id="sa-qty"
            name="quantity"
            type="number"
            step="0.001"
            min="0.001"
            placeholder="0"
            required
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="sa-new">สต็อกใหม่ ({unit})</Label>
          <Input
            id="sa-new"
            name="new_stock"
            type="number"
            step="0.001"
            min="0"
            defaultValue={currentStock}
            required
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="sa-note">หมายเหตุ (ไม่บังคับ)</Label>
        <Textarea id="sa-note" name="note" placeholder="เหตุผลที่ปรับสต็อก…" rows={2} />
      </div>

      {state?.error && (
        <p className="text-sm font-medium text-destructive">{state.error}</p>
      )}

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pending}
          className="bg-accent hover:bg-accent/90 text-white"
        >
          {pending ? "กำลังบันทึก…" : type === "receive" ? "รับสินค้า" : "ปรับสต็อก"}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/inventory">ยกเลิก</Link>
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: Create `src/app/(shell)/inventory/page.tsx`**

```typescript
import Link from "next/link";
import { redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { getProfile, getRawMaterials } from "@/lib/dal";
import {
  createRawMaterial,
  updateRawMaterial,
  deleteRawMaterial,
  receiveStock,
  adjustStock,
} from "@/app/actions/inventory";
import { RawMaterialForm } from "@/components/inventory/raw-material-form";
import { StockActionForm } from "@/components/inventory/stock-action-form";
import { DeleteButton } from "@/components/ui/delete-button";
import { Badge } from "@/components/ui/badge";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; id?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");

  const { action, id } = await searchParams;
  const materials = await getRawMaterials(profile.tenant_id);

  const editTarget =
    action === "edit" && id
      ? (materials.find((m) => m.id === id) ?? null)
      : null;
  const stockTarget =
    (action === "receive" || action === "adjust") && id
      ? (materials.find((m) => m.id === id) ?? null)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-sidebar flex items-center gap-2">
            <FlaskConical size={24} />
            วัตถุดิบ
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            จัดการวัตถุดิบและสต็อก
          </p>
        </div>
        {action !== "new" && (
          <Link
            href="/inventory?action=new"
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            + เพิ่มวัตถุดิบ
          </Link>
        )}
      </div>

      {/* Create form */}
      {action === "new" && (
        <div className="rounded-lg border bg-white p-5 space-y-4">
          <h2 className="text-base font-semibold text-sidebar">เพิ่มวัตถุดิบใหม่</h2>
          <RawMaterialForm action={createRawMaterial} />
        </div>
      )}

      {/* Edit form */}
      {editTarget && (
        <div className="rounded-lg border bg-white p-5 space-y-4">
          <h2 className="text-base font-semibold text-sidebar">
            แก้ไข: {editTarget.name}
          </h2>
          <RawMaterialForm action={updateRawMaterial} defaults={editTarget} />
        </div>
      )}

      {/* Stock action form */}
      {stockTarget && (
        <div className="rounded-lg border bg-white p-5 space-y-4">
          <h2 className="text-base font-semibold text-sidebar">
            {action === "receive" ? "รับสินค้าเข้าสต็อก" : "ปรับสต็อก"}: {stockTarget.name}
          </h2>
          <StockActionForm
            action={action === "receive" ? receiveStock : adjustStock}
            rawMaterialId={stockTarget.id}
            type={action as "receive" | "adjust"}
            materialName={stockTarget.name}
            currentStock={Number(stockTarget.current_stock)}
            unit={stockTarget.unit}
          />
        </div>
      )}

      {/* Materials table */}
      <div className="rounded-lg border bg-white overflow-hidden">
        {materials.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            ยังไม่มีวัตถุดิบ — กด "เพิ่มวัตถุดิบ" เพื่อเริ่มต้น
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-sidebar">ชื่อ</th>
                <th className="text-left px-4 py-3 font-medium text-sidebar">หน่วย</th>
                <th className="text-right px-4 py-3 font-medium text-sidebar">ต้นทุน/หน่วย</th>
                <th className="text-right px-4 py-3 font-medium text-sidebar">สต็อก</th>
                <th className="text-right px-4 py-3 font-medium text-sidebar">แจ้งเตือน ≤</th>
                <th className="text-right px-4 py-3 font-medium text-sidebar">การดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {materials.map((m) => {
                const isLow =
                  Number(m.min_stock_alert) > 0 &&
                  Number(m.current_stock) <= Number(m.min_stock_alert);
                return (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-muted/10">
                    <td className="px-4 py-3 font-medium">
                      {m.name}
                      {isLow && (
                        <Badge variant="destructive" className="ml-2 text-xs">
                          สต็อกต่ำ
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{m.unit}</td>
                    <td className="px-4 py-3 text-right">{Number(m.cost_per_unit).toFixed(4)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{Number(m.current_stock).toFixed(3)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{Number(m.min_stock_alert).toFixed(3)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/inventory?action=receive&id=${m.id}`}
                          className="rounded px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10"
                        >
                          รับสินค้า
                        </Link>
                        <Link
                          href={`/inventory?action=adjust&id=${m.id}`}
                          className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/20"
                        >
                          ปรับ
                        </Link>
                        <Link
                          href={`/inventory?action=edit&id=${m.id}`}
                          className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/20"
                        >
                          แก้ไข
                        </Link>
                        <form action={deleteRawMaterial}>
                          <input type="hidden" name="id" value={m.id} />
                          <DeleteButton message={`ลบ "${m.name}"?`} />
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors. Fix any type errors before proceeding.

- [ ] **Step 7: Commit**

```bash
git add src/app/(shell)/inventory/page.tsx \
        src/components/inventory/raw-material-form.tsx \
        src/components/inventory/stock-action-form.tsx \
        src/components/shell/sidebar.tsx \
        src/lib/dal.ts
git commit -m "feat(inventory): add /inventory page with CRUD, receive & adjust stock"
```

---

### Task 2: Modifiers Page (`/modifiers`)

**Files:**
- Create: `src/app/(shell)/modifiers/page.tsx`
- Create: `src/components/modifiers/modifier-form.tsx`
- Create: `src/components/modifiers/modifier-option-form.tsx`
- Create: `src/components/modifiers/modifier-card.tsx`

**Interfaces:**
- Consumes: `getModifiers(tenantId)` from `@/lib/dal` (added in Task 1)
- Consumes: `ModifierWithOptions` type from `@/types/app`
- Consumes: `createModifier`, `updateModifier`, `deleteModifier`, `createModifierOption`, `deleteModifierOption` from `@/app/actions/modifiers` (all exist from Stack 10)
- Produces: `/modifiers` route with modifier group + option CRUD

**Verification:** `npx tsc --noEmit` — zero errors

- [ ] **Step 1: Create `src/components/modifiers/modifier-form.tsx`**

```typescript
"use client";
import { useActionState } from "react";
import Link from "next/link";
import type { ModifierState } from "@/app/actions/modifiers";
import type { ModifierWithOptions } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  action: (prevState: ModifierState, formData: FormData) => Promise<ModifierState>;
  defaults?: Pick<ModifierWithOptions, "id" | "name" | "isRequired" | "isMultiSelect" | "sortOrder">;
};

export function ModifierForm({ action, defaults }: Props) {
  const [state, formAction, pending] = useActionState<ModifierState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="space-y-4 max-w-lg">
      {defaults?.id && <input type="hidden" name="id" value={defaults.id} />}

      <div className="space-y-1.5">
        <Label htmlFor="mod-name">ชื่อกลุ่มตัวเลือก</Label>
        <Input
          id="mod-name"
          name="name"
          defaultValue={defaults?.name ?? ""}
          placeholder="เช่น ความหวาน, ท็อปปิ้ง"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="mod-order">ลำดับ</Label>
          <Input
            id="mod-order"
            name="sort_order"
            type="number"
            min="0"
            defaultValue={defaults?.sortOrder ?? 0}
          />
        </div>
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="mod-required"
              name="is_required"
              defaultChecked={defaults?.isRequired ?? false}
              className="h-4 w-4 rounded border-input accent-accent"
            />
            <Label htmlFor="mod-required">บังคับเลือก</Label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="mod-multi"
              name="is_multi_select"
              defaultChecked={defaults?.isMultiSelect ?? false}
              className="h-4 w-4 rounded border-input accent-accent"
            />
            <Label htmlFor="mod-multi">เลือกได้หลายตัวเลือก</Label>
          </div>
        </div>
      </div>

      {state?.error && (
        <p className="text-sm font-medium text-destructive">{state.error}</p>
      )}

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pending}
          className="bg-accent hover:bg-accent/90 text-white"
        >
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/modifiers">ยกเลิก</Link>
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Create `src/components/modifiers/modifier-option-form.tsx`**

```typescript
"use client";
import { useActionState } from "react";
import type { ModifierState } from "@/app/actions/modifiers";
import { createModifierOption } from "@/app/actions/modifiers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = { modifierId: string };

export function ModifierOptionForm({ modifierId }: Props) {
  const [state, formAction, pending] = useActionState<ModifierState, FormData>(
    createModifierOption,
    undefined
  );

  return (
    <form action={formAction} className="flex items-end gap-2 flex-wrap">
      <input type="hidden" name="modifier_id" value={modifierId} />

      <div className="space-y-1 min-w-[120px]">
        <Label htmlFor={`opt-name-${modifierId}`} className="text-xs">ชื่อตัวเลือก</Label>
        <Input
          id={`opt-name-${modifierId}`}
          name="name"
          placeholder="เช่น 50%, ไข่มุก"
          className="h-8 text-sm"
          required
        />
      </div>
      <div className="space-y-1 w-[100px]">
        <Label htmlFor={`opt-price-${modifierId}`} className="text-xs">ราคา +/- (บาท)</Label>
        <Input
          id={`opt-price-${modifierId}`}
          name="price_delta"
          type="number"
          step="0.01"
          defaultValue={0}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1 w-[70px]">
        <Label htmlFor={`opt-order-${modifierId}`} className="text-xs">ลำดับ</Label>
        <Input
          id={`opt-order-${modifierId}`}
          name="sort_order"
          type="number"
          min="0"
          defaultValue={0}
          className="h-8 text-sm"
        />
      </div>

      <Button
        type="submit"
        disabled={pending}
        size="sm"
        className="bg-accent hover:bg-accent/90 text-white"
      >
        {pending ? "…" : "+ เพิ่ม"}
      </Button>

      {state?.error && (
        <p className="text-sm font-medium text-destructive w-full">{state.error}</p>
      )}
    </form>
  );
}
```

- [ ] **Step 3: Create `src/components/modifiers/modifier-card.tsx`**

```typescript
import Link from "next/link";
import { deleteModifier, deleteModifierOption } from "@/app/actions/modifiers";
import type { ModifierWithOptions } from "@/types/app";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/ui/delete-button";
import { ModifierOptionForm } from "./modifier-option-form";

type Props = {
  modifier: ModifierWithOptions;
  isEditing: boolean;
};

export function ModifierCard({ modifier, isEditing }: Props) {
  return (
    <div className="rounded-lg border bg-white p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-sidebar">{modifier.name}</h3>
            {modifier.isRequired && (
              <Badge variant="destructive" className="text-xs">บังคับ</Badge>
            )}
            {modifier.isMultiSelect && (
              <Badge className="text-xs bg-blue-100 text-blue-700">เลือกได้หลายตัว</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            ลำดับ: {modifier.sortOrder} · {modifier.options.length} ตัวเลือก
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Link
            href={`/modifiers?action=edit&id=${modifier.id}`}
            className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/20"
          >
            แก้ไข
          </Link>
          <form action={deleteModifier}>
            <input type="hidden" name="id" value={modifier.id} />
            <DeleteButton message={`ลบกลุ่ม "${modifier.name}" และตัวเลือกทั้งหมด?`} />
          </form>
        </div>
      </div>

      {/* Options list */}
      {modifier.options.length > 0 && (
        <div className="rounded-md border divide-y text-sm">
          {modifier.options.map((opt) => (
            <div key={opt.id} className="flex items-center justify-between px-3 py-2">
              <span>
                {opt.name}
                {opt.priceDelta !== 0 && (
                  <span className="ml-1 text-muted-foreground">
                    ({opt.priceDelta > 0 ? "+" : ""}{opt.priceDelta} บาท)
                  </span>
                )}
              </span>
              <form action={deleteModifierOption}>
                <input type="hidden" name="id" value={opt.id} />
                <DeleteButton message={`ลบตัวเลือก "${opt.name}"?`} />
              </form>
            </div>
          ))}
        </div>
      )}

      {/* Add option form */}
      <div className="pt-1 border-t">
        <p className="text-xs font-medium text-muted-foreground mb-2">+ เพิ่มตัวเลือก</p>
        <ModifierOptionForm modifierId={modifier.id} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/app/(shell)/modifiers/page.tsx`**

```typescript
import Link from "next/link";
import { redirect } from "next/navigation";
import { Sliders } from "lucide-react";
import { getProfile, getModifiers } from "@/lib/dal";
import { createModifier, updateModifier } from "@/app/actions/modifiers";
import { ModifierForm } from "@/components/modifiers/modifier-form";
import { ModifierCard } from "@/components/modifiers/modifier-card";

export default async function ModifiersPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; id?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");

  const { action, id } = await searchParams;
  const modifiers = await getModifiers(profile.tenant_id);

  const editTarget =
    action === "edit" && id
      ? (modifiers.find((m) => m.id === id) ?? null)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-sidebar flex items-center gap-2">
            <Sliders size={24} />
            ตัวเลือกเพิ่มเติม (Modifiers)
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            จัดการกลุ่มตัวเลือกสำหรับสินค้า เช่น ความหวาน, ท็อปปิ้ง
          </p>
        </div>
        {action !== "new" && (
          <Link
            href="/modifiers?action=new"
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90"
          >
            + เพิ่มกลุ่มตัวเลือก
          </Link>
        )}
      </div>

      {/* Create form */}
      {action === "new" && (
        <div className="rounded-lg border bg-white p-5 space-y-4">
          <h2 className="text-base font-semibold text-sidebar">เพิ่มกลุ่มตัวเลือกใหม่</h2>
          <ModifierForm action={createModifier} />
        </div>
      )}

      {/* Edit form */}
      {editTarget && (
        <div className="rounded-lg border bg-white p-5 space-y-4">
          <h2 className="text-base font-semibold text-sidebar">แก้ไข: {editTarget.name}</h2>
          <ModifierForm action={updateModifier} defaults={editTarget} />
        </div>
      )}

      {/* Modifier cards */}
      {modifiers.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-muted-foreground">
          ยังไม่มีกลุ่มตัวเลือก — กด "เพิ่มกลุ่มตัวเลือก" เพื่อเริ่มต้น
        </div>
      ) : (
        <div className="grid gap-4">
          {modifiers.map((mod) => (
            <ModifierCard
              key={mod.id}
              modifier={mod}
              isEditing={editTarget?.id === mod.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/(shell)/modifiers/page.tsx \
        src/components/modifiers/modifier-form.tsx \
        src/components/modifiers/modifier-option-form.tsx \
        src/components/modifiers/modifier-card.tsx
git commit -m "feat(modifiers): add /modifiers page with group and option CRUD"
```

---

### Task 3: Product Edit Enhancement

**Files:**
- Modify: `src/app/(shell)/products/[id]/edit/page.tsx` — add `searchParams`, tab navigation, conditional data fetching per tab
- Modify: `src/components/products/product-form.tsx` — add `drink_type` select field
- Create: `src/components/products/recipe-tab.tsx`
- Create: `src/components/products/modifiers-tab.tsx`
- Create: `src/components/products/image-upload-section.tsx`

**Interfaces:**
- Consumes: `getRawMaterials(tenantId)`, `getModifiers(tenantId)`, `getModifiersForProduct(productId)` from `@/lib/dal`
- Consumes: `updateProductRecipes`, `updateProductModifiers`, `uploadProductImage` from `@/app/actions/products` (all exist from Stack 10)
- Produces: tabbed product edit page (tabs: info | recipe | modifiers)

**Verification:** `npx tsc --noEmit` — zero errors

- [ ] **Step 1: Modify `src/components/products/product-form.tsx` — add `drink_type` field**

After the `category_id` select block and before the `description` textarea, insert:

```typescript
<div className="space-y-1.5">
  <Label htmlFor="drink_type">ประเภทเครื่องดื่ม</Label>
  <select
    id="drink_type"
    name="drink_type"
    defaultValue={defaults.drink_type ?? ""}
    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
  >
    <option value="">— ไม่ใช่เครื่องดื่ม —</option>
    <option value="hot">ร้อน</option>
    <option value="iced">เย็น</option>
    <option value="blended">ปั่น</option>
    <option value="special">Special</option>
  </select>
</div>
```

Also update the `Defaults` type in the file to add `drink_type`:

```typescript
type Defaults = {
  id?: string;
  name?: string;
  price?: number;
  description?: string | null;
  category_id?: string | null;
  drink_type?: string | null;
  is_active?: boolean;
};
```

- [ ] **Step 2: Create `src/components/products/image-upload-section.tsx`**

```typescript
"use client";
import { useTransition, useState } from "react";
import Image from "next/image";
import { uploadProductImage } from "@/app/actions/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  productId: string;
  currentImageUrl?: string | null;
};

export function ImageUploadSection({ productId, currentImageUrl }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl ?? null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    formData.append("product_id", productId);

    startTransition(async () => {
      const result = await uploadProductImage(formData);
      if ("error" in result) {
        setError(result.error);
      } else {
        setPreviewUrl(result.url);
        // Reload to reflect the saved URL on the product
        window.location.reload();
      }
    });
  }

  return (
    <div className="space-y-3">
      <Label>รูปภาพสินค้า</Label>
      {previewUrl && (
        <div className="w-32 h-32 rounded-lg border overflow-hidden">
          <Image
            src={previewUrl}
            alt="รูปสินค้า"
            width={128}
            height={128}
            className="w-full h-full object-cover"
          />
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="img-file" className="text-xs text-muted-foreground">
            อัปโหลดรูปใหม่ (สูงสุด 5MB)
          </Label>
          <Input
            id="img-file"
            name="image"
            type="file"
            accept="image/*"
            className="w-auto text-sm"
            required
          />
        </div>
        <Button
          type="submit"
          disabled={isPending}
          variant="outline"
          size="sm"
        >
          {isPending ? "กำลังอัปโหลด…" : "อัปโหลด"}
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
```

Note: `uploadProductImage` in `products.ts` only uses the `image` field from FormData — it does not save `image_url` back to the `products` table. After a successful upload, the user must manually note the URL, or we patch `products.image_url` in the action. Since the action only returns `{ url }` and does NOT update `products.image_url`, after upload we call `window.location.reload()` to let the server show the new URL (it won't show unless we save it). Therefore, add the following to the upload handler BEFORE returning the URL in `uploadProductImage`:

The implementer must also update `uploadProductImage` in `src/app/actions/products.ts` to save `image_url` back to the `products` table. After `getPublicUrl`, add:

```typescript
// Save image_url back to the product (product_id is optional FormData field)
const productId = formData.get("product_id");
if (typeof productId === "string" && productId !== "") {
  await supabase
    .from("products")
    .update({ image_url: urlData.publicUrl })
    .eq("id", productId)
    .eq("tenant_id", profile.tenant_id);
  revalidatePath(`/products/${productId}/edit`);
}

return { url: urlData.publicUrl };
```

- [ ] **Step 3: Create `src/components/products/recipe-tab.tsx`**

This is a client component that handles dynamic recipe rows.

```typescript
"use client";
import { useState, useTransition } from "react";
import { updateProductRecipes } from "@/app/actions/products";
import type { RawMaterial } from "@/lib/dal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type RecipeRow = { raw_material_id: string; quantity_used: string };

type Props = {
  productId: string;
  rawMaterials: RawMaterial[];
  initialRows: RecipeRow[];
};

export function RecipeTab({ productId, rawMaterials, initialRows }: Props) {
  const [rows, setRows] = useState<RecipeRow[]>(
    initialRows.length > 0 ? initialRows : [{ raw_material_id: "", quantity_used: "" }]
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function addRow() {
    setRows((prev) => [...prev, { raw_material_id: "", quantity_used: "" }]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRow(index: number, field: keyof RecipeRow, value: string) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r))
    );
  }

  function handleSave() {
    setError(null);
    setSaved(false);
    const formData = new FormData();
    formData.append("product_id", productId);
    for (const row of rows) {
      if (row.raw_material_id && row.quantity_used) {
        formData.append("raw_material_id", row.raw_material_id);
        formData.append("quantity_used", row.quantity_used);
      }
    }
    startTransition(async () => {
      await updateProductRecipes(formData);
      setSaved(true);
    });
  }

  // Cost preview
  const totalCost = rows.reduce((sum, row) => {
    const mat = rawMaterials.find((m) => m.id === row.raw_material_id);
    if (!mat) return sum;
    const qty = parseFloat(row.quantity_used);
    if (isNaN(qty)) return sum;
    return sum + Number(mat.cost_per_unit) * qty;
  }, 0);

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        กำหนดวัตถุดิบที่ใช้ในเมนูนี้ ระบบจะหักสต็อกอัตโนมัติเมื่อมีคำสั่งซื้อ
      </p>

      {/* Recipe rows */}
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={row.raw_material_id}
              onChange={(e) => updateRow(i, "raw_material_id", e.target.value)}
              className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              <option value="">— เลือกวัตถุดิบ —</option>
              {rawMaterials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.unit})
                </option>
              ))}
            </select>
            <Input
              type="number"
              step="0.001"
              min="0.001"
              placeholder="ปริมาณ"
              value={row.quantity_used}
              onChange={(e) => updateRow(i, "quantity_used", e.target.value)}
              className="w-28"
            />
            <span className="text-xs text-muted-foreground w-8">
              {rawMaterials.find((m) => m.id === row.raw_material_id)?.unit ?? ""}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => removeRow(i)}
              className="shrink-0"
            >
              ลบ
            </Button>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        + เพิ่มวัตถุดิบ
      </Button>

      {/* Cost preview */}
      {totalCost > 0 && (
        <div className="rounded-md bg-muted/30 px-4 py-2 text-sm">
          ต้นทุนวัตถุดิบรวม: <span className="font-semibold">{totalCost.toFixed(2)} บาท</span>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-green-600">บันทึกสูตรเรียบร้อยแล้ว</p>}

      <Button
        onClick={handleSave}
        disabled={isPending}
        className="bg-accent hover:bg-accent/90 text-white"
      >
        {isPending ? "กำลังบันทึก…" : "บันทึกสูตร"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/components/products/modifiers-tab.tsx`**

```typescript
"use client";
import { useState, useTransition } from "react";
import { updateProductModifiers } from "@/app/actions/products";
import type { ModifierWithOptions } from "@/types/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Props = {
  productId: string;
  allModifiers: ModifierWithOptions[];
  linkedModifierIds: string[];
};

export function ModifiersTab({ productId, allModifiers, linkedModifierIds }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(linkedModifierIds));
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function toggle(modifierId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modifierId)) next.delete(modifierId);
      else next.add(modifierId);
      return next;
    });
    setSaved(false);
  }

  function handleSave() {
    const formData = new FormData();
    formData.append("product_id", productId);
    for (const id of selected) {
      formData.append("modifier_id", id);
    }
    startTransition(async () => {
      await updateProductModifiers(formData);
      setSaved(true);
    });
  }

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-muted-foreground">
        เลือกกลุ่มตัวเลือกที่ต้องการให้แสดงเมื่อลูกค้าสั่งเมนูนี้
      </p>

      {allModifiers.length === 0 ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground text-center">
          ยังไม่มีกลุ่มตัวเลือก —{" "}
          <a href="/modifiers" className="text-accent hover:underline">
            ไปสร้างที่ Modifiers
          </a>
        </div>
      ) : (
        <div className="space-y-2">
          {allModifiers.map((mod) => (
            <label
              key={mod.id}
              className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                selected.has(mod.id)
                  ? "border-accent bg-accent/5"
                  : "hover:bg-muted/10"
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(mod.id)}
                onChange={() => toggle(mod.id)}
                className="mt-0.5 h-4 w-4 rounded border-input accent-accent"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{mod.name}</span>
                  {mod.isRequired && (
                    <Badge variant="destructive" className="text-xs">บังคับ</Badge>
                  )}
                  {mod.isMultiSelect && (
                    <Badge className="text-xs bg-blue-100 text-blue-700">หลายตัวเลือก</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {mod.options.map((o) => o.name).join(", ")}
                </p>
              </div>
            </label>
          ))}
        </div>
      )}

      {saved && <p className="text-sm text-green-600">บันทึกตัวเลือกเรียบร้อยแล้ว</p>}

      <Button
        onClick={handleSave}
        disabled={isPending}
        className="bg-accent hover:bg-accent/90 text-white"
      >
        {isPending ? "กำลังบันทึก…" : "บันทึกตัวเลือก"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Rewrite `src/app/(shell)/products/[id]/edit/page.tsx`**

Replace the entire file:

```typescript
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getProfile, getRawMaterials, getModifiers, getModifiersForProduct } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { updateProduct } from "@/app/actions/products";
import { ProductForm } from "@/components/products/product-form";
import { RecipeTab } from "@/components/products/recipe-tab";
import { ModifiersTab } from "@/components/products/modifiers-tab";
import { ImageUploadSection } from "@/components/products/image-upload-section";

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab = "info" } = await searchParams;

  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") {
    redirect("/products");
  }

  const supabase = await createClient();
  const [{ data: product }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, price, description, is_active, category_id, image_url, drink_type")
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id)
      .single(),
    supabase
      .from("categories")
      .select("id, name")
      .eq("tenant_id", profile.tenant_id)
      .order("name"),
  ]);

  if (!product) notFound();

  // Fetch tab-specific data
  const [rawMaterials, allModifiers, existingRecipesResult, linkedModifiersResult] =
    await Promise.all([
      tab === "recipe" ? getRawMaterials(profile.tenant_id) : Promise.resolve([]),
      tab === "modifiers" ? getModifiers(profile.tenant_id) : Promise.resolve([]),
      tab === "recipe"
        ? supabase
            .from("product_recipes")
            .select("raw_material_id, quantity_used")
            .eq("product_id", id)
            .eq("tenant_id", profile.tenant_id)
        : Promise.resolve({ data: null }),
      tab === "modifiers" ? getModifiersForProduct(id) : Promise.resolve([]),
    ]);

  const existingRecipes = (existingRecipesResult?.data ?? []) as {
    raw_material_id: string;
    quantity_used: number;
  }[];
  const linkedModifierIds = (linkedModifiersResult as { id: string }[]).map(
    (m) => m.id
  );

  const tabs = [
    { key: "info", label: "ข้อมูลทั่วไป" },
    { key: "recipe", label: "สูตรอาหาร" },
    { key: "modifiers", label: "ตัวเลือกเพิ่มเติม" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">แก้ไขสินค้า</h1>
        <p className="text-sm text-muted-foreground mt-1">{product.name}</p>
      </div>

      {/* Tab navigation */}
      <div className="flex border-b gap-0">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/products/${id}/edit?tab=${t.key}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-accent text-accent"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* Tab content */}
      {tab === "info" && (
        <div className="space-y-6">
          <ProductForm
            action={updateProduct}
            categories={categories ?? []}
            defaults={{
              id: product.id,
              name: product.name,
              price: Number(product.price),
              description: product.description,
              category_id: product.category_id,
              drink_type: product.drink_type,
              is_active: product.is_active,
            }}
          />
          <div className="rounded-lg border bg-white p-5 max-w-lg">
            <h2 className="text-base font-semibold text-sidebar mb-4">รูปภาพสินค้า</h2>
            <ImageUploadSection productId={id} currentImageUrl={product.image_url} />
          </div>
        </div>
      )}

      {tab === "recipe" && (
        <RecipeTab
          productId={id}
          rawMaterials={rawMaterials}
          initialRows={existingRecipes.map((r) => ({
            raw_material_id: r.raw_material_id,
            quantity_used: String(r.quantity_used),
          }))}
        />
      )}

      {tab === "modifiers" && (
        <ModifiersTab
          productId={id}
          allModifiers={allModifiers}
          linkedModifierIds={linkedModifierIds}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors. Common issues to watch for:
- `getModifiers` added in Task 1 is imported correctly from `@/lib/dal`
- `product.drink_type` is typed as `string | null` in the DB types — pass it as `string | null | undefined`
- `linkedModifiersResult` from `getModifiersForProduct` returns `ModifierWithOptions[]` — map with `.map((m) => m.id)` works correctly
- `existingRecipesResult` might be `{ data: null }` when tab !== "recipe" — handle with `?? []`

- [ ] **Step 7: Commit**

```bash
git add src/app/(shell)/products/[id]/edit/page.tsx \
        src/components/products/product-form.tsx \
        src/components/products/recipe-tab.tsx \
        src/components/products/modifiers-tab.tsx \
        src/components/products/image-upload-section.tsx \
        src/app/actions/products.ts
git commit -m "feat(products): add Recipe/Modifiers tabs and image upload to product edit"
```

---

### Task 4: Settings Enhancement

**Files:**
- Modify: `src/app/actions/settings.ts` — add `updateBusinessSettings`
- Create: `src/components/settings/business-settings-form.tsx`
- Modify: `src/app/(shell)/settings/page.tsx` — add business settings card

**Interfaces:**
- Consumes: `SettingsState` type from `@/app/actions/settings` (exists)
- Produces: `/settings` page with new "ตั้งค่าธุรกิจ" card showing fixed_cost_monthly, delivery_gp_percent, order_prefix fields

**Verification:** `npx tsc --noEmit` — zero errors

- [ ] **Step 1: Add `updateBusinessSettings` to `src/app/actions/settings.ts`**

Append to the file after the existing `updateMemberRole` function:

```typescript
export async function updateBusinessSettings(
  prevState: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const fixedCostRaw = formData.get("fixed_cost_monthly");
  const gpPercentRaw = formData.get("delivery_gp_percent");
  const orderPrefix = formData.get("order_prefix");

  const fixedCost =
    typeof fixedCostRaw === "string" ? parseFloat(fixedCostRaw) : NaN;
  if (isNaN(fixedCost) || fixedCost < 0) {
    return { error: "กรุณากรอกต้นทุนคงที่ที่ถูกต้อง (>= 0)" };
  }

  const gpPercent =
    typeof gpPercentRaw === "string" ? parseFloat(gpPercentRaw) : NaN;
  if (isNaN(gpPercent) || gpPercent < 0 || gpPercent > 100) {
    return { error: "กรุณากรอก GP% ที่ถูกต้อง (0–100)" };
  }

  if (typeof orderPrefix !== "string" || orderPrefix.trim() === "") {
    return { error: "กรุณากรอก Order Prefix" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tenants")
    .update({
      fixed_cost_monthly: fixedCost,
      delivery_gp_percent: gpPercent,
      order_prefix: orderPrefix.trim().toUpperCase(),
    })
    .eq("id", profile.tenant_id);

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/settings");
  return { success: true };
}
```

- [ ] **Step 2: Create `src/components/settings/business-settings-form.tsx`**

```typescript
"use client";
import { useActionState } from "react";
import type { SettingsState } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BusinessDefaults = {
  fixedCostMonthly: number;
  deliveryGpPercent: number;
  orderPrefix: string;
};

type Props = {
  action: (prevState: SettingsState, formData: FormData) => Promise<SettingsState>;
  defaults: BusinessDefaults;
};

export function BusinessSettingsForm({ action, defaults }: Props) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="bs-fixed">ต้นทุนคงที่ต่อเดือน (บาท)</Label>
          <Input
            id="bs-fixed"
            name="fixed_cost_monthly"
            type="number"
            step="0.01"
            min="0"
            defaultValue={defaults.fixedCostMonthly}
          />
          <p className="text-xs text-muted-foreground">ค่าเช่า, เงินเดือน ฯลฯ</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bs-gp">GP% สำหรับ Delivery</Label>
          <Input
            id="bs-gp"
            name="delivery_gp_percent"
            type="number"
            step="0.01"
            min="0"
            max="100"
            defaultValue={defaults.deliveryGpPercent}
          />
          <p className="text-xs text-muted-foreground">ใช้คำนวณราคา Delivery ใน Pricing Calculator</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bs-prefix">Order Prefix</Label>
          <Input
            id="bs-prefix"
            name="order_prefix"
            defaultValue={defaults.orderPrefix}
            placeholder="KK"
            maxLength={5}
          />
          <p className="text-xs text-muted-foreground">ตัวอักษรนำหน้าเลขออเดอร์ เช่น KK → KK.001</p>
        </div>
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

- [ ] **Step 3: Update `src/app/(shell)/settings/page.tsx`**

Fetch full tenant data and add the business settings card. Replace the entire file:

```typescript
import Link from "next/link";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { updateStoreName, updateBusinessSettings } from "@/app/actions/settings";
import { StoreNameForm } from "@/components/settings/store-name-form";
import { BusinessSettingsForm } from "@/components/settings/business-settings-form";

export default async function SettingsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner") redirect("/");

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, fixed_cost_monthly, delivery_gp_percent, order_prefix")
    .eq("id", profile.tenant_id)
    .single();

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">ตั้งค่าร้านค้า</h1>
        <p className="text-sm text-muted-foreground mt-0.5">จัดการข้อมูลร้านของคุณ</p>
      </div>

      {/* Store name */}
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-sidebar">ข้อมูลร้านค้า</h2>
        <StoreNameForm action={updateStoreName} defaultName={tenant?.name ?? profile.tenants.name} />
      </div>

      {/* Business settings */}
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-sidebar">ตั้งค่าธุรกิจ</h2>
        <BusinessSettingsForm
          action={updateBusinessSettings}
          defaults={{
            fixedCostMonthly: Number(tenant?.fixed_cost_monthly ?? 0),
            deliveryGpPercent: Number(tenant?.delivery_gp_percent ?? 0),
            orderPrefix: tenant?.order_prefix ?? "KK",
          }}
        />
      </div>

      {/* Team */}
      <div className="rounded-lg border bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-sidebar">จัดการทีม</h2>
            <p className="text-sm text-muted-foreground mt-0.5">ดูและแก้ไข Role ของพนักงาน</p>
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

- [ ] **Step 4: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/settings.ts \
        src/components/settings/business-settings-form.tsx \
        src/app/(shell)/settings/page.tsx
git commit -m "feat(settings): add business settings (fixed cost, GP%, order prefix)"
```

---

## Final Build Verification

After all 4 tasks are complete:

- [ ] **Run TypeScript check one final time**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Run build**

```bash
npm run build
```

Expected: build completes with no errors. Ignore warnings about RSC bundle size.

- [ ] **Use superpowers:finishing-a-development-branch to wrap up**
