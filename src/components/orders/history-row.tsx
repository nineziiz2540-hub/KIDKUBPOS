import Link from "next/link";
import type { ReactNode } from "react";
import { formatDate, formatTime } from "@/lib/bangkok-time";
import { formatBaht, itemSummary, type HistoryRow as Row } from "@/lib/order-history";

const PAYMENT_LABELS: Record<string, string> = { cash: "เงินสด", transfer: "โอน" };

function Badge({ status, paymentMethod }: { status: string; paymentMethod: string }) {
  const base = "inline-flex h-7 items-center rounded-full px-3 text-sm font-semibold";
  switch (status) {
    case "cancelled":
      return <span className={`${base} bg-destructive/10 text-destructive`}>ยกเลิก</span>;
    case "refunded":
      return <span className={`${base} bg-warning/10 text-warning`}>คืนเงิน</span>;
    case "unpaid":
      return <span className={`${base} bg-destructive text-white`}>ไม่ได้รับเงิน</span>;
    default:
      return (
        <span className={`${base} bg-muted text-muted-foreground`}>
          {PAYMENT_LABELS[paymentMethod] ?? paymentMethod}
        </span>
      );
  }
}

type Props = {
  row: Row;
  href: string;
  /** Bill-number search spans days, so it shows the date as well. */
  showDate?: boolean;
  highlight?: boolean;
  action?: ReactNode;
};

export function HistoryRow({ row, href, showDate = false, highlight = false, action }: Props) {
  const title = row.queueNumber !== null ? `คิว ${row.queueNumber}` : (row.orderNumber ?? "—");
  return (
    <div className={`flex min-h-16 items-center gap-3 px-4 py-2 ${highlight ? "bg-warning/5" : ""}`}>
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-4 py-1">
        <span className="w-[68px] shrink-0">
          <span className="block text-xl font-bold tabular-nums text-sidebar">
            {formatTime(row.createdAt)}
          </span>
          {showDate && (
            <span className="block text-sm text-muted-foreground">{formatDate(row.createdAt)}</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-semibold text-sidebar">{title}</span>
            <Badge status={row.status} paymentMethod={row.paymentMethod} />
          </span>
          <span className="block truncate text-[15px] text-muted-foreground">
            {itemSummary(row.itemNames) || row.orderNumber}
          </span>
        </span>
        <span className="shrink-0 text-lg font-bold tabular-nums text-sidebar">
          ฿{formatBaht(row.total)}
        </span>
      </Link>
      {action}
    </div>
  );
}
