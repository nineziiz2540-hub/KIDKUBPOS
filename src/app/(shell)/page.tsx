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
  getProductsForCalculator,
  getTenantDeliveryGp,
} from "@/lib/dal";
import type { DashboardStats } from "@/lib/dal";
import { PricingCalculator } from "@/components/dashboard/pricing-calculator";
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

      <PricingCalculator
        products={calcProducts}
        defaultDeliveryGp={defaultDeliveryGp}
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
