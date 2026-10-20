import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bangkokDayRange,
  bangkokToday,
  formatDateTime,
  formatDayLabel,
  formatTime,
  isValidDateString,
  shiftDate,
} from "./bangkok-time.ts";

test("formatTime shows Bangkok wall-clock time, not the server's", () => {
  assert.equal(formatTime("2026-10-20T03:15:00Z"), "10:15");
});

test("a bill at 00:30 Bangkok belongs to the next calendar day", () => {
  assert.equal(formatTime("2026-10-19T17:30:00Z"), "00:30");
  assert.equal(bangkokToday(new Date("2026-10-19T17:30:00Z")), "2026-10-20");
});

test("bangkokToday just before Bangkok midnight is still the same day", () => {
  assert.equal(bangkokToday(new Date("2026-10-20T16:59:59Z")), "2026-10-20");
});

test("bangkokDayRange covers the Bangkok day as a UTC [start, end) range", () => {
  assert.deepEqual(bangkokDayRange("2026-10-20"), {
    start: "2026-10-19T17:00:00.000Z",
    end: "2026-10-20T17:00:00.000Z",
  });
});

test("shiftDate crosses month boundaries both ways", () => {
  assert.equal(shiftDate("2026-10-31", 1), "2026-11-01");
  assert.equal(shiftDate("2026-03-01", -1), "2026-02-28");
});

test("isValidDateString accepts only real YYYY-MM-DD dates", () => {
  assert.equal(isValidDateString("2026-10-20"), true);
  assert.equal(isValidDateString("2026-02-30"), false);
  assert.equal(isValidDateString("20-10-2026"), false);
  assert.equal(isValidDateString(""), false);
});

test("formatDayLabel names today and yesterday", () => {
  assert.ok(formatDayLabel("2026-10-20", "2026-10-20").startsWith("วันนี้"));
  assert.ok(formatDayLabel("2026-10-20", "2026-10-21").startsWith("เมื่อวาน"));
  const older = formatDayLabel("2026-10-15", "2026-10-21");
  assert.ok(!older.startsWith("วันนี้") && !older.startsWith("เมื่อวาน"));
  assert.ok(older.includes("15"));
});

test("formatDateTime includes the Bangkok time", () => {
  assert.ok(formatDateTime("2026-10-20T03:15:00Z").includes("10:15"));
});
