// Monthly shift export (ส่งออกไฟล์ Excel). One row per closed shift, Bangkok dates and times,
// UTF-8 with a BOM and CRLF line ends so Excel opens the Thai text correctly. Kept free of "@/"
// imports so `node --test` can load it directly.

import { bangkokToday, formatTime } from "./bangkok-time.ts";

export type ShiftCsvRow = {
  openedAt: string;
  openedBy: string;
  closedAt: string | null;
  closedBy: string;
  lastNightFloat: number | null;
  openingCount: number;
  overnightDifference: number | null;
  cashSales: number | null;
  transferSales: number | null;
  cashRefunds: number | null;
  cashIn: number | null;
  cashOut: number | null;
  expected: number | null;
  closingCount: number | null;
  variance: number | null;
  floatLeft: number | null;
  deposit: number | null;
  note: string;
};

const HEADER = [
  "วันที่",
  "เปิดกะ",
  "เปิดโดย",
  "ปิดกะ",
  "ปิดโดย",
  "เงินทอนเมื่อคืน",
  "นับตอนเปิด",
  "ขาด/เกินข้ามคืน",
  "ขายเงินสด",
  "ขายโอน",
  "คืนเงินสด",
  "เงินเข้า",
  "เงินออก",
  "ควรมี",
  "นับตอนปิด",
  "ส่วนต่าง",
  "เก็บไว้ในลิ้นชัก",
  "นำฝาก",
  "หมายเหตุ",
];

function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Typed text (names, notes) that starts like a formula is prefixed with ' so Excel shows it
 * instead of running it — staff write the notes and the owner opens the file.
 */
function text(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function money(value: number | null): string {
  return value === null ? "" : value.toFixed(2);
}

function bangkokDate(iso: string): string {
  return bangkokToday(new Date(iso));
}

export function buildShiftCsv(rows: ShiftCsvRow[]): string {
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    const openedDate = bangkokDate(r.openedAt);
    let closed = "";
    if (r.closedAt) {
      const closedDate = bangkokDate(r.closedAt);
      closed =
        closedDate === openedDate ? formatTime(r.closedAt) : `${closedDate} ${formatTime(r.closedAt)}`;
    }
    lines.push(
      [
        openedDate,
        formatTime(r.openedAt),
        text(r.openedBy),
        closed,
        text(r.closedBy),
        money(r.lastNightFloat),
        money(r.openingCount),
        money(r.overnightDifference),
        money(r.cashSales),
        money(r.transferSales),
        money(r.cashRefunds),
        money(r.cashIn),
        money(r.cashOut),
        money(r.expected),
        money(r.closingCount),
        money(r.variance),
        money(r.floatLeft),
        money(r.deposit),
        text(r.note),
      ]
        .map(cell)
        .join(",")
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
