# Stack 12 — POS Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the basic POS screen with a fully-featured cafe POS: category + drink-type tabs, image product cards, modifier selection modal, and a smart cart with customer lookup, order type, and table number.

**Architecture:** All new components are Client Components that receive pre-fetched data from the Server Component `pos/page.tsx`. Cart state, modal state, order type, customer ID, and checkout all live in `PosScreen` (client). `SmartCart` calls `findOrCreateCustomer` server action directly. `ModifierModal` uses `Dialog` from `@base-ui/react/dialog`. No new server actions or DAL functions are needed — everything was built in Stack 10.

**Tech Stack:** Next.js 16 App Router, Supabase SSR, TypeScript strict, `@base-ui/react` (Dialog, Button), Tailwind CSS

## Global Constraints

- Multi-tenant: every query scoped to `profile.tenant_id` via RLS — never skip tenant check in page.tsx.
- `getProfile()` (which calls `getUser()`, not `getSession()`) for all server-side auth checks.
- TypeScript strict + noUncheckedIndexedAccess: `npx tsc --noEmit` must return zero errors before committing.
- `npm run lint` must return zero errors before committing.
- No `.env.local` committed. Supabase keys stay in Vercel dashboard.
- **`Button` component uses `@base-ui/react` — NO `asChild` prop.** For any link that looks like a button, use a plain `<Link>` styled with Tailwind. `Button` only wraps `ButtonPrimitive` which is `@base-ui/react/button`.
- **`Dialog` API** (`@base-ui/react/dialog`): `Dialog.Root` has `open?: boolean`, `onOpenChange?: (open: boolean, details) => void`. `Dialog.Portal`, `Dialog.Backdrop`, `Dialog.Popup`, `Dialog.Title`, `Dialog.Close` (renders `<button>`, accepts `className`).
- **No `next/image`** for product images — Supabase Storage domain may not be in `next.config`. Use plain `<img>` tags.
- Server Components cannot pass `Map` or `Set` as JSX props (not serializable). Pass `Record<string, string[]>` from page.tsx; convert to `Map`/`Set` inside the client component with `useMemo`.
- No testing framework installed. Verification = `npx tsc --noEmit` + `npm run lint`.
- Commit after each task.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/types/app.ts` | Modify | Add `PosProduct`, `PosCategory` types; add `cartItemKey` to `CartItem` |
| `src/components/pos/pos-header.tsx` | Create | Date display, today's order count, user name |
| `src/components/pos/product-grid.tsx` | Rewrite | Category tabs + drink-type sub-tabs + image product cards |
| `src/components/pos/modifier-modal.tsx` | Create | Modal for selecting modifiers before adding to cart |
| `src/components/pos/smart-cart.tsx` | Create | Cart with customer lookup, order type, table number, payment |
| `src/components/pos/pos-screen.tsx` | Rewrite | Wires all new components; manages all POS state |
| `src/app/(shell)/pos/page.tsx` | Rewrite | Fetches products (new fields), modifier map, modifiers, order count |
| `src/components/pos/cart-panel.tsx` | Delete | Replaced by `smart-cart.tsx` |

---

### Task 1: App Types + PosHeader

**Files:**
- Modify: `src/types/app.ts`
- Create: `src/components/pos/pos-header.tsx`
- Modify: `src/components/pos/pos-screen.tsx` (add `cartItemKey` to the two `CartItem` construction sites)

**Interfaces:**
- Produces: `PosProduct`, `PosCategory` types exported from `@/types/app` — consumed by Tasks 2, 3, 4
- Produces: `CartItem.cartItemKey: string` field — consumed by Tasks 3, 4
- Produces: `PosHeader` component accepting `{ userName: string; todayOrderCount: number }`

- [ ] **Step 1: Add `PosProduct`, `PosCategory` and `cartItemKey` to `src/types/app.ts`**

Append to the end of the existing file. Do NOT replace any existing types:

```typescript
// --- POS display types ---

export type PosProduct = {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
  drink_type: "hot" | "iced" | "blended" | "special" | null;
  category_id: string | null;
  categoryName: string | null;
};

export type PosCategory = {
  id: string;
  name: string;
};
```

Also change the `CartItem` type: add `cartItemKey: string` as the first field:

```typescript
export type CartItem = {
  cartItemKey: string;   // ← ADD THIS LINE
  productId: string;
  name: string;
  basePrice: number;
  quantity: number;
  selectedModifiers: SelectedModifier[];
  totalPrice: number; // (basePrice + sum(priceDelta)) * quantity
};
```

- [ ] **Step 2: Fix `pos-screen.tsx` to include `cartItemKey` in CartItem construction**

`pos-screen.tsx` currently constructs `CartItem` objects in `addToCart`. TypeScript will error because `cartItemKey` is now required. Open `src/components/pos/pos-screen.tsx` and find the object literal that creates a new CartItem (the one with `productId: product.id`). Add `cartItemKey: product.id` as the first field:

```typescript
return [
  ...prev,
  {
    cartItemKey: product.id,   // ← ADD
    productId: product.id,
    name: product.name,
    basePrice: Number(product.price),
    quantity: 1,
    selectedModifiers: [],
    totalPrice: Number(product.price),
  },
];
```

No other changes to `pos-screen.tsx` in this task.

- [ ] **Step 3: Create `src/components/pos/pos-header.tsx`**

```typescript
"use client";

