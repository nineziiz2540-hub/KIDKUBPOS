# Menu + Toast Code Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Translate the Figma v2 round-2 Menu and Toast components into real code: a reusable `Menu` primitive wired into the Products table's row actions, and a reusable `Toast` primitive wired into `product-form.tsx`'s error and success feedback.

**Architecture:** Two new `src/components/ui/` primitives, each wrapping an already-installed `@base-ui/react` sub-package (`menu`, `toast`) the same way `Button`/`Input`/`Switch` already wrap their base-ui primitives. No new dependencies.

**Tech Stack:** Next.js 16, `@base-ui/react@^1.6.0` (`menu`, `toast` sub-packages), `lucide-react`, existing Server Actions / `useActionState` pattern.

## Global Constraints

- No new npm dependencies.
- Menu's destructive item and Toast's Error variant use `text-destructive`/`bg-destructive` (the app's real, already-shipped destructive color used by `Button`/`Badge`/`Input`) — **not** `--color-danger`, even though `--color-danger` is what numerically matches the Figma file's `color/danger` token. This was an explicit user decision after a Code≠Figma conflict was found: `--color-danger` (`#f43f5e`) is unused anywhere else in the app today.
- Toast's Success variant uses `text-success`/`bg-success` (`--color-success`, `#00b87a`) — no conflict here, safe to introduce.
- Icons: `lucide-react` (`Pencil`, `Trash2`, `MoreVertical`, `Check`, `X`) — not the Figma hand-drawn vectors.
- Menu wiring is Products table only. Toast wiring is `product-form.tsx` (covers both `createProduct` and `updateProduct`) only. No other form or table in the codebase is touched.
- No test framework exists in this project. Verification per task: `npx tsc --noEmit` (must be clean) plus live-browser QA via the running `npm run dev` preview, per this project's established convention.

---

### Task 1: Menu component + wire into Products table

**Files:**
- Create: `src/components/ui/menu.tsx`
- Modify: `src/app/(shell)/products/page.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (first task).
- Produces: `Menu`, `MenuTrigger`, `MenuPopup`, `MenuItem` (props: standard `@base-ui/react/menu` `Item` props + optional `destructive?: boolean`), `MenuLinkItem` (props: standard `Item` props + `href: string`), `MenuSeparator` — all exported from `src/components/ui/menu.tsx`. Task 2 does not consume these (Toast is independent), but any future menu use case would.

- [ ] **Step 1: Create `src/components/ui/menu.tsx`**

```tsx
"use client"

import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { cn } from "@/lib/utils"

const Menu = MenuPrimitive.Root
const MenuTrigger = MenuPrimitive.Trigger

function MenuPopup({ className, ...props }: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner sideOffset={4} align="end">
        <MenuPrimitive.Popup
          className={cn(
            "min-w-[168px] rounded-lg bg-white p-1 shadow-lg outline-none",
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function MenuItem({
  className,
  destructive,
  ...props
}: MenuPrimitive.Item.Props & { destructive?: boolean }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium outline-none cursor-pointer data-[highlighted]:bg-muted/50",
        destructive ? "text-destructive" : "text-sidebar",
        className
      )}
      {...props}
    />
  )
}

function MenuLinkItem({ className, ...props }: MenuPrimitive.LinkItem.Props) {
  return (
    <MenuPrimitive.LinkItem
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium text-sidebar outline-none cursor-pointer data-[highlighted]:bg-muted/50",
        className
      )}
      {...props}
    />
  )
}

function MenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      className={cn("my-1 h-px bg-[#E5E5E5]", className)}
      {...props}
    />
  )
}

