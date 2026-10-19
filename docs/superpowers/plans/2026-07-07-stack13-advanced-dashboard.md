# Stack 13: Advanced Dashboard & Mobile UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่ม BottomNav สำหรับมือถือ, Low Stock Widget, Analytics Charts พร้อม Peak Hours, และ Pricing Calculator ลงใน Dashboard

**Architecture:** Task 1–2 เป็น standalone components ที่ไม่พึ่งกัน; Task 3 ต้อง extend DAL ก่อนแล้วค่อย build charts — range switching ใช้ URL searchParams (`?range=day|week|month|year`) ให้ server component fetch ข้อมูลใหม่ทุก range; Task 4 เพิ่ม DAL helpers + client-side Pricing Calculator ที่ดึง ingredient cost ผ่าน server action; page.tsx (server component) เป็นตัวประสานทุก task โดย Task 3 จะ replace ทั้งไฟล์และ Task 4 จะ patch บนผลลัพธ์ของ Task 3

**Tech Stack:** Next.js 16 App Router, Supabase SSR, TypeScript 5 strict + noUncheckedIndexedAccess, Recharts 2.x, Lucide React, Tailwind CSS

## Global Constraints

- ห้าม commit `.env.local` หรือ Supabase keys ทุกกรณี
- ห้ามแก้ `tsconfig.json` เพื่อ suppress errors — fix code instead
- ไม่มี `next/image` — ใช้ `<img>` ธรรมดาสำหรับรูปภาพ
- `Button` component ใช้ `@base-ui/react` — ไม่มี `asChild` prop — ใช้ `<Link>` + Tailwind สำหรับ navigation
- Auth: ใช้ `getProfile()` (ไม่ใช่ `getSession()`) ใน Server Components/Actions ทุกที่
- Tenant isolation: ทุก Supabase query ต้องมี `.eq("tenant_id", profile.tenant_id)` — ไม่พึ่ง RLS อย่างเดียว
- `npx tsc --noEmit` ต้องผ่าน zero errors ทุก task ก่อน commit
- Bangkok = UTC+7 เสมอ: `offsetMs = 7 * 60 * 60 * 1000` — ดูตัวอย่างใน `src/lib/dal.ts` ที่มีอยู่
- โทนสีหลักใน Recharts: `"var(--color-sidebar)"` (กรมท่า) และ `"var(--color-accent)"` (ส้ม)
- `searchParams` และ `params` ใน Next.js 16 เป็น `Promise<T>` — ต้อง `await` เสมอ

## File Structure

```
src/
  components/
    shell/
      bottom-nav.tsx              [CREATE — Task 1]
    dashboard/
      low-stock-widget.tsx        [CREATE — Task 2]
      analytics-section.tsx       [CREATE — Task 3, "use client"]
      summary-cards.tsx           [CREATE — Task 3]
      sales-trend-chart.tsx       [CREATE — Task 3, "use client", Recharts]
      peak-hours-chart.tsx        [CREATE — Task 3, "use client", Recharts]
      category-performance-chart.tsx [CREATE — Task 3, "use client", Recharts]
      pricing-calculator.tsx      [CREATE — Task 4, "use client"]
  app/
    (shell)/
      layout.tsx                  [MODIFY — Task 1]
      page.tsx                    [MODIFY — Task 2; REPLACE — Task 3; PATCH — Task 4]
    actions/
      calculator.ts               [CREATE — Task 4]
  lib/
    dal.ts                        [MODIFY — Task 2 (export types); Task 3 (4 new functions + extend getSalesByCategory); Task 4 (2 new helpers)]
```

---

### Task 1: Mobile Navigation (BottomNav)

**Files:**
- Create: `src/components/shell/bottom-nav.tsx`
- Modify: `src/app/(shell)/layout.tsx`

**Interfaces:**
- Consumes: `next/navigation` (`usePathname`), Lucide icons
- Produces: `export function BottomNav()` — `md:hidden`, fixed bottom, 4 items

---

- [ ] **Step 1: สร้าง `src/components/shell/bottom-nav.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, CreditCard, ShoppingBag, Settings } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "แดชบอร์ด", icon: LayoutDashboard },
  { href: "/pos", label: "POS", icon: CreditCard },
  { href: "/orders", label: "ออเดอร์", icon: ShoppingBag },
  { href: "/settings", label: "ตั้งค่า", icon: Settings },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-sidebar border-t border-white/10 flex h-16">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
              active ? "text-accent" : "text-white/50 hover:text-white/80"
            }`}
          >
            <Icon size={22} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: แก้ `src/app/(shell)/layout.tsx`**

อ่านไฟล์ก่อน แล้วแทนที่ด้วย:

```tsx
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { getAuthUser } from "@/lib/dal";

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-surface p-4 pb-20 md:p-6 md:pb-6">
          {children}
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
```

`pb-20` = safe area ให้เนื้อหาไม่ถูก BottomNav (h-16) บัง บน mobile; `md:pb-6` คืนค่าปกติบน desktop