type Props = {
  userName: string;
  todayOrderCount: number;
};

export function PosHeader({ userName, todayOrderCount }: Props) {
  const dateStr = new Date().toLocaleDateString("th-TH", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex items-center justify-between py-1 shrink-0">
      <div>
        <h1 className="text-xl font-bold text-sidebar">POS</h1>
        <p className="text-xs text-muted-foreground mt-0.5">{dateStr}</p>
      </div>
      <div className="text-right text-sm">
        <p className="font-medium text-sidebar">{userName}</p>
        <p className="text-xs text-muted-foreground">
          ออเดอร์วันนี้{" "}
          <span className="font-semibold text-sidebar">{todayOrderCount}</span>{" "}
          รายการ
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript**

```
npx tsc --noEmit
```

Expected: 0 errors. If there are errors about `cartItemKey` missing anywhere else that constructs `CartItem`, add `cartItemKey: <productId>` there too.

- [ ] **Step 5: Lint**

```
npm run lint
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```
git add src/types/app.ts src/components/pos/pos-header.tsx src/components/pos/pos-screen.tsx
git commit -m "feat(pos): add PosProduct/PosCategory types, cartItemKey to CartItem, PosHeader component"
```

---

### Task 2: ProductGrid Revamp (Category Tabs + Image Cards)

**Files:**
- Rewrite: `src/components/pos/product-grid.tsx`

**Interfaces:**
- Consumes: `PosProduct`, `PosCategory` from `@/types/app` (added in Task 1)
- Produces: `ProductGrid` component with props:
  ```typescript
  type Props = {
    products: PosProduct[];
    categories: PosCategory[];
    productsWithModifiers: Set<string>;
    onProductClick: (product: PosProduct) => void;
  };
  ```
- **Note:** `pos-screen.tsx` still imports `ProductGrid` with the old signature — TypeScript will error. Fix this in the same commit by updating the `ProductGrid` usage in `pos-screen.tsx` (Task 4 will fully rewrite pos-screen.tsx, but for now just make the import compile by updating the call site temporarily).

**Implementation note:** The existing `product-grid.tsx` expects `{ id, name, price, categories: {name}|null }[]` and `onAddToCart`. The new version expects `PosProduct[]` and `onProductClick`. These signatures are incompatible — the entire file is a rewrite.

- [ ] **Step 1: Rewrite `src/components/pos/product-grid.tsx`**

```typescript
"use client";
import { useState } from "react";
import type { PosProduct, PosCategory } from "@/types/app";

const DRINK_TYPE_LABELS: Record<string, string> = {
  hot: "ร้อน",
  iced: "เย็น",
  blended: "ปั่น",
  special: "พิเศษ",
};

const ALL_DRINK_TYPES = ["hot", "iced", "blended", "special"] as const;

type Props = {
  products: PosProduct[];
  categories: PosCategory[];
  productsWithModifiers: Set<string>;
  onProductClick: (product: PosProduct) => void;
};

export function ProductGrid({
  products,
  categories,
  productsWithModifiers,
  onProductClick,
}: Props) {
  const [activeCategoryId, setActiveCategoryId] = useState<string>("all");
  const [activeDrinkType, setActiveDrinkType] = useState<string>("all");

  const inCategory =
    activeCategoryId === "all"
      ? products
      : products.filter((p) => p.category_id === activeCategoryId);

  const drinkTypesInCategory = new Set(
    inCategory.map((p) => p.drink_type).filter((dt): dt is string => dt !== null)
  );
  const showDrinkTabs = drinkTypesInCategory.size > 0;

  const filtered =
    activeDrinkType === "all"
      ? inCategory
      : inCategory.filter((p) => p.drink_type === activeDrinkType);

  function handleCategoryChange(catId: string) {
    setActiveCategoryId(catId);
    setActiveDrinkType("all");
  }

  function tabCls(active: boolean) {
    return (
      "px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors " +
      (active
        ? "bg-accent text-white"
        : "bg-white border border-border text-muted-foreground hover:border-accent hover:text-accent")
    );
  }

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 shrink-0 [scrollbar-width:none]">
        <button
          type="button"
          className={tabCls(activeCategoryId === "all")}
          onClick={() => handleCategoryChange("all")}
        >
          ทั้งหมด
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={tabCls(activeCategoryId === cat.id)}
            onClick={() => handleCategoryChange(cat.id)}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Drink type sub-tabs */}
      {showDrinkTabs && (
        <div className="flex gap-2 overflow-x-auto pb-1 shrink-0 [scrollbar-width:none]">
          <button
            type="button"
            className={tabCls(activeDrinkType === "all")}
            onClick={() => setActiveDrinkType("all")}
          >
            ทั้งหมด
          </button>
          {ALL_DRINK_TYPES.filter((dt) => drinkTypesInCategory.has(dt)).map(
            (dt) => (
              <button
                key={dt}
                type="button"
                className={tabCls(activeDrinkType === dt)}
                onClick={() => setActiveDrinkType(dt)}
              >
                {DRINK_TYPE_LABELS[dt]}
              </button>
            )
          )}
        </div>
      )}

      {/* Product grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => onProductClick(product)}
              className="text-left rounded-xl border bg-white hover:border-accent hover:shadow-sm transition-all active:scale-95 overflow-hidden"
            >
              {/* Image / fallback */}
              <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-3xl font-bold text-muted-foreground/30 select-none">
                    {product.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="p-2.5">
                <p className="font-medium text-sidebar text-sm leading-tight line-clamp-2">
                  {product.name}
                </p>
                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-accent font-semibold text-sm">
                    ฿{product.price.toFixed(0)}
                  </p>
                  <span className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center text-sm font-bold shrink-0">
                    +
                  </span>
                </div>
                {productsWithModifiers.has(product.id) && (
                  <p className="text-xs text-muted-foreground mt-0.5">ปรับได้</p>
                )}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="col-span-full text-center py-16 text-muted-foreground text-sm">
              ไม่มีสินค้า
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Fix the temporary type mismatch in `pos-screen.tsx`**

`pos-screen.tsx` currently passes old-style `products` to `ProductGrid` and calls `onAddToCart`. Open `src/components/pos/pos-screen.tsx`.

Find the `<ProductGrid ... />` JSX and the `addToCart` function. Replace the entire `ProductGrid` usage block with:

```typescript
// Temporary shim — pos-screen.tsx will be fully rewritten in Task 4.
// For now, just make the TypeScript call site compile with the new ProductGrid signature.
// Pass empty sets/arrays so the component renders without crashing.
<ProductGrid
  products={products.map((p) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    image_url: null,
    drink_type: null,
    category_id: null,
    categoryName: (p.categories as { name: string } | null)?.name ?? null,
  }))}
  categories={[]}
  productsWithModifiers={new Set<string>()}
  onProductClick={(prod) => addToCart(prod)}
/>
```

Also update the `addToCart` function signature to accept `PosProduct | { id: string; name: string; price: number }`:

```typescript
function addToCart(product: { id: string; name: string; price: number }) {
```

This keeps the existing logic working while satisfying TypeScript. Task 4 will completely replace this.

- [ ] **Step 3: Verify TypeScript**

```
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Lint**

```
npm run lint
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```
git add src/components/pos/product-grid.tsx src/components/pos/pos-screen.tsx
git commit -m "feat(pos): rewrite ProductGrid with category tabs, drink-type sub-tabs, image cards"
```

---

### Task 3: ModifierModal

**Files:**
- Create: `src/components/pos/modifier-modal.tsx`

**Interfaces:**
- Consumes: `ModifierWithOptions`, `CartItem`, `SelectedModifier` from `@/types/app`
- Consumes: `PosProduct` from `@/types/app` (added in Task 1)
- Consumes: `Dialog` from `@base-ui/react/dialog`
- Produces: `ModifierModal` component with props:
  ```typescript
  type Props = {
    product: PosProduct;
    modifiers: ModifierWithOptions[];   // only modifiers linked to this product
    onAddToCart: (item: CartItem) => void;
    onClose: () => void;
  };
  ```

**Key behaviours:**
- For each modifier group: if `isMultiSelect = true` → checkboxes; if `isMultiSelect = false` → radio buttons (single select).
- "เพิ่มในตะกร้า" button is disabled until every group where `isRequired = true` has at least one option selected.
- Price preview = `product.price + sum(selected option priceDelta)`.
- On add: build `SelectedModifier[]` from selections, compute `cartItemKey = "${product.id}-${Date.now()}"`, construct `CartItem`, call `onAddToCart(item)`.
- `Dialog.Root` with `open` always true; `onOpenChange` calls `onClose()` when `open` goes false (user presses Escape or clicks backdrop).

- [ ] **Step 1: Create `src/components/pos/modifier-modal.tsx`**

```typescript
"use client";
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import type { CartItem, ModifierWithOptions, PosProduct, SelectedModifier } from "@/types/app";

type Props = {
  product: PosProduct;
  modifiers: ModifierWithOptions[];
  onAddToCart: (item: CartItem) => void;
  onClose: () => void;
};

export function ModifierModal({ product, modifiers, onAddToCart, onClose }: Props) {
  const [selections, setSelections] = useState<Map<string, Set<string>>>(
    () => new Map()
  );

  const isValid = modifiers
    .filter((m) => m.isRequired)
    .every((m) => {
      const sel = selections.get(m.id);
      return sel !== undefined && sel.size > 0;
    });

  const totalDelta = modifiers.flatMap((m) => m.options).reduce((sum, opt) => {
    const modSel = modifiers.find((m) => m.options.some((o) => o.id === opt.id));
    if (!modSel) return sum;
    const sel = selections.get(modSel.id);
    return sel?.has(opt.id) ? sum + opt.priceDelta : sum;
  }, 0);

  const displayPrice = product.price + totalDelta;

  function toggle(modifierId: string, optionId: string, isMultiSelect: boolean) {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(modifierId) ?? []);
      if (isMultiSelect) {
        if (current.has(optionId)) current.delete(optionId);
        else current.add(optionId);
      } else {
        current.clear();
        current.add(optionId);
      }
      next.set(modifierId, current);
      return next;
    });
  }

  function handleAdd() {
    const selectedModifiers: SelectedModifier[] = [];
    for (const modifier of modifiers) {
      const sel = selections.get(modifier.id) ?? new Set<string>();
      for (const optionId of sel) {
        const option = modifier.options.find((o) => o.id === optionId);
        if (option) {
          selectedModifiers.push({
            modifierId: modifier.id,
            modifierName: modifier.name,
            optionId: option.id,
            optionName: option.name,
            priceDelta: option.priceDelta,
          });
        }
      }
    }
    const unitPrice = product.price + totalDelta;
    onAddToCart({
      cartItemKey: `${product.id}-${Date.now()}`,
      productId: product.id,
      name: product.name,
      basePrice: product.price,
      quantity: 1,
      selectedModifiers,
      totalPrice: unitPrice,
    });
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Popup className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="px-5 pt-5 pb-3 border-b shrink-0">
              <Dialog.Title className="font-bold text-sidebar text-lg leading-tight">
                {product.name}
              </Dialog.Title>
              <p className="text-sm text-muted-foreground mt-0.5">
                ฿{product.price.toFixed(0)}
              </p>
            </div>

            {/* Modifier groups */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {modifiers.map((modifier) => (
                <div key={modifier.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-sm text-sidebar">
                      {modifier.name}
                    </span>
                    {modifier.isRequired && (
                      <span className="text-xs bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded-full">
                        จำเป็น
                      </span>
                    )}
                    {modifier.isMultiSelect && (
                      <span className="text-xs text-muted-foreground">
                        (เลือกได้หลายอย่าง)
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {modifier.options.map((option) => {
                      const isSelected =
                        selections.get(modifier.id)?.has(option.id) ?? false;
                      return (
                        <label
                          key={option.id}
                          className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors border ${
                            isSelected
                              ? "border-accent bg-accent/5"
                              : "border-border hover:bg-muted/50"
                          }`}
                        >
                          <input
                            type={modifier.isMultiSelect ? "checkbox" : "radio"}
                            name={`mod-${modifier.id}`}
                            checked={isSelected}
                            onChange={() =>
                              toggle(modifier.id, option.id, modifier.isMultiSelect)
                            }
                            className="sr-only"
                          />
                          {/* Custom indicator */}
                          <span
                            className={`w-4 h-4 shrink-0 border-2 flex items-center justify-center transition-colors ${
                              modifier.isMultiSelect ? "rounded" : "rounded-full"
                            } ${
                              isSelected
                                ? "border-accent bg-accent"
                                : "border-border"
                            }`}
                          >
                            {isSelected && (
                              <span className="w-2 h-2 bg-white rounded-sm" />
                            )}
                          </span>
                          <span className="flex-1 text-sm">{option.name}</span>
                          {option.priceDelta !== 0 && (
                            <span className="text-sm text-muted-foreground tabular-nums">
                              {option.priceDelta > 0 ? "+" : ""}฿
                              {option.priceDelta.toFixed(0)}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t flex gap-3 shrink-0">
              <Dialog.Close className="flex-1 inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted transition-colors">
                ยกเลิก
              </Dialog.Close>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!isValid}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white transition-colors ${
                  isValid
                    ? "bg-accent hover:bg-accent/90 active:scale-95"
                    : "bg-accent/40 cursor-not-allowed"
                }`}
              >
                เพิ่มในตะกร้า • ฿{displayPrice.toFixed(0)}
              </button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Lint**

```
npm run lint
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```
git add src/components/pos/modifier-modal.tsx
git commit -m "feat(pos): add ModifierModal with required-group validation and price preview"
```

---

### Task 4: SmartCart + pos-screen.tsx + page.tsx Full Integration

**Files:**
- Create: `src/components/pos/smart-cart.tsx`
- Rewrite: `src/components/pos/pos-screen.tsx`
- Rewrite: `src/app/(shell)/pos/page.tsx`
- Delete: `src/components/pos/cart-panel.tsx`

**Interfaces:**
- Consumes: All new components from Tasks 1–3
- Consumes: `createOrder` from `@/app/actions/orders`
- Consumes: `findOrCreateCustomer` from `@/app/actions/customers`
- Consumes: `getProfile`, `getModifiers` from `@/lib/dal`
- Consumes: `CartItem`, `PosProduct`, `PosCategory`, `ModifierWithOptions` from `@/types/app`
- `page.tsx` passes `productModifierRecord: Record<string, string[]>` (serializable plain object) to `PosScreen` — NOT `Map` or `Set` (not serializable across server→client boundary)
- `PosScreen` converts `productModifierRecord` to `Map` and `Set` via `useMemo`

**`SmartCart` Props:**
```typescript
type SmartCartProps = {
  cartItems: CartItem[];
  onUpdateQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  orderType: "dine_in" | "take_away";
  onOrderTypeChange: (type: "dine_in" | "take_away") => void;
  tableNumber: string;
  onTableNumberChange: (value: string) => void;
  paymentMethod: "cash" | "transfer" | "card";
  onPaymentChange: (method: "cash" | "transfer" | "card") => void;
  customerId: string | null;
  onCustomerIdChange: (id: string | null) => void;
  pending: boolean;
  error: string | null;
  lastOrderNumber: string | null;
  onCheckout: () => void;
};
```

**`PosScreen` Props:**
```typescript
type PosScreenProps = {
  products: PosProduct[];
  categories: PosCategory[];
  productModifierRecord: Record<string, string[]>;   // productId → modifierIds
  allModifiers: ModifierWithOptions[];
  userName: string;
  todayOrderCount: number;
};
```

- [ ] **Step 1: Create `src/components/pos/smart-cart.tsx`**

```typescript
"use client";
import { useState, useTransition } from "react";
import type { CartItem } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { findOrCreateCustomer } from "@/app/actions/customers";

type PaymentMethod = "cash" | "transfer" | "card";
type OrderType = "dine_in" | "take_away";

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "เงินสด",
  transfer: "โอน",
  card: "บัตร",
};
const PAYMENT_METHODS: PaymentMethod[] = ["cash", "transfer", "card"];

type Props = {
  cartItems: CartItem[];
  onUpdateQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  orderType: OrderType;
  onOrderTypeChange: (type: OrderType) => void;
  tableNumber: string;
  onTableNumberChange: (value: string) => void;
  paymentMethod: PaymentMethod;
  onPaymentChange: (method: PaymentMethod) => void;
  customerId: string | null;
  onCustomerIdChange: (id: string | null) => void;
  pending: boolean;
  error: string | null;
  lastOrderNumber: string | null;
  onCheckout: () => void;
};

export function SmartCart({
  cartItems,
  onUpdateQty,
  onRemove,
  onClear,
  orderType,
  onOrderTypeChange,
  tableNumber,
  onTableNumberChange,
  paymentMethod,
  onPaymentChange,
  customerId,
  onCustomerIdChange,
  pending,
  error,
  lastOrderNumber,
  onCheckout,
}: Props) {
  const [phone, setPhone] = useState("");
  const [linkedPhone, setLinkedPhone] = useState<string | null>(null);
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null);
  const [searchPending, startSearch] = useTransition();

  const total = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);

  function handleLinkCustomer() {
    const trimmed = phone.trim();
    if (!trimmed) return;
    setCustomerSearchError(null);
    startSearch(async () => {
      // Use phone as fallback name so findOrCreateCustomer always has a non-empty name
      const result = await findOrCreateCustomer({ phone: trimmed, name: trimmed });
      if ("error" in result) {
        setCustomerSearchError(result.error);
      } else {
        onCustomerIdChange(result.customerId);
        setLinkedPhone(trimmed);
      }
    });
  }

  function handleClearCustomer() {
    setPhone("");
    setLinkedPhone(null);
    setCustomerSearchError(null);
    onCustomerIdChange(null);
  }

  function orderTypeCls(active: boolean) {
    return (
      "flex-1 rounded-md border py-1.5 text-xs font-medium transition-colors " +
      (active
        ? "border-accent bg-accent text-white"
        : "border-input text-muted-foreground hover:border-accent hover:text-accent")
    );
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h2 className="font-semibold text-sidebar">ตะกร้า</h2>
        {cartItems.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-destructive transition-colors"
          >
            ล้างทั้งหมด
          </button>
        )}
      </div>

      {/* Cart items */}
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {cartItems.length === 0 ? (
          <div className="py-10 text-center">
            {lastOrderNumber && (
              <p className="text-sm font-semibold text-sidebar mb-1">
                ออเดอร์ {lastOrderNumber} สำเร็จ ✓
              </p>
            )}
            <p className="text-muted-foreground text-sm">คลิกสินค้าเพื่อเพิ่ม</p>
          </div>
        ) : (
          cartItems.map((item) => (
            <div
              key={item.cartItemKey}
              className="flex items-start gap-2 px-3 py-2.5"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar truncate">
                  {item.name}
                </p>
                {item.selectedModifiers.length > 0 && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {item.selectedModifiers.map((m) => m.optionName).join(", ")}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  ฿{(item.totalPrice / item.quantity).toFixed(0)} / ชิ้น
                </p>
              </div>
              {/* Qty controls */}
              <div className="flex items-center gap-1 mt-0.5">
                <button
                  type="button"
                  onClick={() => onUpdateQty(item.cartItemKey, item.quantity - 1)}
                  className="w-6 h-6 rounded border text-sm flex items-center justify-center hover:bg-muted transition-colors"
                  aria-label="ลดจำนวน"
                >
                  −
                </button>
                <span className="w-5 text-center text-sm tabular-nums">
                  {item.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => onUpdateQty(item.cartItemKey, item.quantity + 1)}
                  className="w-6 h-6 rounded border text-sm flex items-center justify-center hover:bg-muted transition-colors"
                  aria-label="เพิ่มจำนวน"
                >
                  +
                </button>
              </div>
              <p className="text-sm font-medium w-12 text-right text-sidebar tabular-nums mt-0.5">
                ฿{item.totalPrice.toFixed(0)}
              </p>
              <button
                type="button"
                onClick={() => onRemove(item.cartItemKey)}
                className="text-muted-foreground hover:text-destructive transition-colors text-xs w-4 mt-0.5"
                aria-label="ลบสินค้า"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-4 py-3 space-y-3 shrink-0">
        {/* Customer */}
        {customerId && linkedPhone ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-sidebar font-medium truncate">
              ลูกค้า: {linkedPhone}
            </span>
            <button
              type="button"
              onClick={handleClearCustomer}
              className="text-xs text-muted-foreground hover:text-destructive shrink-0 ml-2"
            >
              ล้าง
            </button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <Input
              type="tel"
              placeholder="เบอร์ลูกค้า (ไม่บังคับ)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLinkCustomer();
              }}
              className="h-7 text-xs"
            />
            <button
              type="button"
              onClick={handleLinkCustomer}
              disabled={!phone.trim() || searchPending}
              className="px-2.5 py-1 text-xs rounded-lg border border-border hover:bg-muted disabled:opacity-40 shrink-0 transition-colors"
            >
              {searchPending ? "…" : "บันทึก"}
            </button>
          </div>
        )}
        {customerSearchError && (
          <p className="text-xs text-destructive">{customerSearchError}</p>
        )}

        {/* Order type */}
        <div className="flex gap-2">
          {(["dine_in", "take_away"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onOrderTypeChange(type)}
              className={orderTypeCls(orderType === type)}
            >
              {type === "dine_in" ? "ทานที่ร้าน" : "Take Away"}
            </button>
          ))}
        </div>

        {/* Table number */}
        {orderType === "dine_in" && (
          <Input
            type="text"
            placeholder="หมายเลขโต๊ะ (ไม่บังคับ)"
            value={tableNumber}
            onChange={(e) => onTableNumberChange(e.target.value)}
            className="h-7 text-xs"
          />
        )}

        {/* Total */}
        <div className="flex justify-between font-semibold text-sidebar text-base">
          <span>รวม</span>
          <span className="tabular-nums">฿{total.toFixed(0)}</span>
        </div>

        {/* Payment method */}
        <div className="flex gap-2">
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => onPaymentChange(method)}
              className={orderTypeCls(paymentMethod === method)}
            >
              {PAYMENT_LABELS[method]}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-sm text-destructive font-medium">{error}</p>
        )}

        <Button
          type="button"
          onClick={onCheckout}
          disabled={cartItems.length === 0 || pending}
          className="w-full bg-accent hover:bg-accent/90 text-white"
        >
          {pending ? "กำลังบันทึก…" : `ชำระ ฿${total.toFixed(0)}`}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `src/components/pos/pos-screen.tsx`**

Replace the entire file contents with:

```typescript
"use client";
import { useState, useTransition, useMemo } from "react";
import { createOrder } from "@/app/actions/orders";
import type {
  CartItem,
  ModifierWithOptions,
  PosCategory,
  PosProduct,
} from "@/types/app";
import { PosHeader } from "./pos-header";
import { ProductGrid } from "./product-grid";
import { ModifierModal } from "./modifier-modal";
import { SmartCart } from "./smart-cart";

type Props = {
  products: PosProduct[];
  categories: PosCategory[];
  productModifierRecord: Record<string, string[]>;
  allModifiers: ModifierWithOptions[];
  userName: string;
  todayOrderCount: number;
};

export function PosScreen({
  products,
  categories,
  productModifierRecord,
  allModifiers,
  userName,
  todayOrderCount,
}: Props) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [pendingProduct, setPendingProduct] = useState<PosProduct | null>(null);
  const [orderType, setOrderType] = useState<"dine_in" | "take_away">("dine_in");
  const [tableNumber, setTableNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer" | "card">("cash");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastOrderNumber, setLastOrderNumber] = useState<string | null>(null);
  const [checkoutPending, startCheckout] = useTransition();

  const productsWithModifiers = useMemo(
    () => new Set(Object.keys(productModifierRecord)),
    [productModifierRecord]
  );

  const productModifierMap = useMemo(
    () => new Map(Object.entries(productModifierRecord)),
    [productModifierRecord]
  );

  function handleProductClick(product: PosProduct) {
    if (productsWithModifiers.has(product.id)) {
      setPendingProduct(product);
    } else {
      addDirectToCart(product);
    }
  }

  function addDirectToCart(product: PosProduct) {
    setCartItems((prev) => {
      const existing = prev.find((i) => i.cartItemKey === product.id);
      if (existing) {
        return prev.map((i) => {
          if (i.cartItemKey !== product.id) return i;
          const unitPrice =
            i.basePrice +
            i.selectedModifiers.reduce((s, m) => s + m.priceDelta, 0);
          return {
            ...i,
            quantity: i.quantity + 1,
            totalPrice: unitPrice * (i.quantity + 1),
          };
        });
      }
      return [
        ...prev,
        {
          cartItemKey: product.id,
          productId: product.id,
          name: product.name,
          basePrice: product.price,
          quantity: 1,
          selectedModifiers: [],
          totalPrice: product.price,
        },
      ];
    });
  }

  function handleAddFromModal(item: CartItem) {
    setCartItems((prev) => [...prev, item]);
    setPendingProduct(null);
  }

  function updateQty(key: string, qty: number) {
    if (qty <= 0) {
      setCartItems((prev) => prev.filter((i) => i.cartItemKey !== key));
    } else {
      setCartItems((prev) =>
        prev.map((i) => {
          if (i.cartItemKey !== key) return i;
          const unitPrice =
            i.basePrice +
            i.selectedModifiers.reduce((s, m) => s + m.priceDelta, 0);
          return { ...i, quantity: qty, totalPrice: unitPrice * qty };
        })
      );
    }
  }

  function removeItem(key: string) {
    setCartItems((prev) => prev.filter((i) => i.cartItemKey !== key));
  }

  function clearCart() {
    setCartItems([]);
    setError(null);
    setLastOrderNumber(null);
    setCustomerId(null);
    setTableNumber("");
  }

  function handleCheckout() {
    setError(null);
    setLastOrderNumber(null);
    startCheckout(async () => {
      const result = await createOrder({
        items: cartItems,
        paymentMethod,
        orderType,
        tableNumber: tableNumber.trim() !== "" ? tableNumber.trim() : undefined,
        customerId: customerId ?? undefined,
      });
      if ("error" in result) {
        setError(result.error);
      } else {
        setLastOrderNumber(result.orderNumber);
        setCartItems([]);
        setTableNumber("");
        setCustomerId(null);
      }
    });
  }

  const pendingProductModifiers: ModifierWithOptions[] = pendingProduct
    ? (productModifierMap.get(pendingProduct.id) ?? [])
        .map((modId) => allModifiers.find((m) => m.id === modId))
        .filter((m): m is ModifierWithOptions => m !== undefined)
    : [];

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <PosHeader userName={userName} todayOrderCount={todayOrderCount} />
      <div className="flex gap-4 flex-1 min-h-0 mt-2">
        <div className="flex-1 min-w-0">
          <ProductGrid
            products={products}
            categories={categories}
            productsWithModifiers={productsWithModifiers}
            onProductClick={handleProductClick}
          />
        </div>
        <div className="w-72 shrink-0">
          <SmartCart
            cartItems={cartItems}
            onUpdateQty={updateQty}
            onRemove={removeItem}
            onClear={clearCart}
            orderType={orderType}
            onOrderTypeChange={setOrderType}
            tableNumber={tableNumber}
            onTableNumberChange={setTableNumber}
            paymentMethod={paymentMethod}
            onPaymentChange={setPaymentMethod}
            customerId={customerId}
            onCustomerIdChange={setCustomerId}
            pending={checkoutPending}
            error={error}
            lastOrderNumber={lastOrderNumber}
            onCheckout={handleCheckout}
          />
        </div>
      </div>
      {pendingProduct !== null && (
        <ModifierModal
          product={pendingProduct}
          modifiers={pendingProductModifiers}
          onAddToCart={handleAddFromModal}
          onClose={() => setPendingProduct(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `src/app/(shell)/pos/page.tsx`**

Replace the entire file with:

```typescript
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getModifiers } from "@/lib/dal";
import { PosScreen } from "@/components/pos/pos-screen";
import type { ModifierWithOptions, PosCategory, PosProduct } from "@/types/app";

export default async function PosPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  // Products with image + drink_type + category
  type ProductRow = {
    id: string;
    name: string;
    price: number;
    image_url: string | null;
    drink_type: string | null;
    category_id: string | null;
    categories: { id: string; name: string } | null;
  };

  const { data: productRows } = (await supabase
    .from("products")
    .select("id, name, price, image_url, drink_type, category_id, categories(id, name)")
    .eq("tenant_id", profile.tenant_id)
    .eq("is_active", true)
    .order("name")) as { data: ProductRow[] | null };

  const products: PosProduct[] = (productRows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    image_url: p.image_url,
    drink_type: (p.drink_type as PosProduct["drink_type"]) ?? null,
    category_id: p.category_id,
    categoryName: p.categories?.name ?? null,
  }));

  // Unique categories derived from products (ordered by first appearance)
  const categoryMap = new Map<string, string>();
  for (const p of products) {
    if (p.category_id && p.categoryName && !categoryMap.has(p.category_id)) {
      categoryMap.set(p.category_id, p.categoryName);
    }
  }
  const categories: PosCategory[] = [...categoryMap.entries()].map(
    ([id, name]) => ({ id, name })
  );

  // Product → modifier IDs mapping (serializable Record, not Map)
  const { data: pmRows } = (await supabase
    .from("product_modifiers")
    .select("product_id, modifier_id")
    .eq("tenant_id", profile.tenant_id)) as {
    data: { product_id: string; modifier_id: string }[] | null;
  };

  const productModifierRecord: Record<string, string[]> = {};
  for (const r of pmRows ?? []) {
    if (!productModifierRecord[r.product_id]) {
      productModifierRecord[r.product_id] = [];
    }
    productModifierRecord[r.product_id]!.push(r.modifier_id);
  }

  // All tenant modifiers (for ModifierModal to render options)
  const allModifiers: ModifierWithOptions[] = await getModifiers(
    profile.tenant_id
  );

  // Today's order count (Bangkok UTC+7)
  const offsetMs = 7 * 60 * 60 * 1000;
  const bangkokNow = new Date(Date.now() + offsetMs);
  const bangkokMidnightUTC = Date.UTC(
    bangkokNow.getUTCFullYear(),
    bangkokNow.getUTCMonth(),
    bangkokNow.getUTCDate()
  );
  const todayStart = new Date(bangkokMidnightUTC - offsetMs);

  const { count: todayOrderCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", profile.tenant_id)
    .neq("status", "cancelled")
    .gte("created_at", todayStart.toISOString());

  return (
    <PosScreen
      products={products}
      categories={categories}
      productModifierRecord={productModifierRecord}
      allModifiers={allModifiers}
      userName={profile.full_name ?? "ผู้ใช้"}
      todayOrderCount={todayOrderCount ?? 0}
    />
  );
}
```

- [ ] **Step 4: Delete `src/components/pos/cart-panel.tsx`**

```
git rm src/components/pos/cart-panel.tsx
```

Confirm: nothing in the codebase imports `cart-panel.tsx` after the `pos-screen.tsx` rewrite above. Run:

```
grep -r "cart-panel" src/
```

Expected: no results (file is deleted and no import remains).

- [ ] **Step 5: Verify TypeScript**

```
npx tsc --noEmit
```

Expected: 0 errors. If TypeScript complains about `productModifierRecord[r.product_id]` being possibly undefined, that's the `noUncheckedIndexedAccess` flag. The fix is already in the code above (using `productModifierRecord[r.product_id]!.push(...)` after setting the empty array).

- [ ] **Step 6: Lint**

```
npm run lint
```

Expected: 0 errors. If there are `react/no-unescaped-entities` errors on Thai quotes inside JSX text, replace `"` characters with `&quot;`.

- [ ] **Step 7: Commit**

```
git add src/components/pos/smart-cart.tsx src/components/pos/pos-screen.tsx src/app/(shell)/pos/page.tsx
git commit -m "feat(pos): complete POS revamp — SmartCart, full PosScreen rewrite, delete CartPanel"
```

- [ ] **Step 8: Push**

```
git push origin main
```
