# Stack 6: Dashboard & Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static placeholder dashboard with live sales stats (today vs. yesterday) and a top-products table, visible only to owner/manager roles.

**Architecture:** All data fetching is added to `src/lib/dal.ts` (already server-only); the dashboard page becomes an async Server Component that gates on role — staff see a greeting, manager/owner see the full stats. No client components needed; all data is fetched at render time on the server.

**Tech Stack:** Next.js 16 App Router (Server Components), Supabase JS client, TypeScript, Tailwind CSS, shadcn/ui Card

## Global Constraints

- Read `node_modules/next/dist/docs/` before touching any Next.js API — breaking changes exist
- Never commit `.env.local` or any Supabase key
- `params` and `searchParams` in page components are `Promise<{...}>` — must `await` before use (Next.js 16 pattern)
- All Supabase queries must include `.eq("tenant_id", profile.tenant_id)` for RLS tenant isolation
- TypeScript must pass `npm run build` with zero `error TS` lines
- Use `?? fallback` for any `Record<string, T>[key]` access (`noUncheckedIndexedAccess` is enabled)
- PowerShell single-quoted here-string `@'...'@` for multiline git commit messages (NOT bash heredoc)

---

### Task 1: DAL — Sales Stats and Top Products Functions

**Files:**
- Modify: `src/lib/dal.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server` (already imported in dal.ts)
- Produces:
  - `getDashboardStats(tenantId: string): Promise<DashboardStats>`
  - `getTopProducts(tenantId: string, limit?: number): Promise<TopProduct[]>`
  - `type DashboardStats = { todaySales: number; todayOrders: number; yesterdaySales: number; yesterdayOrders: number }`
  - `type TopProduct = { product_name: string; total_qty: number; total_sales: number }`

- [ ] **Step 1: Check build is green before touching anything**

Run:
```powershell
npm run build 2>&1 | Select-String "error TS"
```
Expected: no output (zero TypeScript errors). If there are errors, stop and fix them first.

- [ ] **Step 2: Add the two exported types and `getDashboardStats` to `src/lib/dal.ts`**

Append these exports to the bottom of `src/lib/dal.ts`:

```ts
export type DashboardStats = {
  todaySales: number;
  todayOrders: number;
  yesterdaySales: number;
  yesterdayOrders: number;
};

export async function getDashboardStats(tenantId: string): Promise<DashboardStats> {
  // Bangkok = UTC+7; compute day boundaries in Bangkok time
  const offsetMs = 7 * 60 * 60 * 1000;
  const bangkokNow = new Date(Date.now() + offsetMs);
  const bangkokMidnightUTC = Date.UTC(
    bangkokNow.getUTCFullYear(),
    bangkokNow.getUTCMonth(),
    bangkokNow.getUTCDate()
  );
  const todayStart = new Date(bangkokMidnightUTC - offsetMs);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);

  const supabase = await createClient();

  const [{ data: todayRows }, { data: yesterdayRows }] = await Promise.all([
    supabase
      .from("orders")
      .select("total")
      .eq("tenant_id", tenantId)
      .neq("status", "cancelled")
      .gte("created_at", todayStart.toISOString())
      .lt("created_at", tomorrowStart.toISOString()),
    supabase
      .from("orders")
      .select("total")
      .eq("tenant_id", tenantId)
      .neq("status", "cancelled")
      .gte("created_at", yesterdayStart.toISOString())
      .lt("created_at", todayStart.toISOString()),
  ]);

  const today = (todayRows ?? []) as { total: number }[];
  const yesterday = (yesterdayRows ?? []) as { total: number }[];

  return {
    todaySales: today.reduce((sum, r) => sum + Number(r.total), 0),
    todayOrders: today.length,
    yesterdaySales: yesterday.reduce((sum, r) => sum + Number(r.total), 0),
    yesterdayOrders: yesterday.length,
  };
}
```

- [ ] **Step 3: Add `TopProduct` type and `getTopProducts` to `src/lib/dal.ts`**

Append these exports directly after `getDashboardStats`:

```ts
export type TopProduct = {
  product_name: string;
  total_qty: number;
  total_sales: number;
};

export async function getTopProducts(
  tenantId: string,
  limit = 5
): Promise<TopProduct[]> {
  const supabase = await createClient();

  // Fetch non-cancelled order IDs for this tenant
  const { data: orderRows } = (await supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")) as { data: { id: string }[] | null };

  if (!orderRows || orderRows.length === 0) return [];

  const orderIds = orderRows.map((r) => r.id);

  // Fetch all order_items for those orders
  const { data: items } = (await supabase
    .from("order_items")
    .select("product_name, quantity, subtotal")
    .in("order_id", orderIds)) as {
    data: { product_name: string; quantity: number; subtotal: number }[] | null;
  };

  if (!items) return [];

  // Aggregate in JS — no GROUP BY needed via RPC
  const map = new Map<string, { total_qty: number; total_sales: number }>();
  for (const row of items) {
    const prev = map.get(row.product_name) ?? { total_qty: 0, total_sales: 0 };
    map.set(row.product_name, {
      total_qty: prev.total_qty + row.quantity,
      total_sales: prev.total_sales + Number(row.subtotal),
    });
  }

  return [...map.entries()]
    .map(([product_name, s]) => ({ product_name, ...s }))
    .sort((a, b) => b.total_qty - a.total_qty)
    .slice(0, limit);
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run:
```powershell
npm run build 2>&1 | Select-String "error TS"
```
Expected: no output.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/dal.ts
git commit -m @'
feat: add getDashboardStats and getTopProducts to DAL

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
```

