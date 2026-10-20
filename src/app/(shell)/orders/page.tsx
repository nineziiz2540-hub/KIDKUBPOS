import Link from "next/link";
import { redirect } from "next/navigation";
import { findOrdersByNumber, getOrdersForDay, getProfile } from "@/lib/dal";
import { bangkokToday, formatDayLabel } from "@/lib/bangkok-time";
import {
  filterRows,
  formatBaht,
  historyHref,
  matchQueue,
  parseHistoryParams,
  searchKind,
  summarizeDay,
  type HistoryRow as Row,
} from "@/lib/order-history";
import { DayNav } from "@/components/orders/day-nav";
import { HistorySearch } from "@/components/orders/history-search";
import { HistoryChips } from "@/components/orders/history-chips";
import { DaySummary } from "@/components/orders/day-summary";
import { HistoryRow } from "@/components/orders/history-row";
import { TransferCheckToggle } from "@/components/orders/transfer-check-toggle";

type Props = {
  searchParams: Promise<{ date?: string; filter?: string; q?: string }>;
};

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border bg-white px-4 py-12 text-center text-base text-muted-foreground">
      {children}
    </p>
  );
}

export default async function OrdersPage({ searchParams }: Props) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const today = bangkokToday();
  const view = parseHistoryParams(await searchParams, today);
  const { date, filter, q } = view;
  const currentHref = historyHref(view, today);
  const detailHref = (id: string) => `/orders/${id}?back=${encodeURIComponent(currentHref)}`;
  const canCheckTransfers = profile.role === "owner" || profile.role === "manager";
  const kind = searchKind(q);

  const header = (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] font-bold leading-tight text-sidebar">ประวัติบิล</h1>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DayNav
          date={date}
          today={today}
          filter={filter}
          q={q}
          label={formatDayLabel(date, today)}
        />
        <HistorySearch date={date} today={today} filter={filter} q={q} />
      </div>
    </div>
  );

  if (kind === "bill") {
    const found = await findOrdersByNumber(profile.tenant_id, q);
    return (
      <div className="space-y-5">
        {header}
        <p className="text-base text-muted-foreground">
          ผลค้นหาเลขบิล “{q}” ทุกวัน ({found.length} บิล)
        </p>
        {found.length === 0 ? (
          <EmptyState>ไม่พบเลขบิล “{q}”</EmptyState>
        ) : (
          <div className="divide-y divide-border rounded-xl border bg-white">
            {found.map((row) => (
              <HistoryRow key={row.id} row={row} href={detailHref(row.id)} showDate />
            ))}
          </div>
        )}
      </div>
    );
  }

  const dayRows = await getOrdersForDay(profile.tenant_id, date);
  const summary = summarizeDay(dayRows);
  let rows: Row[] = filterRows(dayRows, filter);
  if (kind === "queue") rows = matchQueue(rows, q);
  const isTransferView = filter === "transfer";

  return (
    <div className="space-y-5">
      {header}
      <HistoryChips date={date} today={today} filter={filter} q={q} counts={summary.counts} />
      <DaySummary summary={summary} />

      {isTransferView && summary.transferTotal > 0 && (
        <div className="space-y-1 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
          <p className="text-base font-semibold text-success">
            ตรวจยอดโอนแล้ว {summary.transferChecked} จาก {summary.transferTotal} บิล · เหลือ{" "}
            {summary.transferTotal - summary.transferChecked} บิล
          </p>
          {summary.refundedTransfer.count > 0 && (
            <p className="text-[15px] text-muted-foreground">
              บิลโอนที่คืนเงินแล้ววันนี้ {summary.refundedTransfer.count} บิล ฿
              {formatBaht(summary.refundedTransfer.total)} (เงินเคยเข้าบัญชี)
            </p>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState>
          {kind === "queue"
            ? `ไม่พบคิว ${q} ในวันที่เลือก`
            : dayRows.length === 0
              ? "ไม่มีบิลในวันที่เลือก"
              : "ไม่มีบิลในหมวดนี้"}
        </EmptyState>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border bg-white">
          {rows.map((row) => (
            <HistoryRow
              key={row.id}
              row={row}
              href={detailHref(row.id)}
              highlight={isTransferView && !row.transferVerified}
              action={
                isTransferView ? (
                  <TransferCheckToggle
                    orderId={row.id}
                    verified={row.transferVerified}
                    canEdit={canCheckTransfers}
                  />
                ) : undefined
              }
            />
          ))}
        </div>
      )}

      {kind === "queue" && (
        <p className="text-center">
          <Link
            href={historyHref({ date, filter, q: "" }, today)}
            className="text-base font-medium text-accent hover:underline"
          >
            ล้างการค้นหา ดูบิลทั้งหมดของวันที่เลือก
          </Link>
        </p>
      )}
    </div>
  );
}