- [ ] **Step 3: ตรวจสอบ TypeScript**

```powershell
npx tsc --noEmit 2>&1
```

Expected: ไม่มี output เลย

- [ ] **Step 4: Commit**

```powershell
git add src/components/shell/bottom-nav.tsx src/app/(shell)/layout.tsx
git commit -m "feat(shell): add BottomNav for mobile, add pb-20 safe area in main"
```

---

### Task 2: Low Stock Alerts Widget

**Files:**
- Modify: `src/lib/dal.ts` (export `LowStockAlert` type)
- Create: `src/components/dashboard/low-stock-widget.tsx`
- Modify: `src/app/(shell)/page.tsx`

**Interfaces:**
- Consumes: `getLowStockAlerts(tenantId: string): Promise<LowStockAlert[]>` — already in dal.ts
- Produces: `export function LowStockWidget({ alerts }: { alerts: LowStockAlert[] })` — Server Component

---

- [ ] **Step 1: Export `LowStockAlert` type จาก `src/lib/dal.ts`**

อ่านบรรทัดรอบ `getLowStockAlerts` ใน `src/lib/dal.ts` (บรรทัด 250) ตรวจว่า `LowStockAlert` ถูก export เป็น type แล้วหรือยัง ถ้ายัง ให้เพิ่มก่อน function:

```ts
export type LowStockAlert = {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  minStockAlert: number;
};
```

- [ ] **Step 2: สร้าง `src/components/dashboard/low-stock-widget.tsx`**

```tsx
import { AlertTriangle, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LowStockAlert } from "@/lib/dal";

export function LowStockWidget({ alerts }: { alerts: LowStockAlert[] }) {
  if (alerts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <CheckCircle size={16} className="text-green-500" />
            สต็อกวัตถุดิบ
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">วัตถุดิบทุกรายการมีเพียงพอ</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-destructive flex items-center gap-2">
          <AlertTriangle size={16} />
          วัตถุดิบใกล้หมด ({alerts.length} รายการ)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-border rounded-md border bg-white overflow-hidden">
          {alerts.map((alert) => (
            <div key={alert.id} className="flex items-center justify-between px-3 py-2">
              <span className="text-sm font-medium text-sidebar truncate">{alert.name}</span>
              <span className="text-xs text-destructive font-semibold shrink-0 ml-2 tabular-nums">
                {alert.currentStock} / {alert.minStockAlert} {alert.unit}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: แก้ `src/app/(shell)/page.tsx` — เพิ่ม LowStockWidget**

เพิ่ม import:
```tsx
import { LowStockWidget } from "@/components/dashboard/low-stock-widget";
```

อัปเดต import จาก `@/lib/dal`:
```tsx
import { getProfile, getDashboardStats, getTopProducts, getLowStockAlerts } from "@/lib/dal";
```

อัปเดต `Promise.all` ในส่วน `canViewStats`:
```tsx
const [stats, topProducts, lowStockAlerts] = await Promise.all([
  getDashboardStats(profile.tenant_id),
  getTopProducts(profile.tenant_id, 5),
  getLowStockAlerts(profile.tenant_id),
]);
```

เพิ่ม `<LowStockWidget>` ใน JSX หลัง `<StatCards stats={stats} />`:
```tsx
<LowStockWidget alerts={lowStockAlerts} />
```

- [ ] **Step 4: ตรวจสอบ TypeScript**

```powershell
npx tsc --noEmit 2>&1
```

Expected: ไม่มี output

- [ ] **Step 5: Commit**

```powershell
git add src/lib/dal.ts src/components/dashboard/low-stock-widget.tsx src/app/(shell)/page.tsx
git commit -m "feat(dashboard): add LowStockWidget showing raw materials below threshold"
```

---

### Task 3: DAL Extension + Analytics Charts

**Files:**
- Modify: `src/lib/dal.ts` (4 new exports + extend `getSalesByCategory`)
- Install: `recharts`
- Create: `src/components/dashboard/summary-cards.tsx`
- Create: `src/components/dashboard/sales-trend-chart.tsx`
- Create: `src/components/dashboard/peak-hours-chart.tsx`
- Create: `src/components/dashboard/category-performance-chart.tsx`
- Create: `src/components/dashboard/analytics-section.tsx`
- Replace: `src/app/(shell)/page.tsx`

**Interfaces:**
- Produces (new DAL types and functions):
  ```ts
  export type SalesByDay = { date: string; total: number };
  export type SalesByMonth = { month: number; total: number };
  export type HourlyPattern = { hour: number; total: number };
  export type SalesSummary = { totalSales: number; totalOrders: number };

  export async function getSalesByDay(tenantId: string, startDate: string, endDate: string): Promise<SalesByDay[]>
  export async function getSalesByMonth(tenantId: string, year: number): Promise<SalesByMonth[]>
  export async function getHourlyPattern(tenantId: string, startDate: string, endDate: string): Promise<HourlyPattern[]>
  export async function getSalesSummary(tenantId: string, startDate: string, endDate: string): Promise<SalesSummary>
  // getSalesByCategory — range extended to "day" | "week" | "month" | "year"
  ```
- `startDate` / `endDate` รูปแบบ `"YYYY-MM-DD"` เสมอ (Bangkok time)
- Produces: `export function AnalyticsSection(props: AnalyticsSectionProps)` — "use client"

---

- [ ] **Step 1: Install Recharts**

```powershell
npm install recharts
```

Expected: `added N packages` — ไม่มี error, `package.json` มี `"recharts"` entry

- [ ] **Step 2: เพิ่ม types และ 4 DAL functions ต่อท้าย `src/lib/dal.ts`**

อ่านส่วนท้ายของไฟล์ก่อน แล้ว append ต่อท้ายสุด:

```ts
// ─── Analytics Types ─────────────────────────────────────────────────────────