---

### Task 2: Dashboard Page — Live Stats with Role Gating

**Files:**
- Modify: `src/app/(shell)/page.tsx`

**Interfaces:**
- Consumes:
  - `getProfile` from `@/lib/dal` (already exists)
  - `getDashboardStats(tenantId: string): Promise<DashboardStats>` (Task 1)
  - `getTopProducts(tenantId: string, limit?: number): Promise<TopProduct[]>` (Task 1)
  - `type DashboardStats`, `type TopProduct` from `@/lib/dal` (Task 1)
- Produces: Updated dashboard page rendering (no exported functions consumed by other files)

- [ ] **Step 1: Replace `src/app/(shell)/page.tsx` entirely**

```tsx
import { redirect } from "next/navigation";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { getProfile, getDashboardStats, getTopProducts } from "@/lib/dal";
import type { DashboardStats } from "@/lib/dal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function TrendBadge({
  today,
  yesterday,
}: {
  today: number;
  yesterday: number;
}) {
  if (today > yesterday) {
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-green-600">
        <TrendingUp size={12} />
        ดีกว่าเมื่อวาน
      </span>
    );
  }
  if (today < yesterday) {
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-destructive">
        <TrendingDown size={12} />
        น้อยกว่าเมื่อวาน
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-xs font-medium text-muted-foreground">
      <Minus size={12} />
      เท่าเมื่อวาน
    </span>
  );
}

function StatCards({ stats }: { stats: DashboardStats }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            ยอดขายวันนี้
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-2xl font-bold text-sidebar tabular-nums">
            ฿{stats.todaySales.toFixed(2)}
          </p>
          <TrendBadge today={stats.todaySales} yesterday={stats.yesterdaySales} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            บิลวันนี้
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-2xl font-bold text-sidebar tabular-nums">
            {stats.todayOrders}
          </p>
          <TrendBadge
            today={stats.todayOrders}
            yesterday={stats.yesterdayOrders}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default async function DashboardPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const canViewStats =
    profile.role === "owner" || profile.role === "manager";

  if (!canViewStats) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-sidebar">
          สวัสดี, {profile.full_name ?? "—"}
        </h1>
        <p className="text-sm text-muted-foreground">
          ยินดีต้อนรับสู่ KIDKUBPOS — เริ่มงานได้เลย!
        </p>
      </div>
    );
  }

  const [stats, topProducts] = await Promise.all([
    getDashboardStats(profile.tenant_id),
    getTopProducts(profile.tenant_id, 5),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          ภาพรวมของร้านวันนี้
        </p>
      </div>

      <StatCards stats={stats} />

      <div>
        <h2 className="text-base font-semibold text-sidebar mb-3">
          สินค้าขายดี
        </h2>
        <div className="rounded-lg border bg-white divide-y divide-border">
          {topProducts.length > 0 ? (
            topProducts.map((p, i) => (
              <div
                key={p.product_name}
                className="flex items-center gap-4 px-4 py-3"
              >
                <span className="text-sm font-bold text-muted-foreground w-5 text-center tabular-nums">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sidebar text-sm truncate">
                    {p.product_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.total_qty} ชิ้น
                  </p>
                </div>
                <p className="text-sm font-semibold text-sidebar tabular-nums">
                  ฿{p.total_sales.toFixed(2)}
                </p>
              </div>
            ))
          ) : (
            <p className="px-4 py-12 text-center text-muted-foreground text-sm">
              ยังไม่มีข้อมูลการขาย
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```powershell
npm run build 2>&1 | Select-String "error TS"
```
Expected: no output.

- [ ] **Step 3: Commit**

```powershell
git add src/app/(shell)/page.tsx
git commit -m @'
feat: update dashboard with live stats and top products (role-gated)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
'@
```

- [ ] **Step 4: Push to GitHub**

```powershell
git push origin main
```
Expected: `main -> main` with the 2 new commits.

---

## Self-Review Checklist

**Spec coverage:**
1. ✅ ดึงข้อมูลสรุปจาก `orders` (ยอดขายรวมวันนี้, จำนวนบิลวันนี้, เปรียบเทียบเมื่อวาน) → `getDashboardStats`
2. ✅ สินค้าขายดี Top 5 จาก `order_items` → `getTopProducts` (aggregate in JS)
3. ✅ อัปเดต `page.tsx` แสดง Card สรุปยอด + ตารางสินค้าขายดี → Task 2
4. ✅ จำกัดสิทธิ์ owner/manager เท่านั้น → `canViewStats` gate; staff เห็นแค่คำทักทาย

**Placeholder scan:** ไม่มี TBD/TODO ทุก step มี code ครบถ้วน

**Type consistency:**
- `DashboardStats` ถูกกำหนดใน Task 1 และ import ใน Task 2 ✅
- `TopProduct` ถูกกำหนดใน Task 1 และใช้ใน Task 2 ✅
- `getDashboardStats` / `getTopProducts` signatures ตรงกันระหว่าง Task 1 และ Task 2 ✅
