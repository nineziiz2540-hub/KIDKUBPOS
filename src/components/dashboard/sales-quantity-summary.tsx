import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CategoryQty } from "@/lib/dal";

export function SalesQuantitySummary({ rows }: { rows: CategoryQty[] }) {
  const totals = rows.reduce(
    (acc, r) => {
      if (r.unit === "แก้ว") acc.cups += r.qty;
      else if (r.unit === "ชิ้น") acc.pieces += r.qty;
      else acc.bottles += r.qty;
      return acc;
    },
    { cups: 0, pieces: 0, bottles: 0 }
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-sidebar">สรุปจำนวนขาย</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">ยังไม่มีข้อมูลการขาย</p>
        ) : (
          <>
            <div className="divide-y divide-border rounded-md border bg-white overflow-hidden">
              {rows.map((r) => (
                <div key={r.category} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm font-medium text-sidebar truncate">{r.category}</span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {r.qty} {r.unit}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-sm font-semibold text-sidebar tabular-nums">
              รวมวันนี้: {totals.cups} แก้ว, {totals.pieces} ชิ้น, {totals.bottles} ขวด
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
