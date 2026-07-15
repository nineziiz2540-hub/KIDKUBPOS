# KIDKUBPOS — Menu + Toast Code Translation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this spec into a task-by-task implementation plan, then superpowers:subagent-driven-development or superpowers:executing-plans to execute it.

**Goal:** Translate the two Figma v2 round-2 components (`docs/superpowers/specs/2026-07-15-figma-design-system-v2-round2-menus-notifications-design.md` — Menu, Toast) into real code, and wire each into exactly one concrete, real call site: the Products table's row actions, and the Product create/edit form's error and success feedback.

**Architecture:** Both new UI primitives wrap `@base-ui/react` sub-packages already installed (`@base-ui/react/menu`, `@base-ui/react/toast`) — the same wrapping pattern already used by `Button`, `Input`, and `Switch` in this codebase. No new dependencies. Icons use the app's existing `lucide-react` set (`Pencil`, `Trash2`), not the Figma hand-drawn vectors, per the established Figma→code icon convention from v2 round 1.

**Tech Stack:** Next.js 16, `@base-ui/react` (`menu`, `toast` sub-packages), `lucide-react`, existing Server Actions / `useActionState` pattern.

## Global Constraints

- No new npm dependencies — `@base-ui/react@^1.6.0` (already installed) ships both `menu` and `toast` sub-packages, confirmed via `node_modules/@base-ui/react/{menu,toast}`.
- **Resolved Code≠Figma conflict — which "red" to use:** the codebase has two distinct destructive reds: `--color-destructive` (shadcn's oklch red-orange, actually wired into `Button`'s destructive variant, `Badge`'s destructive variant, and `Input`'s `aria-invalid` border — the app's real, live destructive convention) and `--color-danger` (`#f43f5e`, a pink-red brand token that numerically matches the Figma file's `color/danger` variable exactly, but is not referenced by any component in the codebase today — confirmed via grep). The Figma design in this round used `color/danger` simply because that was the token available in the Foundations page; user decision: **code uses `--color-destructive`** (the `text-destructive`/`bg-destructive` Tailwind utilities) for Menu's "ลบ" item and Toast's Error variant, for visual consistency with every other destructive UI element already shipped, not the Figma file's literal token name. `--color-success` (`#00b87a`) has no equivalent live conflict — the few existing ad-hoc `text-green-600` success messages (`business-settings-form.tsx` etc.) are raw Tailwind green, never elevated to a token, so adopting the real `--color-success` brand token for the new Toast is not a regression against an established convention.
- Brand tokens only — `--color-success`/`--color-destructive` (see conflict note above); the Toast tint styling reuses the exact convention already established in `badge.tsx` (`bg-<semantic>/10` + `text-<semantic>`, not a solid fill).
- Icons: `lucide-react` (`Pencil` for edit, `Trash2` for delete) — not the hand-built Figma vectors.
- Scope is deliberately narrow, matching this project's established practice of wiring new primitives into exactly the call sites decided by the user, not a wide rollout:
  - **Menu:** Products table only. Inventory table (4 actions: รับสินค้า/ปรับ/แก้ไข/ลบ) does not match the 2-item Menu design and is explicitly out of scope this round.
  - **Toast:** `product-form.tsx` only (covers both `createProduct` and `updateProduct`, which share this component) — error feedback and success feedback. No other form in the codebase is touched.

## Components

### 1. Menu — `src/components/ui/menu.tsx` (new)

A generic, reusable primitive (not hard-coded to the Products row use case) wrapping `@base-ui/react/menu`:

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

