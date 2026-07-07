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
