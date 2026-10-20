// Pure logic behind ประวัติบิล (order history): URL params, chip filters, the day summary used
// to reconcile against the bank app, and queue/bill search. No "@/" imports so `node --test`
// can load it directly.

import { isValidDateString } from "./bangkok-time.ts";

export type HistoryFilter = "all" | "cash" | "transfer" | "reversed" | "unpaid";

export const HISTORY_FILTERS: HistoryFilter[] = ["all", "cash", "transfer", "reversed", "unpaid"];

export type HistoryRow = {
  id: string;
  orderNumber: string | null;
  queueNumber: number | null;
  paymentMethod: string;
  status: string;
  total: number;
  createdAt: string;
  transferVerified: boolean;
  itemNames: string[];
};

export type DaySummary = {
  counts: Record<HistoryFilter, number>;
  netSales: number;
  cash: number;
  transfer: number;
  unpaid: number;
  transferChecked: number;
  transferTotal: number;
  refundedTransfer: { count: number; total: number };
};

export function parseHistoryParams(
  sp: { date?: string; filter?: string; q?: string },
  today: string
): { date: string; filter: HistoryFilter; q: string } {
  const date =
    sp.date && isValidDateString(sp.date) && sp.date <= today ? sp.date : today;
  const filter = HISTORY_FILTERS.includes(sp.filter as HistoryFilter)
    ? (sp.filter as HistoryFilter)
    : "all";
  return { date, filter, q: (sp.q ?? "").trim() };
}

/** /orders URL for a view; today, "all" and an empty search are the defaults and stay out. */
export function historyHref(
  view: { date: string; filter: HistoryFilter; q: string },
  today: string
): string {
  const params = new URLSearchParams();
  if (view.date !== today) params.set("date", view.date);
  if (view.filter !== "all") params.set("filter", view.filter);
  if (view.q !== "") params.set("q", view.q);
  const qs = params.toString();
  return qs ? `/orders?${qs}` : "/orders";
}

function inFilter(row: HistoryRow, filter: HistoryFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "cash":
    case "transfer":
      return row.status === "completed" && row.paymentMethod === filter;
    case "reversed":
      return row.status === "cancelled" || row.status === "refunded";
    case "unpaid":
      return row.status === "unpaid";
  }
}

export function filterRows(rows: HistoryRow[], filter: HistoryFilter): HistoryRow[] {
  return rows.filter((r) => inFilter(r, filter));
}

// Money is summed in satang so a day of 0.1-baht steps can't drift.
function sumBaht(rows: HistoryRow[]): number {
  return rows.reduce((cents, r) => cents + Math.round(Number(r.total) * 100), 0) / 100;
}

export function summarizeDay(rows: HistoryRow[]): DaySummary {
  const counts = Object.fromEntries(
    HISTORY_FILTERS.map((f) => [f, filterRows(rows, f).length])
  ) as Record<HistoryFilter, number>;
  const cashRows = filterRows(rows, "cash");
  const transferRows = filterRows(rows, "transfer");
  const refundedTransferRows = rows.filter(
    (r) => r.status === "refunded" && r.paymentMethod === "transfer"
  );
  return {
    counts,
    netSales: sumBaht([...cashRows, ...transferRows]),
    cash: sumBaht(cashRows),
    transfer: sumBaht(transferRows),
    unpaid: sumBaht(filterRows(rows, "unpaid")),
    transferChecked: transferRows.filter((r) => r.transferVerified).length,
    transferTotal: transferRows.length,
    refundedTransfer: { count: refundedTransferRows.length, total: sumBaht(refundedTransferRows) },
  };
}

/** Up to 4 digits = a queue number within the day; anything else = a bill number. */
export function searchKind(q: string): "none" | "queue" | "bill" {
  if (q === "") return "none";
  return /^\d{1,4}$/.test(q) ? "queue" : "bill";
}

export function matchQueue(rows: HistoryRow[], q: string): HistoryRow[] {
  const n = Number(q);
  return rows.filter((r) => r.queueNumber === n);
}

/** 5,230 · 85.50 — grouped, with satang only when the amount has some. */
export function formatBaht(baht: number): string {
  const cents = Math.round(baht * 100);
  const digits = cents % 100 === 0 ? 0 : 2;
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function itemSummary(names: string[], max = 2): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max}`;
}