function MenuItem({ className, destructive, ...props }: MenuPrimitive.Item.Props & { destructive?: boolean }) {
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

**Notes:**
- `MenuLinkItem` (from `@base-ui/react/menu`'s `link-item` part) renders as an anchor, so "แก้ไข" navigates via the existing `href={`/products/${id}/edit`}` pattern already used elsewhere — no new navigation mechanism.
- The divider uses the same raw `#E5E5E5` gray as the Figma design (no `color/border` token exists in code either — matches the existing unbound-gray convention already used for `border-input` etc.).
- Radius `rounded-lg` and `shadow-lg` reuse the exact utility classes already generated by the `globals.css` `@theme` block from the earlier design-system round — no new tokens.

### 2. Toast — `src/components/ui/toast.tsx` (new)

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

**Import-path note (verified against the installed package):** `@base-ui/react/toast`'s package root only exports the `Toast` namespace object (`export { Toast } from "./index.parts.js"`, confirmed via `node_modules/@base-ui/react/toast/index.js`) — there is no bare top-level `useToastManager` export to re-export directly. `Toast.useToastManager` (i.e. `ToastPrimitive.useToastManager`) is the real runtime value; assign it to a local `const` and export that, as shown above.

**Notes:**
- `bg-success`/`text-success` and `bg-destructive`/`text-destructive` are the app's existing Tailwind color utilities (from `--color-success`/`--color-destructive` in `globals.css`) — same tint convention as `badge.tsx`'s `destructive` variant (`bg-destructive/10` + `text-destructive`).
- Only `Success` and `Error` types are styled (matching the Figma design's 2 variants). `toast.type` on any other value falls through to the `else` branch (success styling) — acceptable since this round only ever calls `.add()` with `type: "success"` or `type: "error"`.
- Default `timeout` (5000ms per Base UI's default) is used as-is — matches the "auto-dismiss" decision from the Figma round, no manual close button rendered.

### 3. Mount the Toast provider — `src/app/layout.tsx` (modify)

```tsx
import { ToastProvider, Toaster } from "@/components/ui/toast";
// ...existing imports...

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full">
        <ToastProvider>
          {children}
          <Toaster />
        </ToastProvider>
      </body>
    </html>
  );
}
```

`RootLayout` stays a Server Component — `ToastProvider`/`Toaster` are Client Components (`"use client"` internally), which Next.js allows rendering as children of a Server Component without converting the parent.

### 4. Wire Menu into Products table — `src/app/(shell)/products/page.tsx` (modify)

Replace the existing inline "แก้ไข"/"ลบ" `<Link>`/`<form>` pair (current lines 77-90) with a single Menu trigger:

```tsx
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Menu, MenuTrigger, MenuPopup, MenuItem, MenuLinkItem, MenuSeparator } from "@/components/ui/menu";
// ...
{canManage && (
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
            document.getElementById(`delete-form-${product.id}`)?.requestSubmit();
          }
        }}
      >
        <Trash2 size={14} /> ลบ
      </MenuItem>
    </MenuPopup>
  </Menu>
)}
<form id={`delete-form-${product.id}`} action={deleteProduct} className="hidden">
  <input type="hidden" name="id" value={product.id} />
</form>
```

The hidden `<form>` keeps the exact same `deleteProduct` Server Action call and `id` payload as today's `DeleteButton`-based row — only the trigger UI changes (menu item instead of a visible destructive button), the actual delete mechanism (confirm + form POST) is unchanged. `DeleteButton` itself (`src/components/ui/delete-button.tsx`) is untouched as a file — it's still used elsewhere (Inventory, Modifiers) and continues to work exactly as before. Its import line in `products/page.tsx` (`import { DeleteButton } from "@/components/ui/delete-button";`) must be **removed**, since this page no longer renders it — an unused import would otherwise fail the build's lint step.

### 5. Toast wiring in Products create/edit flow

**5a. Error — `src/components/products/product-form.tsx` (modify):**

```tsx
import { useEffect } from "react";
import { useToastManager } from "@/components/ui/toast";
// ...
export function ProductForm({ action, categories, defaults = {} }: Props) {
  const [state, formAction, pending] = useActionState<ProductState, FormData>(action, undefined);
  const toastManager = useToastManager();

  useEffect(() => {
    if (state?.error) {
      toastManager.add({ title: state.error, type: "error" });
    }
  }, [state?.error, toastManager]);

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      {/* ...unchanged fields... */}
      {/* the existing `{state?.error !== undefined && <p>...}` block (current lines 119-121) is removed — the toast replaces it */}
      {/* ...rest unchanged... */}
    </form>
  );
}
```

**5b. Success — `src/app/actions/products.ts` (modify, 2 one-line changes):**

- Line 55 (`createProduct`): `redirect("/products");` → `redirect("/products?saved=1");`
- Line 110 (`updateProduct`): `redirect("/products");` → `redirect("/products?saved=1");`

**5c. Success — `src/app/(shell)/products/page.tsx` (modify):** add `searchParams` prop (matching the existing `Promise<{...}>` pattern already used in `inventory/page.tsx`) and render a tiny client trigger component when `saved=1` is present:

```tsx
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;
  // ...existing profile/products fetch unchanged...
  return (
    <div className="space-y-6">
      {saved === "1" && <SavedToastTrigger />}
      {/* ...existing JSX unchanged... */}
    </div>
  );
}
```

**New file — `src/components/products/saved-toast-trigger.tsx`:**

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

This fires exactly once per page load that includes `?saved=1` — it does not attempt to strip the query param from the URL afterward (out of scope; a page refresh while `?saved=1` is still in the address bar would re-fire the toast, an acceptable edge case not worth the added complexity of a `router.replace()` call for this first wiring).

## Explicitly Out of Scope (this round)

- Inventory table's 4-action row — stays as visible inline links/buttons, not converted to a Menu (design mismatch, see Global Constraints).
- Toast wiring in any other form (Inventory, Modifiers, Categories, Settings, etc.) — only `product-form.tsx` + the Products page's save-success path are wired this round.
- Stripping `?saved=1` from the URL after the toast fires (see note above).
- The remaining 6 iOS/iPadOS 26 Figma categories (Pickers, Toolbars, Widgets, Page controls, Context Menus) — still deferred, a future round.
- `MenuCheckboxItem`/`MenuRadioItem` or any other `@base-ui/react/menu` sub-part not needed for this 2-item, no-selection-state menu.

## Testing

No test framework exists in this project (confirmed in earlier rounds). Verification is:
- `npx tsc --noEmit` — must be clean.
- `npm run build` — must be clean.
- Live browser QA via the running `npm run dev` preview: open Products, confirm the `⋮` menu opens/closes, "แก้ไข" navigates correctly, "ลบ" still confirms + deletes correctly; trigger a validation error (e.g. empty name) and confirm the error toast appears (and the old inline error text is gone); save a valid edit and confirm the success toast appears after redirect back to `/products`.

## Next Step

Hand off to `superpowers:writing-plans` to produce a task-by-task implementation plan, then execute via `superpowers:subagent-driven-development` (matching the workflow already used for the round-1 design system code translation), with a live `npm run dev` preview open throughout per the user's standing preference.
