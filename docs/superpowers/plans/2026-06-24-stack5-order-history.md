# Stack 5: Order History & Receipts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/orders` history list with payment-method/status filter, and `/orders/[id]` receipt detail page.

**Architecture:** Both pages are Server Components that query Supabase directly. Filter state lives in the URL (`?filter=cash`) — a small Client Component (`OrdersFilter`) reads `useSearchParams` and pushes new URLs, wrapped in `<Suspense>` per App Router requirements. No new server actions needed — this stack is read-only.

**Tech Stack:** Next.js 16.2.9 App Router, Supabase SSR (`createClient` from `@/lib/supabase/server`), Tailwind CSS, Lucide React icons.

## Global Constraints

- `params` and `searchParams` in page components are `Promise<{...}>` — always `await` them before use.
- No Radix UI `asChild` — Button component does NOT support it; use native `<a>` or Next.js `<Link>` directly.
- `noUncheckedIndexedAccess` is on — `Record<string, string>["key"]` returns `string | undefined`; always use `?? fallback`.
- Type-cast Supabase results: `(await query) as { data: T | null }`.
- `.single()` returns `{ data: T | null; error: ... }` — cast as `{ data: T | null }`.
- All pages in `(shell)` must call `getProfile()` and `redirect("/login")` if null.
- RLS is active — tenant isolation is enforced by `.eq("tenant_id", profile.tenant_id)`.
- Thai text for all user-facing labels.
- Commit after each task with `git add` by exact file path.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/shell/sidebar.tsx` | Modify | Add `/orders` nav item (ShoppingBag icon, minRole: "staff") |
| `src/components/orders/orders-filter.tsx` | Create | Client Component — filter tabs, pushes `?filter=` to URL |
| `src/app/(shell)/orders/page.tsx` | Create | Server Component — list all orders, filtered by URL param |
| `src/app/(shell)/orders/[id]/page.tsx` | Create | Server Component — receipt detail with line items |

---

### Task 1: Orders List Page + Filter + Sidebar Nav

**Files:**
- Modify: `src/components/shell/sidebar.tsx`
- Create: `src/components/orders/orders-filter.tsx`
- Create: `src/app/(shell)/orders/page.tsx`

**Interfaces:**
- Consumes: `getProfile()` from `@/lib/dal`, `createClient` from `@/lib/supabase/server`
- Produces: `/orders` route, `<OrdersFilter>` component (used in `/orders/page.tsx`), `/orders/[id]` link per row

---

- [ ] **Step 1: Add `/orders` nav item to sidebar**

Open `src/components/shell/sidebar.tsx`. Add `ShoppingBag` to the lucide-react import and insert the nav item after POS.

Full file after edit:

```tsx
import Link from "next/link";
import {
  LayoutDashboard,
  CreditCard,
  ShoppingBag,
  Package,
  Tag,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { LogoutButton } from "./logout-button";
import { getProfile, type Role } from "@/lib/dal";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  minRole: Role;
};

const allNavItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, minRole: "staff" },
  { href: "/pos", label: "POS", icon: CreditCard, minRole: "staff" },
  { href: "/orders", label: "Orders", icon: ShoppingBag, minRole: "staff" },
  { href: "/products", label: "Products", icon: Package, minRole: "staff" },
  { href: "/categories", label: "Categories", icon: Tag, minRole: "manager" },
  { href: "/reports", label: "Reports", icon: BarChart3, minRole: "manager" },
  { href: "/settings", label: "Settings", icon: Settings, minRole: "owner" },
];

function getRoleLevel(role: Role): number {
  switch (role) {
    case "owner":
      return 3;
    case "manager":
      return 2;
    case "staff":
      return 1;
  }
}

function canAccess(userRole: Role, minRole: Role): boolean {
  return getRoleLevel(userRole) >= getRoleLevel(minRole);
}

