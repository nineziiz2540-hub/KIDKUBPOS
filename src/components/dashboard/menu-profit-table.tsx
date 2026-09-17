"use client";
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MenuProfitRow } from "@/lib/dal";

function ProfitTableRows({ rows }: { rows: MenuProfitRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground border-b">
          <th className="py-2 font-medium">เมนู</th>
          <th className="py-2 font-medium text-right">จำนวน</th>
          <th className="py-2 font-medium text-right">รายได้</th>
          <th className="py-2 font-medium text-right">ต้นทุน</th>
          <th className="py-2 font-medium text-right">กำไร</th>
          <th className="py-2 font-medium text-right">%กำไร</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r) => (
          <tr key={r.productName}>
            <td className="py-2 text-sidebar font-medium truncate max-w-[140px]">{r.productName}</td>
            <td className="py-2 text-right tabular-nums text-muted-foreground">
              {r.qty} {r.unit}
            </td>
            <td className="py-2 text-right tabular-nums text-sidebar">฿{r.revenue.toFixed(2)}</td>
            <td className="py-2 text-right tabular-nums text-muted-foreground">฿{r.cost.toFixed(2)}</td>
            <td
              className={`py-2 text-right tabular-nums font-semibold ${
                r.profit >= 0 ? "text-sidebar" : "text-destructive"
              }`}
            >
              ฿{r.profit.toFixed(2)}
            </td>
            <td className="py-2 text-right tabular-nums text-success font-medium">
              {r.gpPercent.toFixed(1)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MenuProfitTable({ rows }: { rows: MenuProfitRow[] }) {
  const [open, setOpen] = useState(false);
  const top5 = rows.slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold text-sidebar">กำไรต่อเมนู</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">ยังไม่มีข้อมูลการขาย</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <ProfitTableRows rows={top5} />
            </div>
            {rows.length > 5 && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="mt-3 text-sm text-accent hover:underline"
              >
                ดูทั้งหมด ({rows.length} เมนู)
              </button>
            )}
          </>
        )}
      </CardContent>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/50 z-40" />
          <Dialog.Popup
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={(e) => {
              // The popup itself fills the screen (needed to center its content), so a click
              // anywhere in that empty space is technically "inside" it from base-ui's
              // perspective and never counts as an outside press — this is the fix for that:
              // only close when the click lands on the popup element itself, not a descendant.
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div className="w-full max-w-2xl max-h-[80vh] flex flex-col bg-white rounded-2xl shadow-xl">
              <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
                <Dialog.Title className="font-bold text-sidebar text-base">
                  กำไรต่อเมนู — ทั้งหมด ({rows.length} เมนู)
                </Dialog.Title>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="ปิด"
                  className="rounded-full p-1 text-muted-foreground hover:text-sidebar hover:bg-muted transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="overflow-y-auto overflow-x-auto px-5 py-4">
                <ProfitTableRows rows={rows} />
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </Card>
  );
}