export { Menu, MenuTrigger, MenuPopup, MenuItem, MenuLinkItem, MenuSeparator }
```

- [ ] **Step 2: Run `npx tsc --noEmit` to confirm the new file compiles cleanly**

Expected: no errors referencing `menu.tsx`. (Errors elsewhere unrelated to this file mean stop and investigate — the codebase is expected to be clean before this task starts.)

- [ ] **Step 3: Wire into `src/app/(shell)/products/page.tsx`**

In the imports section, replace:

```tsx
import { DeleteButton } from "@/components/ui/delete-button";
```

with:

```tsx
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuLinkItem, MenuSeparator } from "@/components/ui/menu";
```

(`deleteProduct` and `Badge` imports stay unchanged — both are still used.)

Then replace the existing action buttons block (currently):

```tsx
                {canManage && (
                  <div className="flex gap-2 shrink-0">
                    <Link
                      href={`/products/${product.id}/edit`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      แก้ไข
                    </Link>
                    <form action={deleteProduct}>
                      <input type="hidden" name="id" value={product.id} />
                      <DeleteButton message={`ลบสินค้า "${product.name}"?`} />
                    </form>
                  </div>
                )}
```

with:

```tsx
                {canManage && (
                  <>
                    <Menu>
                      <MenuTrigger className="rounded p-1.5 text-muted-foreground hover:bg-muted/20">
                        <MoreVertical size={16} />
                      </MenuTrigger>
                      <MenuPopup>
                        <MenuLinkItem href={`/products/${product.id}/edit`}>
                          <Pencil size={14} /> แก้ไข
                        </MenuLinkItem>
                        <MenuSeparator />
                        <MenuItem
                          destructive
                          onClick={() => {
                            if (confirm(`ลบสินค้า "${product.name}"?`)) {
                              (document.getElementById(`delete-form-${product.id}`) as HTMLFormElement | null)?.requestSubmit();
                            }
                          }}
                        >
                          <Trash2 size={14} /> ลบ
                        </MenuItem>
                      </MenuPopup>
                    </Menu>
                    <form id={`delete-form-${product.id}`} action={deleteProduct} className="hidden">
                      <input type="hidden" name="id" value={product.id} />
                    </form>
                  </>
                )}
```

Keep the `buttonVariants` and `Link` imports as-is — both are still used elsewhere in this same file (the "+ เพิ่มสินค้า" link near the top of the page uses both). Only `DeleteButton`'s import is removed (already done above); the edit link's old `buttonVariants({ variant: "outline", size: "sm" })` usage is gone along with the `<Link>` it was applied to, but that's the only usage being removed, not the imports themselves.

- [ ] **Step 4: Run `npx tsc --noEmit` again to confirm the wiring compiles cleanly**

Expected: no errors. Specifically confirm no "declared but never used" error for any import in `products/page.tsx`.

- [ ] **Step 5: Live-verify in the browser (dev server already running)**

Navigate to `/products`, confirm: the `⋮` trigger appears in place of the old "แก้ไข"/"ลบ" buttons; clicking it opens a popup with "แก้ไข" (pencil icon) and "ลบ" (trash icon, red) separated by a divider; "แก้ไข" navigates to the edit page; "ลบ" shows the same `confirm()` dialog as before and, on confirming, deletes the product exactly as before.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/menu.tsx src/app/\(shell\)/products/page.tsx
git commit -m "feat(design-system): add Menu component, wire into Products row actions"
```

---

### Task 2: Toast component + mount provider + wire into product-form.tsx

**Files:**
- Create: `src/components/ui/toast.tsx`
- Create: `src/components/products/saved-toast-trigger.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/products/product-form.tsx`
- Modify: `src/app/actions/products.ts`
- Modify: `src/app/(shell)/products/page.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 (Menu and Toast are independent primitives). Modifies `products/page.tsx` again, after Task 1 — sequential, no conflict (different section of the file: Task 1 touched the row actions cell, this task touches the page function signature and top-level JSX).
- Produces: `ToastProvider`, `Toaster`, `useToastManager` exported from `src/components/ui/toast.tsx`.

- [ ] **Step 1: Create `src/components/ui/toast.tsx`**

```tsx
"use client"

import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"

const ToastProvider = ToastPrimitive.Provider

function Toaster() {
  const { toasts } = ToastPrimitive.useToastManager()
  return (
    <ToastPrimitive.Portal>
      <ToastPrimitive.Viewport className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <ToastPrimitive.Root
            key={toast.id}
            toast={toast}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-3 shadow-lg",
              toast.type === "error"
                ? "bg-destructive/10 text-destructive"
                : "bg-success/10 text-success"
            )}
          >
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-white",
                toast.type === "error" ? "bg-destructive" : "bg-success"
              )}
            >
              {toast.type === "error" ? <X size={12} /> : <Check size={12} />}
            </span>
            <ToastPrimitive.Title className="text-sm font-medium" />
          </ToastPrimitive.Root>
        ))}
      </ToastPrimitive.Viewport>
    </ToastPrimitive.Portal>
  )
}