export async function Sidebar() {
  const profile = await getProfile();
  const role = (profile?.role ?? "staff") as Role;
  const visibleItems = allNavItems.filter((item) =>
    canAccess(role, item.minRole)
  );

  return (
    <aside className="hidden md:flex flex-col w-16 lg:w-56 h-full shrink-0 bg-sidebar border-r border-white/10">
      <div className="flex items-center justify-center lg:justify-start h-14 px-4 border-b border-white/10 shrink-0">
        <span className="text-accent font-bold text-xl hidden lg:inline">
          KIDKUBPOS
        </span>
        <span className="text-accent font-bold text-lg lg:hidden">K</span>
      </div>
      <nav className="flex-1 py-4 flex flex-col gap-1 px-2 overflow-y-auto">
        {visibleItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 h-10 px-2 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Icon size={20} className="shrink-0" />
            <span className="hidden lg:inline text-sm font-medium">{label}</span>
          </Link>
        ))}
      </nav>
      <div className="border-t border-white/10 px-2 py-3">
        <div className="hidden lg:block px-2 pb-2">
          <p className="text-xs text-white/50 truncate">
            {profile?.full_name ?? "—"}
          </p>
          <p className="text-xs text-accent font-medium capitalize">{role}</p>
        </div>
        <LogoutButton />
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Create the filter Client Component**

Create `src/components/orders/orders-filter.tsx`:

```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";

type FilterValue = "all" | "cash" | "transfer" | "card" | "cancelled";

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "cash", label: "เงินสด" },
  { value: "transfer", label: "โอน" },
  { value: "card", label: "บัตร" },
  { value: "cancelled", label: "ยกเลิก" },
];

export function OrdersFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = (searchParams.get("filter") ?? "all") as FilterValue;

  function setFilter(value: FilterValue) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("filter");
    } else {
      params.set("filter", value);
    }
    router.push(`/orders?${params.toString()}`);
  }

  return (
    <div className="flex gap-2 flex-wrap">
      {FILTERS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => setFilter(value)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
            current === value
              ? "border-accent bg-accent text-white"
              : "border-input text-muted-foreground hover:border-accent hover:text-accent"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create the orders list page**

Create `src/app/(shell)/orders/page.tsx`:

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { OrdersFilter } from "@/components/orders/orders-filter";

type FilterValue = "all" | "cash" | "transfer" | "card" | "cancelled";

type OrderRow = {
  id: string;
  payment_method: string;
  status: string;
  total: number;
  created_at: string;
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: "เงินสด",
  transfer: "โอน",
  card: "บัตร",
};

type Props = {
  searchParams: Promise<{ filter?: string }>;
};

export default async function OrdersPage({ searchParams }: Props) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const { filter } = await searchParams;
  const filterValue = (filter ?? "all") as FilterValue;

  const supabase = await createClient();
  const baseQuery = supabase
    .from("orders")
    .select("id, payment_method, status, total, created_at")
    .eq("tenant_id", profile.tenant_id)
    .order("created_at", { ascending: false });

  const filteredQuery =
    filterValue === "cancelled"
      ? baseQuery.eq("status", "cancelled")
      : filterValue !== "all"
        ? baseQuery.eq("payment_method", filterValue).neq("status", "cancelled")
        : baseQuery;

  const { data: orders } = (await filteredQuery) as { data: OrderRow[] | null };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">ประวัติบิล</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          บิลทั้งหมดของร้าน
        </p>
      </div>

      <Suspense fallback={null}>
        <OrdersFilter />
      </Suspense>

      <div className="rounded-lg border bg-white divide-y divide-border">
        {orders && orders.length > 0 ? (
          orders.map((order) => (
            <Link
              key={order.id}
              href={`/orders/${order.id}`}
              className="flex items-center gap-4 px-4 py-3 hover:bg-surface transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sidebar text-sm font-mono">
                  #{order.id.slice(0, 8).toUpperCase()}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(order.created_at).toLocaleString("th-TH", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                  order.status === "cancelled"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-green-200 bg-green-50 text-green-700"
                }`}
              >
                {order.status === "cancelled"
                  ? "ยกเลิก"
                  : (PAYMENT_LABELS[order.payment_method] ?? order.payment_method)}
              </span>
              <p className="text-sm font-semibold text-sidebar tabular-nums w-24 text-right">
                ฿{Number(order.total).toFixed(2)}
              </p>
            </Link>
          ))
        ) : (
          <p className="px-4 py-12 text-center text-muted-foreground text-sm">
            ไม่พบบิล
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```powershell
npm run build -- --webpack 2>&1 | Select-String -Pattern "error TS" | Select-Object -First 20
```

Expected: no `error TS` lines. If there are errors, fix them before committing.

- [ ] **Step 5: Commit Task 1**

```powershell
git add src/components/shell/sidebar.tsx
git add src/components/orders/orders-filter.tsx
git add 'src/app/(shell)/orders/page.tsx'
git commit -m "feat: add orders history page with payment method filter"
```

---

### Task 2: Order Detail Page (Receipt)

**Files:**
- Create: `src/app/(shell)/orders/[id]/page.tsx`

**Interfaces:**
- Consumes: `getProfile()` from `@/lib/dal`, `createClient` from `@/lib/supabase/server`
- Consumes: `orders` joined with `order_items(*)` via Supabase nested select
- Produces: `/orders/[id]` route — receipt with line items and order summary

---

- [ ] **Step 1: Create the order detail page**

Create `src/app/(shell)/orders/[id]/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

type OrderItem = {
  id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
};

type OrderDetail = {
  id: string;
  payment_method: string;
  status: string;
  total: number;
  note: string | null;
  created_at: string;
  order_items: OrderItem[];
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: "เงินสด",
  transfer: "โอน",
  card: "บัตร",
};

type Props = {
  params: Promise<{ id: string }>;
};

export default async function OrderDetailPage({ params }: Props) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = (await supabase
    .from("orders")
    .select(
      "id, payment_method, status, total, note, created_at, order_items(id, product_name, unit_price, quantity, subtotal)"
    )
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .single()) as { data: OrderDetail | null };

  if (!order) notFound();

  return (
    <div className="space-y-6 max-w-xl">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <Link
          href="/orders"
          className="text-muted-foreground hover:text-sidebar transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-sidebar font-mono">
            #{order.id.slice(0, 8).toUpperCase()}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date(order.created_at).toLocaleString("th-TH", {
              dateStyle: "long",
              timeStyle: "short",
            })}
          </p>
        </div>
      </div>

      {/* Line items */}
      <div className="rounded-lg border bg-white divide-y divide-border">
        {order.order_items.map((item) => (
          <div key={item.id} className="flex items-center gap-4 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sidebar text-sm">
                {item.product_name}
              </p>
              <p className="text-xs text-muted-foreground">
                ฿{Number(item.unit_price).toFixed(2)} × {item.quantity}
              </p>
            </div>
            <p className="text-sm font-semibold text-sidebar tabular-nums">
              ฿{Number(item.subtotal).toFixed(2)}
            </p>
          </div>
        ))}
        {order.order_items.length === 0 && (
          <p className="px-4 py-8 text-center text-muted-foreground text-sm">
            ไม่มีรายการสินค้า
          </p>
        )}
      </div>

      {/* Order summary */}
      <div className="rounded-lg border bg-white px-4 py-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">วิธีชำระ</span>
          <span className="font-medium text-sidebar">
            {PAYMENT_LABELS[order.payment_method] ?? order.payment_method}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">สถานะ</span>
          <span
            className={`font-medium ${
              order.status === "cancelled"
                ? "text-destructive"
                : "text-green-700"
            }`}
          >
            {order.status === "cancelled" ? "ยกเลิก" : "สำเร็จ"}
          </span>
        </div>
        {order.note !== null && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">หมายเหตุ</span>
            <span className="font-medium text-sidebar text-right max-w-[60%]">
              {order.note}
            </span>
          </div>
        )}
        <div className="flex justify-between font-semibold text-sidebar pt-2 border-t border-border">
          <span>รวมทั้งหมด</span>
          <span className="tabular-nums">฿{Number(order.total).toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```powershell
npm run build -- --webpack 2>&1 | Select-String -Pattern "error TS" | Select-Object -First 20
```

Expected: no `error TS` lines.

- [ ] **Step 3: Commit Task 2**

```powershell
git add 'src/app/(shell)/orders/[id]/page.tsx'
git commit -m "feat: add order detail page with line items receipt"
```

---

## Self-Review

**Spec coverage:**
1. ✅ `/orders` — แสดงประวัติบิลทั้งหมด เรียงจากใหม่ไปเก่า → Task 1 `orders/page.tsx` + `.order("created_at", { ascending: false })`
2. ✅ Filter by payment method (เงินสด, โอน, บัตร) + cancelled → Task 1 `OrdersFilter` + URL-param branching
3. ✅ `/orders/[id]` แสดงรายการสินค้าในบิล → Task 2 `orders/[id]/page.tsx` with `order_items` join

**Placeholder scan:** No TBD, TODO, or vague instructions found.

**Type consistency:**
- `FilterValue` defined in both `orders-filter.tsx` and `orders/page.tsx` independently (structural compatibility — same union, no cross-import needed since it's a value type only)
- `OrderDetail.order_items: OrderItem[]` matches the select `order_items(id, product_name, unit_price, quantity, subtotal)`
- `PAYMENT_LABELS: Record<string, string>` — `?? fallback` used everywhere it's indexed
