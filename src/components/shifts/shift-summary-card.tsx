import type { ShiftTotals } from "@/lib/dal";
import { formatMoney } from "@/lib/shift-math";

/**
 * Live drawer summary of the open shift. Rendered for owner and manager only — staff must never
 * receive these numbers before their own closing count, so the page doesn't even fetch them for
 * staff.
 */
export function ShiftSummaryCard({ totals }: { totals: ShiftTotals }) {
  const baht = formatMoney;
  const lines = [
    { label: "เงินตั้งต้น", value: baht(totals.openingCash) },
    { label: "ขายเงินสด", value: baht(totals.cashSales) },
    { label: "คืนเงินสด", value: totals.cashRefunds > 0 ? `−${baht(totals.cashRefunds)}` : baht(0) },
    { label: "เงินเข้า / ออก", value: `+${baht(totals.cashIn)} / −${baht(totals.cashOut)}` },
    { label: "ขายโอน", value: baht(totals.transferSales) },
    { label: "จำนวนบิล", value: String(totals.orderCount) },
  ];
  return (
    <section className="space-y-3 rounded-2xl border bg-white p-5">
      <h2 className="text-lg font-bold text-sidebar">สรุปกะนี้</h2>
      <dl className="space-y-1.5">
        {lines.map((l) => (
          <div key={l.label} className="flex justify-between gap-3 text-base">
            <dt className="text-muted-foreground">{l.label}</dt>
            <dd className="font-semibold tabular-nums text-sidebar">{l.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-baseline justify-between gap-3 border-t pt-3">
        <p className="text-base font-semibold text-sidebar">เงินสดที่ควรมีในลิ้นชัก</p>
        <p className="text-[22px] font-bold tabular-nums text-sidebar">
          {baht(totals.expectedCash)}
        </p>
      </div>
    </section>
  );
}