export type SalesByDay = { date: string; total: number };
export type SalesByMonth = { month: number; total: number };
export type HourlyPattern = { hour: number; total: number };
export type SalesSummary = { totalSales: number; totalOrders: number };

// ─── getSalesByDay ────────────────────────────────────────────────────────────

export async function getSalesByDay(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string    // "YYYY-MM-DD" Bangkok (inclusive)
): Promise<SalesByDay[]> {
  const supabase = await createClient();
  const offsetMs = 7 * 60 * 60 * 1000;
  const rangeStart = new Date(`${startDate}T00:00:00+07:00`);
  const rangeEnd = new Date(`${endDate}T00:00:00+07:00`);
  rangeEnd.setTime(rangeEnd.getTime() + 24 * 60 * 60 * 1000); // exclusive

  const { data } = await supabase
    .from("orders")
    .select("created_at, total")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .gte("created_at", rangeStart.toISOString())
    .lt("created_at", rangeEnd.toISOString());

  const byDate = new Map<string, number>();
  for (const row of (data ?? []) as { created_at: string; total: number }[]) {
    const d = new Date(new Date(row.created_at).getTime() + offsetMs);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    byDate.set(key, (byDate.get(key) ?? 0) + Number(row.total));
  }

  const result: SalesByDay[] = [];
  let cursor = new Date(rangeStart);
  while (cursor.getTime() < rangeEnd.getTime()) {
    const d = new Date(cursor.getTime() + offsetMs);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    result.push({ date: key, total: byDate.get(key) ?? 0 });
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return result;
}

// ─── getSalesByMonth ──────────────────────────────────────────────────────────

export async function getSalesByMonth(
  tenantId: string,
  year: number // Bangkok calendar year
): Promise<SalesByMonth[]> {
  const supabase = await createClient();
  const offsetMs = 7 * 60 * 60 * 1000;
  const yearStart = new Date(`${year}-01-01T00:00:00+07:00`);
  const yearEnd = new Date(`${year + 1}-01-01T00:00:00+07:00`);

  const { data } = await supabase
    .from("orders")
    .select("created_at, total")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .gte("created_at", yearStart.toISOString())
    .lt("created_at", yearEnd.toISOString());

  const byMonth = new Map<number, number>();
  for (const row of (data ?? []) as { created_at: string; total: number }[]) {
    const m = new Date(new Date(row.created_at).getTime() + offsetMs).getUTCMonth() + 1;
    byMonth.set(m, (byMonth.get(m) ?? 0) + Number(row.total));
  }

  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    total: byMonth.get(i + 1) ?? 0,
  }));
}

// ─── getHourlyPattern ─────────────────────────────────────────────────────────

export async function getHourlyPattern(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string    // "YYYY-MM-DD" Bangkok (inclusive)
): Promise<HourlyPattern[]> {
  const supabase = await createClient();
  const offsetMs = 7 * 60 * 60 * 1000;
  const rangeStart = new Date(`${startDate}T00:00:00+07:00`);
  const rangeEnd = new Date(`${endDate}T00:00:00+07:00`);
  rangeEnd.setTime(rangeEnd.getTime() + 24 * 60 * 60 * 1000);

  const { data } = await supabase
    .from("orders")
    .select("created_at, total")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .gte("created_at", rangeStart.toISOString())
    .lt("created_at", rangeEnd.toISOString());

  const byHour = new Map<number, number>();
  for (const row of (data ?? []) as { created_at: string; total: number }[]) {
    const h = new Date(new Date(row.created_at).getTime() + offsetMs).getUTCHours();
    byHour.set(h, (byHour.get(h) ?? 0) + Number(row.total));
  }

  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    total: byHour.get(h) ?? 0,
  }));
}

// ─── getSalesSummary ──────────────────────────────────────────────────────────

