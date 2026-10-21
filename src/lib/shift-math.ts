// Shift (จัดการกะ) logic shared by the shift pages and the shift server actions: parsing typed
// amounts, comparing a count with what the drawer should hold, the one-recount closing rule,
// the overnight float and bank deposit, and cash-movement validation. The expected cash itself
// is computed in SQL only (shift_totals); nothing here re-derives it. Kept free of "@/" imports
// so `node --test` can load it directly.

import { toSatang } from "./cash.ts";
import { formatBaht } from "./order-history.ts";

/** Mirrors the database CHECKs (migration 20261022120000_shift_management). */
export const MAX_COUNT = 1_000_000;
export const MAX_MOVEMENT = 100_000;
export const MAX_FLOAT = 100_000;
export const NOTE_MAX = 200;

export type MovementDirection = "in" | "out";
export type MovementReason =
  | "personal_topup"
  | "purchase"
  | "personal_return"
  | "correction"
  | "other_in"
  | "other_out";

export const MOVEMENT_REASONS: Record<
  MovementReason,
  { label: string; directions: MovementDirection[]; noteRequired: boolean }
> = {
  personal_topup: { label: "เงินส่วนตัวเติมเงินทอน", directions: ["in"], noteRequired: false },
  purchase: { label: "ซื้อของเข้าร้าน", directions: ["out"], noteRequired: false },
  personal_return: { label: "คืนเงินส่วนตัว", directions: ["out"], noteRequired: false },
  correction: { label: "แก้รายการที่กดผิด", directions: ["in", "out"], noteRequired: true },
  other_in: { label: "อื่นๆ", directions: ["in"], noteRequired: true },
  other_out: { label: "อื่นๆ", directions: ["out"], noteRequired: true },
};

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;

/** "1,000" → 1000; anything that isn't a plain non-negative baht amount (≤ 2 decimals, ≤ max) → null. */
export function parseAmount(raw: string, max: number = MAX_COUNT): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (!AMOUNT_RE.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value > max) return null;
  return value;
}

export type CountComparison =
  | { kind: "none" }
  | { kind: "match" }
  | { kind: "short" | "over"; amount: number };

/** How a count compares with what the drawer should hold; `null` expected = nothing to compare. */
export function compareCount(counted: number, expected: number | null): CountComparison {
  if (expected === null) return { kind: "none" };
  const diff = toSatang(counted) - toSatang(expected);
  if (diff === 0) return { kind: "match" };
  return { kind: diff < 0 ? "short" : "over", amount: Math.abs(diff) / 100 };
}

/** ฿5,230 · ฿85.50 · −฿10 (the sign goes before ฿; a drawer can be "negative" when records are wrong). */
export function formatMoney(baht: number): string {
  return toSatang(baht) < 0 ? `−฿${formatBaht(-baht)}` : `฿${formatBaht(baht)}`;
}

/** ตรง · ขาด ฿20 · เกิน ฿5 */
export function differenceLabel(c: CountComparison): string {
  if (c.kind === "short") return `ขาด ฿${formatBaht(c.amount)}`;
  if (c.kind === "over") return `เกิน ฿${formatBaht(c.amount)}`;
  return "ตรง";
}

export type ClosingAttempt = { amount: number; expected: number };

/**
 * Where the closing flow stands, given the closing counts so far and the expected cash now. Same
 * rule as the database's shift_close: the latest count must have been compared with the current
 * expected cash, and either matched it or be at least the second count.
 */
export function closingStep(
  attempts: ClosingAttempt[],
  expectedNow: number
): "count1" | "count2" | "recount_changed" | "float" {
  const latest = attempts.at(-1);
  if (!latest) return "count1";
  if (toSatang(latest.expected) !== toSatang(expectedNow)) return "recount_changed";
  if (compareCount(latest.amount, latest.expected).kind === "match") return "float";
  return attempts.length >= 2 ? "float" : "count2";
}

/** Keep the shop's float in the drawer (or everything, on a slow day) and deposit the rest. */
export function planFloat(
  counted: number,
  floatDefault: number
): { floatLeft: number; deposit: number; shortfall: number } {
  const countedSatang = toSatang(counted);
  const defaultSatang = toSatang(floatDefault);
  const floatSatang = Math.min(defaultSatang, countedSatang);
  return {
    floatLeft: floatSatang / 100,
    deposit: (countedSatang - floatSatang) / 100,
    shortfall: Math.max(0, defaultSatang - countedSatang) / 100,
  };
}

/** Bank deposit for a chosen float, or null when the float is outside 0..counted. */
export function depositFor(counted: number, floatLeft: number): number | null {
  const countedSatang = toSatang(counted);
  const floatSatang = toSatang(floatLeft);
  if (floatSatang < 0 || floatSatang > countedSatang) return null;
  return (countedSatang - floatSatang) / 100;
}

/** Personal money still in the drawer: personal top-ups minus personal returns, never negative. */
export function personalOutstanding(movements: { reason: string; amount: number }[]): number {
  let satang = 0;
  for (const m of movements) {
    if (m.reason === "personal_topup") satang += toSatang(m.amount);
    if (m.reason === "personal_return") satang -= toSatang(m.amount);
  }
  return Math.max(0, satang) / 100;
}

function isMovementReason(reason: string): reason is MovementReason {
  return Object.hasOwn(MOVEMENT_REASONS, reason);
}

/** Thai error for an invalid cash movement, or null when it is valid. */
export function validateMovement(input: {
  direction: string;
  reason: string;
  amount: number;
  note: string;
}): string | null {
  if (input.direction !== "in" && input.direction !== "out") return "ข้อมูลไม่ถูกต้อง";
  if (!isMovementReason(input.reason)) return "เหตุผลไม่ถูกต้อง";
  const rule = MOVEMENT_REASONS[input.reason];
  if (!rule.directions.includes(input.direction)) return "เหตุผลไม่ถูกต้อง";
  if (
    !Number.isFinite(input.amount) ||
    toSatang(input.amount) <= 0 ||
    toSatang(input.amount) > toSatang(MAX_MOVEMENT)
  ) {
    return "จำนวนเงินไม่ถูกต้อง";
  }
  const note = input.note.trim();
  if (rule.noteRequired && note === "") return "กรุณาเขียนหมายเหตุ";
  if (note.length > NOTE_MAX) return `หมายเหตุยาวเกิน ${NOTE_MAX} ตัวอักษร`;
  return null;
}
