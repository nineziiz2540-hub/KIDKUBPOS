import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CostProfitSummary } from "@/lib/dal";

function TrendBadge({ current, previous }: { current: number; previous: number }) {
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

export function CostProfitCard({
  current,
  previous,
}: {
  current: CostProfitSummary;
  previous?: CostProfitSummary;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">ต้นทุน</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-2xl font-bold text-sidebar tabular-nums">
              ฿{current.totalCost.toFixed(2)}
            </p>
            {previous && <TrendBadge current={previous.totalCost} previous={current.totalCost} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">กำไร</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p
              className={`text-2xl font-bold tabular-nums ${
                current.profit >= 0 ? "text-sidebar" : "text-destructive"
              }`}
            >
              ฿{current.profit.toFixed(2)}
            </p>
            {previous && <TrendBadge current={current.profit} previous={previous.profit} />}
          </CardContent>
        </Card>
      </div>
      {current.hasUnrecipedItems && (
        <p className="text-xs text-muted-foreground">
          มีสินค้าที่ยังไม่ได้ตั้งต้นทุนบางรายการ ตัวเลขอาจไม่ครบถ้วน
        </p>
      )}
    </div>
  );
}
