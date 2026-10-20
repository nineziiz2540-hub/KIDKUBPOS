import { formatBaht, type DaySummary as Summary } from "@/lib/order-history";

export function DaySummary({ summary }: { summary: Summary }) {
  const tiles = [
    { label: "ยอดขายสุทธิ", value: summary.netSales, warn: false },
    { label: "เงินสด", value: summary.cash, warn: false },
    { label: "โอน", value: summary.transfer, warn: false },
    { label: "ไม่ได้รับเงิน", value: summary.unpaid, warn: summary.unpaid > 0 },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className={`rounded-xl border bg-white px-4 py-3 ${t.warn ? "border-destructive/40" : ""}`}
        >
          <p
            className={`text-[22px] font-bold tabular-nums leading-tight ${
              t.warn ? "text-destructive" : "text-sidebar"
            }`}
          >
            ฿{formatBaht(t.value)}
          </p>
          <p className="text-[15px] text-muted-foreground">{t.label}</p>
        </div>
      ))}
    </div>
  );
}