export async function getSalesSummary(
  tenantId: string,
  startDate: string, // "YYYY-MM-DD" Bangkok
  endDate: string    // "YYYY-MM-DD" Bangkok (inclusive)
): Promise<SalesSummary> {
  const supabase = await createClient();
  const rangeStart = new Date(`${startDate}T00:00:00+07:00`);
  const rangeEnd = new Date(`${endDate}T00:00:00+07:00`);
  rangeEnd.setTime(rangeEnd.getTime() + 24 * 60 * 60 * 1000);

  const { data } = await supabase
    .from("orders")
    .select("total")
    .eq("tenant_id", tenantId)
    .neq("status", "cancelled")
    .gte("created_at", rangeStart.toISOString())
    .lt("created_at", rangeEnd.toISOString());

  const rows = (data ?? []) as { total: number }[];
  return {
    totalSales: rows.reduce((sum, r) => sum + Number(r.total), 0),
    totalOrders: rows.length,
  };
}
```

- [ ] **Step 3: Extend `getSalesByCategory` ให้รับ `"year"`**

อ่าน `getSalesByCategory` ใน `src/lib/dal.ts` แล้วแก้ signature จาก:
```ts
  range: "day" | "week" | "month"
```
เป็น:
```ts
  range: "day" | "week" | "month" | "year"
```

จากนั้นหา if/else chain ที่คำนวณ `rangeStart` แล้วแก้ `} else {` (branch ของ "month") ให้เป็น:
```ts
  } else if (range === "month") {
    rangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    // year — ตั้งแต่ 1 ม.ค. ของปีนี้ตาม Bangkok time
    rangeStart = new Date(`${bangkokNow.getUTCFullYear()}-01-01T00:00:00+07:00`);
  }
```

- [ ] **Step 4: ตรวจสอบ TypeScript หลัง DAL changes**

```powershell
npx tsc --noEmit 2>&1
```

Expected: ไม่มี output

- [ ] **Step 5: สร้าง `src/components/dashboard/summary-cards.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SalesSummary } from "@/lib/dal";

const RANGE_LABELS: Record<string, string> = {
  day: "วันนี้",
  week: "7 วันล่าสุด",
  month: "30 วันล่าสุด",
  year: "ปีนี้",
};

