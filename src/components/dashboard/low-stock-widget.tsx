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
