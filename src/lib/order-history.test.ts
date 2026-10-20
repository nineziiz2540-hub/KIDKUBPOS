import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterRows,
  formatBaht,
  historyHref,
  itemSummary,
  matchQueue,
  parseHistoryParams,
  searchKind,
  summarizeDay,
  type HistoryRow,
} from "./order-history.ts";

function row(
  id: string,
  status: string,
  paymentMethod: string,
  total: number,
  extra: Partial<HistoryRow> = {}
): HistoryRow {
  return {
    id,
    orderNumber: `TCB.${id}`,
    queueNumber: null,
    paymentMethod,
    status,
    total,
    createdAt: "2026-10-20T05:00:00Z",
    transferVerified: false,
    itemNames: [],
    ...extra,
  };
}

const day: HistoryRow[] = [
  row("1", "completed", "cash", 100, { queueNumber: 3 }),
  row("2", "completed", "cash", 50),
  row("3", "completed", "transfer", 85, { transferVerified: true, queueNumber: 27 }),
  row("4", "completed", "transfer", 60),
  row("5", "refunded", "transfer", 85),
  row("6", "cancelled", "cash", 40),
  row("7", "unpaid", "transfer", 65),
];

test("summarizeDay counts each chip and splits the money the way the owner reconciles", () => {
  const s = summarizeDay(day);
  assert.deepEqual(s.counts, { all: 7, cash: 2, transfer: 2, reversed: 2, unpaid: 1 });
  assert.equal(s.netSales, 295);
  assert.equal(s.cash, 150);
  assert.equal(s.transfer, 145);
  assert.equal(s.unpaid, 65);
  assert.equal(s.transferChecked, 1);
  assert.equal(s.transferTotal, 2);
  assert.deepEqual(s.refundedTransfer, { count: 1, total: 85 });
});

test("summarizeDay of an empty day is all zeros", () => {
  const s = summarizeDay([]);
  assert.deepEqual(s.counts, { all: 0, cash: 0, transfer: 0, reversed: 0, unpaid: 0 });
  assert.equal(s.netSales, 0);
  assert.deepEqual(s.refundedTransfer, { count: 0, total: 0 });
});

test("filterRows keeps only completed bills in the cash and transfer views", () => {
  assert.deepEqual(filterRows(day, "cash").map((r) => r.id), ["1", "2"]);
  assert.deepEqual(filterRows(day, "transfer").map((r) => r.id), ["3", "4"]);
  assert.deepEqual(filterRows(day, "reversed").map((r) => r.id), ["5", "6"]);
  assert.deepEqual(filterRows(day, "unpaid").map((r) => r.id), ["7"]);
  assert.equal(filterRows(day, "all").length, 7);
});

test("parseHistoryParams falls back to today and the all view on bad input", () => {
  assert.deepEqual(parseHistoryParams({ date: "2026-02-30", filter: "x" }, "2026-10-20"), {
    date: "2026-10-20",
    filter: "all",
    q: "",
  });
  assert.deepEqual(
    parseHistoryParams({ date: "2026-10-18", filter: "transfer", q: "  27 " }, "2026-10-20"),
    { date: "2026-10-18", filter: "transfer", q: "27" }
  );
});

test("parseHistoryParams never opens a future day", () => {
  assert.equal(parseHistoryParams({ date: "2026-10-21" }, "2026-10-20").date, "2026-10-20");
});

test("searchKind treats short digit strings as queue numbers and anything else as a bill number", () => {
  assert.equal(searchKind(""), "none");
  assert.equal(searchKind("27"), "queue");
  assert.equal(searchKind("TCB.123"), "bill");
  assert.equal(searchKind("12345"), "bill");
});

test("matchQueue finds the bill with that queue number only", () => {
  assert.deepEqual(matchQueue(day, "27").map((r) => r.id), ["3"]);
  assert.deepEqual(matchQueue(day, "99"), []);
});

test("historyHref leaves defaults out of the URL", () => {
  const today = "2026-10-20";
  assert.equal(historyHref({ date: today, filter: "all", q: "" }, today), "/orders");
  assert.equal(historyHref({ date: today, filter: "transfer", q: "" }, today), "/orders?filter=transfer");
  assert.equal(
    historyHref({ date: "2026-10-19", filter: "transfer", q: "27" }, today),
    "/orders?date=2026-10-19&filter=transfer&q=27"
  );
});

test("formatBaht groups thousands and shows satang only when there are some", () => {
  assert.equal(formatBaht(5230), "5,230");
  assert.equal(formatBaht(85.5), "85.50");
  assert.equal(formatBaht(0), "0");
  assert.equal(formatBaht(1234.05), "1,234.05");
});

test("itemSummary shows the first items and how many more", () => {
  assert.equal(itemSummary(["ลาเต้เย็น", "ครัวซองต์"]), "ลาเต้เย็น, ครัวซองต์");
  assert.equal(
    itemSummary(["ลาเต้เย็น", "ครัวซองต์", "โกโก้", "มัทฉะ"]),
    "ลาเต้เย็น, ครัวซองต์ +2"
  );
  assert.equal(itemSummary([]), "");
});
