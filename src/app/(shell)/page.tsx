import { redirect } from "next/navigation";
import { Suspense } from "react";
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
  getCostProfit,
  getPaymentMethodBreakdown,
  getSalesQuantitySummary,
  getMenuProfitBreakdown,
} from "@/lib/dal";
import { CostProfitCard } from "@/components/dashboard/cost-profit-card";
import { PaymentMethodCard } from "@/components/dashboard/payment-method-card";
import { SalesQuantitySummary } from "@/components/dashboard/sales-quantity-summary";
import { MenuProfitTable } from "@/components/dashboard/menu-profit-table";
import { BestSellersList } from "@/components/dashboard/best-sellers-list";
import { SalesTrendChart } from "@/components/dashboard/sales-trend-chart";
import { CategoryPerformanceChart } from "@/components/dashboard/category-performance-chart";
import { LowStockWidget } from "@/components/dashboard/low-stock-widget";
import { AnalyticsSection } from "@/components/dashboard/analytics-section";
import { MfaRecoveredToastTrigger } from "@/components/auth/mfa-recovered-toast-trigger";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function TrendBadgeInline({ current, previous }: { current: number; previous: number }) {
  if (current > previous)
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-green-600">
        <TrendingUp size={12} />
        ดีกว่าเมื่อวาน
      </span>
    );
  if (current < previous)
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

