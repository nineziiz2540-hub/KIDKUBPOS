import Link from "next/link";
import type { MaterialHistoryRow } from "@/lib/dal";
import { ledgerLine } from "@/lib/stock/material-view";

/** ประวัติสต๊อก: last 50 rows, plain Thai. Presentational (no client state). */
export function MaterialHistory({
  name,
  unit,
  rows,
}: {
  name: string;
  unit: string;
  rows: MaterialHistoryRow[];
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-sidebar">ประวัติสต๊อก: {name}</h2>
        <Link
          href="/inventory"
          className="inline-flex h-14 items-center rounded-lg border border-border px-5 text-base font-medium hover:bg-muted"
        >
          ปิด
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">ยังไม่มีประวัติ</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const line = ledgerLine(r, unit);
            return (
              <li key={r.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-sidebar">{line.title}</p>
                  <p className="text-xs text-muted-foreground">{line.when}</p>
                </div>
                <p
                  className={`shrink-0 text-base font-semibold ${
                    r.quantity < 0 ? "text-destructive" : "text-success"
                  }`}
                >
                  {line.qty}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length === 50 && (
        <p className="text-xs text-muted-foreground">แสดง 50 รายการล่าสุด</p>
      )}
    </div>
  );
}