export function SummaryCards({
  summary,
  range,
}: {
  summary: SalesSummary;
  range: string;
}) {
  const label = RANGE_LABELS[range] ?? "ช่วงนี้";
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            ยอดขาย{label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-sidebar tabular-nums">
            ฿
            {summary.totalSales.toLocaleString("th-TH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            จำนวนบิล{label}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-sidebar tabular-nums">
            {summary.totalOrders.toLocaleString("th-TH")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: สร้าง `src/components/dashboard/sales-trend-chart.tsx`**

```tsx
"use client";

import {
  ResponsiveContainer,
  LineChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import type { SalesByDay, SalesByMonth } from "@/lib/dal";

const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

type Props =
  | { range: "day"; data: { hour: number; total: number }[] }
  | { range: "week" | "month"; data: SalesByDay[] }
  | { range: "year"; data: SalesByMonth[] };

function formatDayLabel(dateStr: string): string {
  const parts = dateStr.split("-");
  return `${Number(parts[2] ?? "0")}/${Number(parts[1] ?? "0")}`;
}

const yFormatter = (v: number) =>
  v >= 1000 ? `฿${(v / 1000).toFixed(0)}k` : `฿${v.toFixed(0)}`;

const tooltipFormatter = (v: number) => [`฿${v.toFixed(2)}`, "ยอดขาย"] as [string, string];

export function SalesTrendChart(props: Props) {
  if (props.range === "day") {
    const chartData = props.data.map((d) => ({
      label: `${d.hour}:00`,
      total: d.total,
    }));
    return (
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={3} />
          <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={yFormatter} />
          <Tooltip formatter={tooltipFormatter} />
          <Line
            type="monotone"
            dataKey="total"
            stroke="var(--color-sidebar)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (props.range === "week" || props.range === "month") {
    const chartData = props.data.map((d) => ({
      label: formatDayLabel(d.date),
      total: d.total,
    }));
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            interval={props.range === "month" ? 4 : 0}
          />
          <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={yFormatter} />
          <Tooltip formatter={tooltipFormatter} />
          <Bar dataKey="total" fill="var(--color-sidebar)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // year
  const chartData = props.data.map((d) => ({
    label: THAI_MONTHS[d.month - 1] ?? String(d.month),
    total: d.total,
  }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={yFormatter} />
        <Tooltip formatter={tooltipFormatter} />
        <Bar dataKey="total" fill="var(--color-sidebar)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 7: สร้าง `src/components/dashboard/peak-hours-chart.tsx`**

```tsx
"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import type { HourlyPattern } from "@/lib/dal";

export function PeakHoursChart({ data }: { data: HourlyPattern[] }) {
  const peakHour = data.reduce<HourlyPattern>(
    (best, d) => (d.total > best.total ? d : best),
    { hour: 0, total: 0 }
  );

  const chartData = data.map((d) => ({
    label: String(d.hour),
    total: d.total,
    isPeak: d.hour === peakHour.hour && d.total > 0,
  }));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-sidebar">ช่วงเวลาที่ขายดี</h3>
        {peakHour.total > 0 && (
          <span className="text-xs font-medium text-accent">
            ดีที่สุด: {peakHour.hour}:00–{peakHour.hour + 1}:00
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            interval={2}
            tickFormatter={(h: string) => `${h}h`}
          />
          <YAxis hide />
          <Tooltip
            formatter={(v: number) => [`฿${v.toFixed(2)}`, "ยอดขาย"] as [string, string]}
            labelFormatter={(l: string) => `${l}:00`}
          />
          <Bar dataKey="total" radius={[2, 2, 0, 0]}>
            {chartData.map((entry, idx) => (
              <Cell
                key={idx}
                fill={entry.isPeak ? "var(--color-accent)" : "var(--color-sidebar)"}
                opacity={entry.total === 0 ? 0.2 : 0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 8: สร้าง `src/components/dashboard/category-performance-chart.tsx`**

```tsx
"use client";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";

const COLORS = [
  "var(--color-sidebar)",
  "var(--color-accent)",
  "#60a5fa",
  "#34d399",
  "#f472b6",
  "#a78bfa",
];

export function CategoryPerformanceChart({
  data,
}: {
  data: { category: string; total: number }[];
}) {
  const filtered = data.filter((d) => d.total > 0);

  if (filtered.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        ยังไม่มีข้อมูลการขายในช่วงนี้
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={filtered}
          dataKey="total"
          nameKey="category"
          cx="50%"
          cy="50%"
          outerRadius={80}
          innerRadius={40}
          paddingAngle={2}
        >
          {filtered.map((_, idx) => (
            <Cell key={idx} fill={COLORS[idx % COLORS.length] ?? "#6b7280"} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v: number) => [`฿${v.toFixed(2)}`, "ยอดขาย"] as [string, string]}
        />
        <Legend
          formatter={(value: string) => (
            <span className="text-xs text-sidebar">{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 9: สร้าง `src/components/dashboard/analytics-section.tsx`**

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SummaryCards } from "./summary-cards";
import { SalesTrendChart } from "./sales-trend-chart";
import { PeakHoursChart } from "./peak-hours-chart";
import { CategoryPerformanceChart } from "./category-performance-chart";
import type {
  SalesSummary,
  SalesByDay,
  SalesByMonth,
  HourlyPattern,
} from "@/lib/dal";

type Range = "day" | "week" | "month" | "year";

const RANGE_TABS: { value: Range; label: string }[] = [
  { value: "day", label: "วันนี้" },
  { value: "week", label: "7 วัน" },
  { value: "month", label: "30 วัน" },
  { value: "year", label: "ปีนี้" },
];

type Props = {
  range: Range;
  summary: SalesSummary;
  hourlyData: { hour: number; total: number }[] | null;
  dailyData: SalesByDay[] | null;
  monthlyData: SalesByMonth[] | null;
  peakHours: HourlyPattern[] | null;
  categoryData: { category: string; total: number }[];
};

export function AnalyticsSection({
  range,
  summary,
  hourlyData,
  dailyData,
  monthlyData,
  peakHours,
  categoryData,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setRange(r: Range) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", r);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      {/* Range Tabs */}
      <div className="flex gap-1 bg-muted rounded-lg p-1 w-fit">
        {RANGE_TABS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setRange(value)}
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
              range === value
                ? "bg-white text-sidebar shadow-sm"
                : "text-muted-foreground hover:text-sidebar"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      <SummaryCards summary={summary} range={range} />

      {/* Sales Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-sidebar">
            แนวโน้มยอดขาย
          </CardTitle>
        </CardHeader>
        <CardContent>
          {range === "day" && hourlyData !== null && (
            <SalesTrendChart range="day" data={hourlyData} />
          )}
          {(range === "week" || range === "month") && dailyData !== null && (
            <SalesTrendChart range={range} data={dailyData} />
          )}
          {range === "year" && monthlyData !== null && (
            <SalesTrendChart range="year" data={monthlyData} />
          )}
        </CardContent>
      </Card>

      {/* Peak Hours — week/month/year only */}
      {peakHours !== null && (
        <Card>
          <CardContent className="pt-4">
            <PeakHoursChart data={peakHours} />
          </CardContent>
        </Card>
      )}

      {/* Category Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-sidebar">
            ยอดขายตามหมวดหมู่
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CategoryPerformanceChart data={categoryData} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 10: Replace `src/app/(shell)/page.tsx` ทั้งหมด**

เขียนทับไฟล์ทั้งหมด:

```tsx
import { redirect } from "next/navigation";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  getProfile,
  getDashboardStats,
  getTopProducts,
  getLowStockAlerts,
  getSalesByHour,
  getSalesByDay,
  getSalesByMonth,
  getHourlyPattern,
  getSalesSummary,
  getSalesByCategory,
} from "@/lib/dal";
import type { DashboardStats } from "@/lib/dal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LowStockWidget } from "@/components/dashboard/low-stock-widget";
import { AnalyticsSection } from "@/components/dashboard/analytics-section";

function TrendBadge({
  today,
  yesterday,
}: {
  today: number;
  yesterday: number;
}) {
  if (today > yesterday)
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-green-600">
        <TrendingUp size={12} />
        ดีกว่าเมื่อวาน
      </span>
    );
  if (today < yesterday)
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-destructive">
        <TrendingDown size={12} />
        น้อยกว่าเมื่อวาน
      </span>
    );
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
          <TrendBadge today={stats.todayOrders} yesterday={stats.yesterdayOrders} />
        </CardContent>
      </Card>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const canViewStats = profile.role === "owner" || profile.role === "manager";

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

  const { range: rawRange } = await searchParams;
  const range: "day" | "week" | "month" | "year" =
    rawRange === "week" || rawRange === "month" || rawRange === "year"
      ? rawRange
      : "day";

  // Bangkok date strings ("YYYY-MM-DD")
  const offsetMs = 7 * 60 * 60 * 1000;
  const bangkokNow = new Date(new Date().getTime() + offsetMs);
  const todayStr = bangkokNow.toISOString().slice(0, 10);
  const bangkokYear = bangkokNow.getUTCFullYear();

  function daysAgoStr(n: number): string {
    return new Date(bangkokNow.getTime() - n * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  const startDate =
    range === "week"
      ? daysAgoStr(6)
      : range === "month"
      ? daysAgoStr(29)
      : range === "year"
      ? `${bangkokYear}-01-01`
      : todayStr;
  const endDate = todayStr;

  const [
    stats,
    topProducts,
    lowStockAlerts,
    summary,
    hourlyData,
    dailyData,
    monthlyData,
    peakHours,
    categoryData,
  ] = await Promise.all([
    getDashboardStats(profile.tenant_id),
    getTopProducts(profile.tenant_id, 5),
    getLowStockAlerts(profile.tenant_id),
    getSalesSummary(profile.tenant_id, startDate, endDate),
    range === "day"
      ? getSalesByHour(profile.tenant_id, todayStr)
      : Promise.resolve(null),
    range === "week" || range === "month"
      ? getSalesByDay(profile.tenant_id, startDate, endDate)
      : Promise.resolve(null),
    range === "year"
      ? getSalesByMonth(profile.tenant_id, bangkokYear)
      : Promise.resolve(null),
    range !== "day"
      ? getHourlyPattern(profile.tenant_id, startDate, endDate)
      : Promise.resolve(null),
    getSalesByCategory(profile.tenant_id, range),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">ภาพรวมของร้าน</p>
      </div>

      <StatCards stats={stats} />

      <LowStockWidget alerts={lowStockAlerts} />

      <AnalyticsSection
        range={range}
        summary={summary}
        hourlyData={hourlyData}
        dailyData={dailyData}
        monthlyData={monthlyData}
        peakHours={peakHours}
        categoryData={categoryData}
      />

      <div>
        <h2 className="text-base font-semibold text-sidebar mb-3">สินค้าขายดี</h2>
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
                  <p className="text-xs text-muted-foreground">{p.total_qty} ชิ้น</p>
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

- [ ] **Step 11: ตรวจสอบ TypeScript**

```powershell
npx tsc --noEmit 2>&1
```

Expected: ไม่มี output

- [ ] **Step 12: Commit**

```powershell
git add src/lib/dal.ts src/components/dashboard/ src/app/(shell)/page.tsx package.json package-lock.json
git commit -m "feat(dashboard): add Analytics Charts — SalesTrend, PeakHours, CategoryPie with range selector"
```

---

### Task 4: Pricing Calculator Widget

**Files:**
- Modify: `src/lib/dal.ts` (export `ProductCost` type + 2 new DAL helpers)
- Create: `src/app/actions/calculator.ts`
- Create: `src/components/dashboard/pricing-calculator.tsx`
- Modify: `src/app/(shell)/page.tsx` (patch — เพิ่ม imports + Promise.all + JSX)

**Interfaces:**
- Consumes (existing DAL): `getProductCost(productId: string): Promise<ProductCost>` where:
  ```ts
  export type ProductCost = {
    productId: string;
    ingredientCost: number;
    recipes: {
      materialName: string;
      unit: string;
      quantityUsed: number;
      costPerUnit: number;
      lineCost: number;
    }[];
  };
  ```
- Produces (new DAL helpers):
  ```ts
  export type CalcProduct = { id: string; name: string };
  export async function getProductsForCalculator(tenantId: string): Promise<CalcProduct[]>
  export async function getTenantDeliveryGp(tenantId: string): Promise<number>
  ```
- Produces: `export function PricingCalculator({ products, defaultDeliveryGp }: { products: CalcProduct[]; defaultDeliveryGp: number })` — "use client"

---

- [ ] **Step 1: Export `ProductCost` type + เพิ่ม 2 DAL helpers ใน `src/lib/dal.ts`**

อ่านบรรทัดรอบ `getProductCost` function ตรวจว่า `ProductCost` type ถูก export แล้วหรือยัง ถ้ายังให้เพิ่มก่อน function:

```ts
export type ProductCost = {
  productId: string;
  ingredientCost: number;
  recipes: {
    materialName: string;
    unit: string;
    quantityUsed: number;
    costPerUnit: number;
    lineCost: number;
  }[];
};
```

จากนั้น append ต่อท้ายไฟล์:

```ts
// ─── Calculator Helpers ───────────────────────────────────────────────────────

export type CalcProduct = { id: string; name: string };

export async function getProductsForCalculator(
  tenantId: string
): Promise<CalcProduct[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as CalcProduct[];
}

export async function getTenantDeliveryGp(tenantId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenants")
    .select("delivery_gp_percent")
    .eq("id", tenantId)
    .single();
  const row = data as { delivery_gp_percent: number | null } | null;
  return row?.delivery_gp_percent ?? 30;
}
```

- [ ] **Step 2: สร้าง `src/app/actions/calculator.ts`**

```ts
"use server";

import { getProductCost } from "@/lib/dal";
import type { ProductCost } from "@/lib/dal";

export async function fetchProductCost(productId: string): Promise<ProductCost> {
  return getProductCost(productId);
}
```

- [ ] **Step 3: สร้าง `src/components/dashboard/pricing-calculator.tsx`**

สูตรคำนวณ:
- `totalVariableCost = (ingredientCost + packagingCost) / (1 - wastePct/100)`
- `shopPrice = totalVariableCost / (1 - targetGpPct/100)`
- `deliveryPrice = totalVariableCost / (1 - deliveryGpPct/100)`
- `netProfitShop = shopPrice - totalVariableCost`
- `gpShop = (netProfitShop / shopPrice) × 100`

```tsx
"use client";

import { useState, useTransition } from "react";
import { Calculator } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchProductCost } from "@/app/actions/calculator";
import type { CalcProduct } from "@/lib/dal";

type CalcResult = {
  totalVariableCost: number;
  shopPrice: number;
  deliveryPrice: number;
  netProfitShop: number;
  gpShop: number;
};

function compute(
  ingredientCost: number,
  packagingCost: number,
  wastePct: number,
  targetGpPct: number,
  deliveryGpPct: number
): CalcResult | null {
  if (wastePct >= 100 || targetGpPct >= 100 || deliveryGpPct >= 100) return null;
  const totalVariableCost = (ingredientCost + packagingCost) / (1 - wastePct / 100);
  const shopPrice = totalVariableCost / (1 - targetGpPct / 100);
  const deliveryPrice = totalVariableCost / (1 - deliveryGpPct / 100);
  const netProfitShop = shopPrice - totalVariableCost;
  const gpShop = shopPrice > 0 ? (netProfitShop / shopPrice) * 100 : 0;
  return { totalVariableCost, shopPrice, deliveryPrice, netProfitShop, gpShop };
}

export function PricingCalculator({
  products,
  defaultDeliveryGp,
}: {
  products: CalcProduct[];
  defaultDeliveryGp: number;
}) {
  const [productId, setProductId] = useState("");
  const [ingredientCost, setIngredientCost] = useState<number | null>(null);
  const [packagingCost, setPackagingCost] = useState(0);
  const [wastePct, setWastePct] = useState(5);
  const [targetGpPct, setTargetGpPct] = useState(65);
  const [deliveryGpPct, setDeliveryGpPct] = useState(defaultDeliveryGp);
  const [isPending, startTransition] = useTransition();

  function handleProductChange(id: string) {
    setProductId(id);
    setIngredientCost(null);
    if (!id) return;
    startTransition(async () => {
      const cost = await fetchProductCost(id);
      setIngredientCost(cost.ingredientCost);
    });
  }

  const result =
    ingredientCost !== null
      ? compute(ingredientCost, packagingCost, wastePct, targetGpPct, deliveryGpPct)
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-sidebar flex items-center gap-2">
          <Calculator size={16} className="text-accent" />
          คำนวณราคาขาย
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Product */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">สินค้า</label>
          <select
            value={productId}
            onChange={(e) => handleProductChange(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-white px-3 text-sm text-sidebar focus:outline-none focus:ring-2 focus:ring-sidebar/30"
          >
            <option value="">— เลือกสินค้า —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Ingredient Cost readonly */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            ต้นทุนวัตถุดิบ (฿)
          </label>
          <div className="h-9 rounded-md border border-input bg-muted px-3 flex items-center text-sm tabular-nums text-sidebar">
            {isPending
              ? "กำลังโหลด..."
              : ingredientCost !== null
              ? `฿${ingredientCost.toFixed(2)}`
              : "—"}
          </div>
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              {
                label: "ต้นทุนแพ็กเกจจิ้ง (฿)",
                value: packagingCost,
                onChange: setPackagingCost,
                min: 0,
                step: "0.5",
              },
              {
                label: "% ของเสีย",
                value: wastePct,
                onChange: setWastePct,
                min: 0,
                max: 99,
                step: "1",
              },
              {
                label: "% GP เป้าหมาย",
                value: targetGpPct,
                onChange: setTargetGpPct,
                min: 1,
                max: 99,
                step: "1",
              },
              {
                label: "% GP เดลิเวอรี่",
                value: deliveryGpPct,
                onChange: setDeliveryGpPct,
                min: 1,
                max: 99,
                step: "1",
              },
            ] as const
          ).map(({ label, value, onChange, min, max, step }) => (
            <div key={label} className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                {label}
              </label>
              <input
                type="number"
                value={value}
                min={min}
                max={max}
                step={step}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full h-9 rounded-md border border-input bg-white px-3 text-sm tabular-nums text-sidebar focus:outline-none focus:ring-2 focus:ring-sidebar/30"
              />
            </div>
          ))}
        </div>

        {/* Result */}
        {result !== null && (
          <div className="rounded-lg border border-sidebar/20 bg-sidebar/5 p-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              ผลการคำนวณ
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <span className="text-muted-foreground">ต้นทุนรวม</span>
              <span className="font-medium text-sidebar tabular-nums text-right">
                ฿{result.totalVariableCost.toFixed(2)}
              </span>
              <span className="text-muted-foreground">ราคาแนะนำหน้าร้าน</span>
              <span className="font-bold text-sidebar tabular-nums text-right">
                ฿{result.shopPrice.toFixed(2)}
              </span>
              <span className="text-muted-foreground">ราคาเดลิเวอรี่</span>
              <span className="font-bold text-sidebar tabular-nums text-right">
                ฿{result.deliveryPrice.toFixed(2)}
              </span>
              <span className="text-muted-foreground">กำไรสุทธิ/หน่วย</span>
              <span className="font-bold text-accent tabular-nums text-right">
                ฿{result.netProfitShop.toFixed(2)}
              </span>
              <span className="text-muted-foreground">GP หน้าร้าน</span>
              <span className="font-semibold text-green-600 tabular-nums text-right">
                {result.gpShop.toFixed(1)}%
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Patch `src/app/(shell)/page.tsx` — เพิ่ม PricingCalculator**

อ่านไฟล์ (ผลลัพธ์จาก Task 3) แล้วแก้ 3 จุด:

**จุดที่ 1** — เพิ่ม imports ใน import block จาก `@/lib/dal`:
```tsx
import {
  getProfile,
  getDashboardStats,
  getTopProducts,
  getLowStockAlerts,
  getSalesByHour,
  getSalesByDay,
  getSalesByMonth,
  getHourlyPattern,
  getSalesSummary,
  getSalesByCategory,
  getProductsForCalculator,
  getTenantDeliveryGp,
} from "@/lib/dal";
```

เพิ่ม import component:
```tsx
import { PricingCalculator } from "@/components/dashboard/pricing-calculator";
```

**จุดที่ 2** — ขยาย `Promise.all` — เปลี่ยนจาก destructuring 9 ค่า เป็น 11 ค่า:
```tsx
  const [
    stats,
    topProducts,
    lowStockAlerts,
    summary,
    hourlyData,
    dailyData,
    monthlyData,
    peakHours,
    categoryData,
    calcProducts,
    defaultDeliveryGp,
  ] = await Promise.all([
    getDashboardStats(profile.tenant_id),
    getTopProducts(profile.tenant_id, 5),
    getLowStockAlerts(profile.tenant_id),
    getSalesSummary(profile.tenant_id, startDate, endDate),
    range === "day"
      ? getSalesByHour(profile.tenant_id, todayStr)
      : Promise.resolve(null),
    range === "week" || range === "month"
      ? getSalesByDay(profile.tenant_id, startDate, endDate)
      : Promise.resolve(null),
    range === "year"
      ? getSalesByMonth(profile.tenant_id, bangkokYear)
      : Promise.resolve(null),
    range !== "day"
      ? getHourlyPattern(profile.tenant_id, startDate, endDate)
      : Promise.resolve(null),
    getSalesByCategory(profile.tenant_id, range),
    getProductsForCalculator(profile.tenant_id),
    getTenantDeliveryGp(profile.tenant_id),
  ]);
```

**จุดที่ 3** — เพิ่ม `<PricingCalculator>` ใน JSX หลัง `<AnalyticsSection ... />`:
```tsx
      <PricingCalculator
        products={calcProducts}
        defaultDeliveryGp={defaultDeliveryGp}
      />
```

- [ ] **Step 5: ตรวจสอบ TypeScript**

```powershell
npx tsc --noEmit 2>&1
```

Expected: ไม่มี output

- [ ] **Step 6: Commit**

```powershell
git add src/lib/dal.ts src/app/actions/calculator.ts src/components/dashboard/pricing-calculator.tsx src/app/(shell)/page.tsx
git commit -m "feat(dashboard): add Pricing Calculator with ingredient cost lookup and GP formula"
```

- [ ] **Step 7: Push ไป GitHub**

```powershell
git push origin main
```

Expected: `main -> main` พร้อม commit hashes ใหม่
