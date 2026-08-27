import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendBadge } from "@/components/dashboard/trend-badge";
import type { CostProfitSummary } from "@/lib/dal";

export function CostProfitCard({
  current,
  previous,
  periodLabel,
}: {
  current: CostProfitSummary;
  previous?: CostProfitSummary;
  periodLabel?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              ต้นทุน{periodLabel ?? ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-2xl font-bold text-sidebar tabular-nums">
              ฿{current.totalCost.toFixed(2)}
            </p>
            {previous && (
              <TrendBadge
                current={current.totalCost}
                previous={previous.totalCost}
                higherIsBetter={false}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              กำไร{periodLabel ?? ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p
              className={`text-2xl font-bold tabular-nums ${
                current.profit >= 0 ? "text-sidebar" : "text-destructive"
              }`}
            >
              ฿{current.profit.toFixed(2)}
            </p>
            {previous && (
              <TrendBadge
                current={current.profit}
                previous={previous.profit}
                higherIsBetter={true}
              />
            )}
          </CardContent>
        </Card>
      </div>
      {(current.hasUnrecipedItems || previous?.hasUnrecipedItems) && (
        <p className="text-xs text-muted-foreground">
          มีสินค้าที่ยังไม่ได้ตั้งต้นทุนบางรายการ ตัวเลขอาจไม่ครบถ้วน
        </p>
      )}
    </div>
  );
}
