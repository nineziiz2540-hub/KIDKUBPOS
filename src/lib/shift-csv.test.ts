import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShiftCsv, type ShiftCsvRow } from "./shift-csv.ts";

const HEADER =
  "วันที่,เปิดกะ,เปิดโดย,ปิดกะ,ปิดโดย,เงินทอนเมื่อคืน,นับตอนเปิด,ขาด/เกินข้ามคืน,ขายเงินสด,ขายโอน,คืนเงินสด,เงินเข้า,เงินออก,ควรมี,นับตอนปิด,ส่วนต่าง,เก็บไว้ในลิ้นชัก,นำฝาก,หมายเหตุ";

function row(overrides: Partial<ShiftCsvRow> = {}): ShiftCsvRow {
  return {
    openedAt: "2026-10-21T02:00:00Z",
    openedBy: "สมชาย",
    closedAt: "2026-10-21T13:30:00Z",
    closedBy: "สมหญิง",
    lastNightFloat: 1000,
    openingCount: 1000,
    overnightDifference: 0,
    cashSales: 4250,
    transferSales: 3120,
    cashRefunds: 0,
    cashIn: 500,
    cashOut: 560,
    expected: 5190,
    closingCount: 5170,
    variance: -20,
    floatLeft: 1000,
    deposit: 4170,
    note: "",
    ...overrides,
  };
}

test("CSV starts with a BOM so Excel reads the Thai text", () => {
  assert.ok(buildShiftCsv([]).startsWith("﻿"));
});

test("CSV header is the agreed Thai column list", () => {
  const lines = buildShiftCsv([]).slice(1).split("\r\n");
  assert.equal(lines[0], HEADER);
});

test("CSV lines end with CRLF and money has 2 decimals, a short variance negative", () => {
  const csv = buildShiftCsv([row()]);
  assert.ok(csv.endsWith("\r\n"));
  const line = csv.slice(1).split("\r\n")[1];
  assert.equal(
    line,
    "2026-10-21,09:00,สมชาย,20:30,สมหญิง,1000.00,1000.00,0.00,4250.00,3120.00,0.00,500.00,560.00,5190.00,5170.00,-20.00,1000.00,4170.00,"
  );
});

test("CSV dates and times are Bangkok, even just after Bangkok midnight", () => {
  const csv = buildShiftCsv([row({ openedAt: "2026-10-20T17:30:00Z", closedAt: "2026-10-21T10:00:00Z" })]);
  const cells = csv.slice(1).split("\r\n")[1]!.split(",");
  assert.equal(cells[0], "2026-10-21");
  assert.equal(cells[1], "00:30");
  assert.equal(cells[3], "17:00");
});

test("CSV close time carries its date when the shift closes after midnight", () => {
  const csv = buildShiftCsv([row({ openedAt: "2026-10-21T03:00:00Z", closedAt: "2026-10-21T18:15:00Z" })]);
  const cells = csv.slice(1).split("\r\n")[1]!.split(",");
  assert.equal(cells[3], "2026-10-22 01:15");
});

test("CSV quotes notes with commas, quotes or new lines", () => {
  const csv = buildShiftCsv([row({ note: 'ทอนเกิน, ลูกค้า "โต๊ะ 3"\nแจ้งแล้ว' })]);
  assert.ok(csv.includes('"ทอนเกิน, ลูกค้า ""โต๊ะ 3""\nแจ้งแล้ว"\r\n'));
});

test("CSV neutralises typed text that Excel would run as a formula", () => {
  const csv = buildShiftCsv([row({ openedBy: "@แอบ", note: "=HYPERLINK(\"http://x\")" })]);
  const line = csv.slice(1).split("\r\n")[1]!;
  assert.ok(line.includes(",'@แอบ,"), line);
  assert.ok(line.endsWith(`,"'=HYPERLINK(""http://x"")"`), line);
  for (const lead of ["+", "-", "\t", "\r"]) {
    const c = buildShiftCsv([row({ note: `${lead}1` })]);
    assert.ok(c.includes(`'${lead}1`), JSON.stringify(lead));
  }
});

test("CSV keeps negative money as a plain number", () => {
  const line = buildShiftCsv([row({ variance: -20 })]).slice(1).split("\r\n")[1]!;
  assert.ok(line.includes(",-20.00,"), line);
});

test("CSV leaves missing values empty", () => {
  const csv = buildShiftCsv([
    row({ lastNightFloat: null, overnightDifference: null, closedAt: null, closedBy: "" }),
  ]);
  const cells = csv.slice(1).split("\r\n")[1]!.split(",");
  assert.equal(cells[3], "");
  assert.equal(cells[4], "");
  assert.equal(cells[5], "");
  assert.equal(cells[7], "");
});
