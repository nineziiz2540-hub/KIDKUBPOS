// Pure view helpers for the materials page (round D1, Task 10). No I/O, no framework imports,
// so node:test can run them. Words follow spec §8.1: shop vocabulary, not system words.
import { toBaseQty } from "./units.ts";

export type MaterialStatus = { kind: "ok" | "low" | "negative"; label: string };

/** ใกล้หมด when 0 ≤ stock ≤ alert (alert > 0); ติดลบ → "ยอดน่าจะผิด"; else ปกติ. */
export function materialStatus(currentStock: number, minStockAlert: number): MaterialStatus {
  if (currentStock < 0) return { kind: "negative", label: "ยอดน่าจะผิด" };
  if (minStockAlert > 0 && currentStock <= minStockAlert) return { kind: "low", label: "ใกล้หมด" };
  return { kind: "ok", label: "ปกติ" };
}

/** "≈ 6 ขวด" — only when a purchase size and unit exist; at most one decimal. */
export function approxPurchaseText(
  currentStock: number,
  purchaseSize: number | null,
  purchaseUnit: string | null
): string | null {
  if (purchaseSize === null || purchaseSize <= 0 || !purchaseUnit) return null;
  const n = Math.round((currentStock / purchaseSize) * 10) / 10;
  return `≈ ${n} ${purchaseUnit}`;
}

const MAX_PAD_LENGTH = 8;

/** One key press on the on-screen number pad. Keys: "0"-"9", ".", "back". */
export function padPress(current: string, key: string): string {
  if (key === "back") return current.slice(0, -1);
  if (key === ".") {
    if (current.includes(".")) return current;
    return current === "" ? "0." : current + ".";
  }
  if (!/^[0-9]$/.test(key)) return current;
  if (current.length >= MAX_PAD_LENGTH) return current;
  if (current === "0") return key;
  return current + key;
}

/** Pad text + a ¼ ½ ¾ button (0 = none) → quantity in the unit being entered. */
export function composeEntryQty(padText: string, fraction: 0 | 0.25 | 0.5 | 0.75): number {
  const whole = padText === "" || padText === "." ? 0 : parseFloat(padText);
  const n = (Number.isFinite(whole) ? whole : 0) + fraction;
  return Math.round(n * 1000) / 1000;
}

/** Entered quantity (purchase units when size is set, else base units) → base units; null if not > 0. */
export function entryToBaseQty(entry: number, purchaseSize: number | null): number | null {
  if (!Number.isFinite(entry) || entry <= 0) return null;
  return toBaseQty(entry, purchaseSize);
}

/** Signed quantity with base unit, e.g. "−18 g", "+12,000 ml". */
export function formatQty(qty: number, unit: string): string {
  const rounded = Math.round(qty * 1000) / 1000;
  if (rounded === 0) return `0 ${unit}`;
  const body = Math.abs(rounded).toLocaleString("en-US", { maximumFractionDigits: 3 });
  return `${rounded < 0 ? "−" : "+"}${body} ${unit}`;
}

export type LedgerInput = {
  type: string;
  quantity: number;
  reason: string | null;
  legacy: boolean;
  order_number: string | null;
  occurred_at: string;
};

const whenFormat = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function withParts(head: string, ...parts: Array<string | null>): string {
  return [head, ...parts.filter((p): p is string => !!p)].join(" · ");
}

/** One ledger row → plain-Thai history line pieces. */
export function ledgerLine(row: LedgerInput, unit: string): { title: string; qty: string; when: string } {
  const bill = row.order_number ? `บิล ${row.order_number}` : null;
  const reason = row.reason && row.reason.trim() !== "" ? row.reason.trim() : null;
  let title: string;
  if (row.legacy || row.type === "deduct") title = "ตัดสต๊อก (ระบบเดิม)";
  else if (row.type === "opening") title = "ยอดตั้งต้น";
  else if (row.type === "sale") title = withParts("ขาย", bill);
  else if (row.type === "void_restock") title = withParts("คืนจากยกเลิกบิล", bill);
  else if (row.type === "waste") title = withParts("ของเสีย", reason);
  else if (row.type === "receive") title = "รับของเข้า";
  else if (row.type === "adjust") title = withParts("ปรับยอด", reason);
  else title = "รายการอื่น";
  return { title, qty: formatQty(row.quantity, unit), when: whenFormat.format(new Date(row.occurred_at)) };
}

const MSG_EXPIRED = "ย้อนกลับไม่ได้แล้ว (เกิน 10 นาที)";
const MSG_DONE = "รายการนี้ย้อนกลับไปแล้ว";
const MSG_FORBIDDEN = "ไม่มีสิทธิ์ย้อนกลับรายการนี้";
const KNOWN_UNDO_MESSAGES = [MSG_EXPIRED, MSG_DONE, MSG_FORBIDDEN];

/** Short Thai message for an undo failure (raw RPC code or an already-mapped action message). */
export function undoErrorMessage(message: string | undefined): string {
  if (!message) return "ย้อนกลับไม่สำเร็จ";
  if (KNOWN_UNDO_MESSAGES.includes(message)) return message;
  if (message.includes("undo_expired")) return MSG_EXPIRED;
  if (message.includes("already_undone")) return MSG_DONE;
  if (message.includes("undo_forbidden")) return MSG_FORBIDDEN;
  return "ย้อนกลับไม่สำเร็จ";
}