function StatCards({
  todaySales,
  yesterdaySales,
  todayOrders,
  yesterdayOrders,
}: {
  todaySales: number;
  yesterdaySales: number;
  todayOrders: number;
  yesterdayOrders: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">ยอดขายวันนี้</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-2xl font-bold text-sidebar tabular-nums">฿{todaySales.toFixed(2)}</p>
          <TrendBadgeInline current={todaySales} previous={yesterdaySales} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">บิลวันนี้</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-2xl font-bold text-sidebar tabular-nums">{todayOrders}</p>
          <TrendBadgeInline current={todayOrders} previous={yesterdayOrders} />
        </CardContent>
      </Card>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; mfa_recovered?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const { range: rawRange, from: rawFrom, to: rawTo, mfa_recovered } = await searchParams;

  const canViewStats = profile.role === "owner" || profile.role === "manager";

  if (!canViewStats) {
    return (
      <div className="space-y-2">
        {mfa_recovered === "1" && <MfaRecoveredToastTrigger />}
        <h1 className="text-2xl font-bold text-sidebar">สวัสดี, {profile.full_name ?? "—"}</h1>
        <p className="text-sm text-muted-foreground">ยินดีต้อนรับสู่ KIDKUBPOS — เริ่มงานได้เลย!</p>
      </div>
    );
  }

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const hasValidCustomDates =
    typeof rawFrom === "string" &&
    typeof rawTo === "string" &&
    ISO_DATE.test(rawFrom) &&
    ISO_DATE.test(rawTo) &&
    rawFrom <= rawTo;
  const range: "week" | "month" | "year" | "custom" =
    rawRange === "month" || rawRange === "year"
      ? rawRange
      : rawRange === "custom" && hasValidCustomDates
        ? "custom"
        : "week";

  // Bangkok date strings ("YYYY-MM-DD")
  const offsetMs = 7 * 60 * 60 * 1000;
  const bangkokNow = new Date(new Date().getTime() + offsetMs);
  const todayStr = bangkokNow.toISOString().slice(0, 10);
  const bangkokYear = bangkokNow.getUTCFullYear();
  const bangkokMonth = bangkokNow.getUTCMonth() + 1;

  function daysAgoStr(n: number): string {
    return new Date(bangkokNow.getTime() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  const bangkokWeekday = bangkokNow.getUTCDay();
  const daysSinceMonday = bangkokWeekday === 0 ? 6 : bangkokWeekday - 1;
  const mondayOfThisWeekStr = daysAgoStr(daysSinceMonday);
  const firstOfThisMonthStr = `${bangkokYear}-${String(bangkokMonth).padStart(2, "0")}-01`;
  const yesterdayStr = daysAgoStr(1);

  const daysInMonthSoFar =
    Math.floor(
      (new Date(`${todayStr}T00:00:00+07:00`).getTime() -
        new Date(`${firstOfThisMonthStr}T00:00:00+07:00`).getTime()) /
        (24 * 60 * 60 * 1000)
    ) + 1;
  const daysInYearSoFar =
    Math.floor(
      (new Date(`${todayStr}T00:00:00+07:00`).getTime() -
        new Date(`${bangkokYear}-01-01T00:00:00+07:00`).getTime()) /
        (24 * 60 * 60 * 1000)
    ) + 1;
  const daysInCustomRange = (start: string, end: string) =>
    Math.floor(
      (new Date(`${end}T00:00:00+07:00`).getTime() - new Date(`${start}T00:00:00+07:00`).getTime()) /
        (24 * 60 * 60 * 1000)
    ) + 1;

  const startDate =
    range === "custom" && hasValidCustomDates
      ? (rawFrom as string)
      : range === "week"
        ? mondayOfThisWeekStr
        : range === "month"
          ? firstOfThisMonthStr
          : `${bangkokYear}-01-01`;
  const endDate = range === "custom" && hasValidCustomDates ? (rawTo as string) : todayStr;

  const daysInPeriod =
    range === "week"
      ? daysSinceMonday + 1
      : range === "month"
        ? daysInMonthSoFar
        : range === "custom" && hasValidCustomDates
          ? daysInCustomRange(startDate, endDate)
          : daysInYearSoFar;

  const [
    stats,
    todayTopProducts,
    lowStockAlerts,
    todayHourly,
    todayCategoryData,
    todayCostProfit,
    yesterdayCostProfit,
    paymentBreakdown,
    quantitySummary,
    summary,
    dailyData,
    monthlyData,
    peakHours,
    periodCategoryData,
    periodCostProfit,
    menuProfitRows,
    periodTopProducts,
  ] = await Promise.all([
    getDashboardStats(profile.tenant_id),
    getTopProducts(profile.tenant_id, todayStr, todayStr, 5),
    getLowStockAlerts(profile.tenant_id),
    getSalesByHour(profile.tenant_id, todayStr),
    getSalesByCategory(profile.tenant_id, todayStr, todayStr),
    getCostProfit(profile.tenant_id, todayStr, todayStr, 1),
    getCostProfit(profile.tenant_id, yesterdayStr, yesterdayStr, 1),
    getPaymentMethodBreakdown(profile.tenant_id, todayStr, todayStr),
    getSalesQuantitySummary(profile.tenant_id, todayStr, todayStr),
    getSalesSummary(profile.tenant_id, startDate, endDate),
    range === "week" || range === "month" || range === "custom"
      ? getSalesByDay(profile.tenant_id, startDate, endDate)
      : Promise.resolve(null),
    range === "year" ? getSalesByMonth(profile.tenant_id, bangkokYear) : Promise.resolve(null),
    getHourlyPattern(profile.tenant_id, startDate, endDate),
    getSalesByCategory(profile.tenant_id, startDate, endDate),
    getCostProfit(profile.tenant_id, startDate, endDate, daysInPeriod),
    getMenuProfitBreakdown(profile.tenant_id, startDate, endDate),
    getTopProducts(profile.tenant_id, startDate, endDate, 5),
  ]);

  return (
    <div className="space-y-6">
      {mfa_recovered === "1" && <MfaRecoveredToastTrigger />}
      <div>
        <h1 className="text-2xl font-bold text-sidebar">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">ภาพรวมของร้าน</p>
      </div>

      {/* ─── Part 1: วันนี้ ─────────────────────────────────────────────── */}

      <StatCards
        todaySales={stats.todaySales}
        yesterdaySales={stats.yesterdaySales}
        todayOrders={stats.todayOrders}
        yesterdayOrders={stats.yesterdayOrders}
      />

      <CostProfitCard current={todayCostProfit} previous={yesterdayCostProfit} />

      <PaymentMethodCard cash={paymentBreakdown.cash} transfer={paymentBreakdown.transfer} />

      <LowStockWidget alerts={lowStockAlerts} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-sidebar">แนวโน้มยอดขายวันนี้</CardTitle>
        </CardHeader>
        <CardContent>
          <SalesTrendChart range="day" data={todayHourly} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold text-sidebar">ยอดขายตามหมวดหมู่วันนี้</CardTitle>
        </CardHeader>
        <CardContent>
          <CategoryPerformanceChart data={todayCategoryData} />
        </CardContent>
      </Card>

      <SalesQuantitySummary rows={quantitySummary} />

      <div>
        <h2 className="text-base font-semibold text-sidebar mb-3">สินค้าขายดี TOP 5 วันนี้</h2>
        <BestSellersList products={todayTopProducts} />
      </div>

      {/* ─── Part 2: ช่วงเวลาที่เลือก ───────────────────────────────────── */}

      <Suspense fallback={null}>
        <AnalyticsSection
          range={range}
          summary={summary}
          dailyData={dailyData}
          monthlyData={monthlyData}
          peakHours={peakHours}
          categoryData={periodCategoryData}
        />
      </Suspense>

      <CostProfitCard current={periodCostProfit} />

      <MenuProfitTable rows={menuProfitRows} />

      <div>
        <h2 className="text-base font-semibold text-sidebar mb-3">สินค้าขายดี TOP 5</h2>
        <BestSellersList products={periodTopProducts} />
      </div>
    </div>
  );
}