export { ToastProvider, Toaster }
export const useToastManager = ToastPrimitive.useToastManager
```

(`@base-ui/react/toast`'s package root exports only the `Toast` namespace — there is no bare top-level `useToastManager` to re-export directly, so it's assigned from `ToastPrimitive.useToastManager` and exported as a local `const`, as above. Do not write `export { useToastManager } from "@base-ui/react/toast"` — that import does not exist.)

- [ ] **Step 2: Run `npx tsc --noEmit` to confirm the new file compiles cleanly**

Expected: no errors referencing `toast.tsx`.

- [ ] **Step 3: Mount the provider in `src/app/layout.tsx`**

Add the import:

```tsx
import { ToastProvider, Toaster } from "@/components/ui/toast";
```

Change the `<body>` content from:

```tsx
      <body className="h-full">{children}</body>
```

to:

```tsx
      <body className="h-full">
        <ToastProvider>
          {children}
          <Toaster />
        </ToastProvider>
      </body>
```

`RootLayout` stays a Server Component — `ToastProvider`/`Toaster` are Client Components internally, which Next.js allows rendering as children of a Server Component without converting the parent to `"use client"`.

- [ ] **Step 4: Run `npx tsc --noEmit` and `npm run build` to confirm the root layout change is clean**

Expected: both clean. `npm run build` specifically because this changes a file rendered on every route — a mistake here would surface as a build-wide failure, not just a type error.

- [ ] **Step 5: Wire the error toast into `src/components/products/product-form.tsx`**

Add imports:

```tsx
import { useEffect } from "react";
import { useToastManager } from "@/components/ui/toast";
```

Inside `ProductForm`, after the existing `useActionState` line, add:

```tsx
  const toastManager = useToastManager();

  useEffect(() => {
    if (state?.error) {
      toastManager.add({ title: state.error, type: "error" });
    }
  }, [state?.error, toastManager]);
```

Remove the existing inline error block:

```tsx
      {state?.error !== undefined && (
        <p className="text-sm font-medium text-destructive">{state.error}</p>
      )}
```

- [ ] **Step 6: Change the success redirect target in `src/app/actions/products.ts`**

Two one-line changes:
- In `createProduct`: `redirect("/products");` → `redirect("/products?saved=1");`
- In `updateProduct`: `redirect("/products");` → `redirect("/products?saved=1");`

(`deleteProduct`'s `redirect("/products");` is unchanged — no success toast is wired for delete in this round.)

- [ ] **Step 7: Create `src/components/products/saved-toast-trigger.tsx`**

```tsx
"use client";
import { useEffect } from "react";
import { useToastManager } from "@/components/ui/toast";

export function SavedToastTrigger() {
  const toastManager = useToastManager();
  useEffect(() => {
    toastManager.add({ title: "บันทึกสำเร็จ", type: "success" });
  }, [toastManager]);
  return null;
}
```

- [ ] **Step 8: Wire into `src/app/(shell)/products/page.tsx`**

Add the import:

```tsx
import { SavedToastTrigger } from "@/components/products/saved-toast-trigger";
```

Change the function signature from:

```tsx
export default async function ProductsPage() {
```

to:

```tsx
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
```

Add, right after the `canManage` calculation and before the `return`:

```tsx
  const { saved } = await searchParams;
```

In the returned JSX, add as the first child of the outermost `<div className="space-y-6">`:

```tsx
      {saved === "1" && <SavedToastTrigger />}
```

- [ ] **Step 9: Run `npx tsc --noEmit` to confirm all changes compile cleanly**

Expected: no errors across `product-form.tsx`, `products.ts`, `products/page.tsx`, `saved-toast-trigger.tsx`.

- [ ] **Step 10: Run `npm run build` for a full production-build check**

Expected: clean build, no runtime warnings about the new Client Component boundaries.

- [ ] **Step 11: Live-verify in the browser (dev server already running)**

- Open `/products/new`, submit with an empty name — confirm a red toast appears at the bottom of the screen with the error message, and the old inline red text under the form is gone.
- Submit a valid product — confirm redirect to `/products?saved=1` and a green "บันทึกสำเร็จ" toast appears.
- Edit an existing product and save — confirm the same green toast appears after redirect.

- [ ] **Step 12: Commit**

```bash
git add src/components/ui/toast.tsx src/components/products/saved-toast-trigger.tsx src/app/layout.tsx src/components/products/product-form.tsx src/app/actions/products.ts src/app/\(shell\)/products/page.tsx
git commit -m "feat(design-system): add Toast component, wire into product-form error/success feedback"
```

---

## Explicitly Out of Scope (this round)

- Inventory table's Menu conversion (4 actions don't match the 2-item design).
- Toast wiring in any form besides `product-form.tsx`.
- Stripping `?saved=1` from the URL after the toast fires.
- The remaining 6 iOS/iPadOS 26 Figma categories (Pickers, Toolbars, Widgets, Page controls, Context Menus).
