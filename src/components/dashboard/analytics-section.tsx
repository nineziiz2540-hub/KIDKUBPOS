"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SummaryCards } from "./summary-cards";
import { SalesTrendChart } from "./sales-trend-chart";
import { PeakHoursChart } from "./peak-hours-chart";
import { CategoryPerformanceChart } from "./category-performance-chart";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import type {
  SalesSummary,
  SalesByDay,
  SalesByMonth,
  HourlyPattern,
} from "@/lib/dal";

type Range = "day" | "week" | "month" | "year" | "custom";

const RANGE_TABS: { value: Range; label: string }[] = [
  { value: "day", label: "วันนี้" },
  { value: "week", label: "7 วัน" },
  { value: "month", label: "30 วัน" },
  { value: "year", label: "ปีนี้" },
];

function formatShortDate(dateStr: string): string {
  const parts = dateStr.split("-");
  return `${Number(parts[2] ?? "0")}/${Number(parts[1] ?? "0")}`;
}

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
    router.replace(`?${params.toString()}`);
  }

  function setCustomRange(from: string, to: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", "custom");
    params.set("from", from);
    params.set("to", to);
    router.replace(`?${params.toString()}`);
  }

  const customFrom = searchParams.get("from");
  const customTo = searchParams.get("to");
  const customLabel =
    range === "custom" && customFrom && customTo
      ? `${formatShortDate(customFrom)} - ${formatShortDate(customTo)}`
      : "กำหนดเอง";

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
        <DateRangePicker
          active={range === "custom"}
          label={customLabel}
          onApply={setCustomRange}
        />
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
          {(range === "week" || range === "month" || range === "custom") && dailyData !== null && (
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
