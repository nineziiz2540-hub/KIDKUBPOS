// What a failed createOrder means for the device's outbox sender (round C2, spec "Claude's calls"
// 7-8): keep the bill and send it again later (retry), move it to the manager's review list
// (review), or — for a sale made online at the payment window — hand the problem back to the
// cart (refused). The codes come from order_record (migration 20261105120000) and the checks
// createOrder runs before it; they are machine-readable so the sender never matches Thai text.
import type { OfflineSale } from "../../types/app.ts";
import { HELD_BILL_STALE_MESSAGE, orderCreateErrorMessage } from "../order-create-errors.ts";

export type ReviewCode =
  | "menu_changed"
  | "held_bill_stale"
  | "shift_closed"
  | "needs_approval"
  | "seller_inactive"
  | "product_missing"
  | "other";

export type SyncOutcome = "retry" | "review" | "refused";

/**
 * Why a bill is in review, as the review list shows it. "other" is deliberately empty: for it the
 * caller must show the `error` createOrder returned (the server's own message), never this value,
 * or the review list would show a blank reason.
 */
export const REVIEW_MESSAGES: Record<ReviewCode, string> = {
  menu_changed: "ราคาหรือเมนูมีการเปลี่ยนแปลงระหว่างเน็ตหลุด",
  held_bill_stale: HELD_BILL_STALE_MESSAGE,
  shift_closed: "กะที่เปิดอยู่ตอนขายถูกปิดไปแล้ว",
  needs_approval: "ส่วนลดนี้ต้องให้ผู้จัดการอนุมัติ",
  seller_inactive: "พนักงานที่ขายบิลนี้ถูกปิดใช้งานแล้ว",
  product_missing: "มีเมนูในบิลที่ถูกลบไปแล้ว บันทึกไม่ได้",
  other: "",
};

const PRODUCT_FK = "order_items_product_id_fkey";
const INVALID_OFFLINE_MESSAGE = "ข้อมูลบิลที่ขายตอนเน็ตหลุดไม่ถูกต้อง";
const DATA_EXCEPTION_MESSAGE = "ข้อมูลบิลไม่ถูกต้อง";

/** SQLSTATE class 22 (data exception, e.g. 22P02 from a bad cast): the same input fails every time. */
function isDataException(sqlState: string | undefined): boolean {
  return typeof sqlState === "string" && sqlState.startsWith("22");
}

/**
 * Sorts a failed order_record call. Codes are matched anywhere in the text because Postgres wraps
 * them. Order matters: "offline_shift_closed" also contains "shift_closed". Anything unknown (a
 * dropped connection, a timeout) is retried; the sender's try cap moves it to review eventually.
 */
export function classifyRecordError(
  raw: string,
  ctx: { offline: boolean; sqlState?: string }
): { outcome: SyncOutcome; reviewCode?: ReviewCode } {
  const stop = (reviewCode: ReviewCode): { outcome: SyncOutcome; reviewCode?: ReviewCode } =>
    ctx.offline ? { outcome: "review", reviewCode } : { outcome: "refused" };

  if (raw.includes("offline_shift_closed")) return stop("shift_closed");
  if (raw.includes("held_bill_stale")) return stop("held_bill_stale");
  if (raw.includes("forbidden")) return stop("seller_inactive");
  if (raw.includes(PRODUCT_FK)) return stop("product_missing");
  if (
    raw.includes("invalid_offline") ||
    raw.includes("reason_required") ||
    raw.includes("invalid_queue_number")
  ) {
    return stop("other");
  }
  // The drawer guard, or "record as charged" with no shift open now: the cashier/manager must act.
  if (raw.includes("shift_closed")) return stop("shift_closed");
  if (raw.includes("no_open_shift")) return stop("other");
  if (isDataException(ctx.sqlState)) return stop("other");
  // invalid_client_ref (an old tab) and everything unknown: keep the bill and send it again.
  return { outcome: "retry" };
}

/**
 * The Thai message for a known order_record failure, or null when it isn't one (createOrder then
 * looks the bill up again, as it may have been saved).
 */
export function recordErrorMessage(raw: string, sqlState?: string): string | null {
  if (raw.includes("offline_shift_closed")) return REVIEW_MESSAGES.shift_closed;
  if (raw.includes(PRODUCT_FK)) return REVIEW_MESSAGES.product_missing;
  if (raw.includes("invalid_offline") || raw.includes("invalid_queue_number")) {
    return INVALID_OFFLINE_MESSAGE;
  }
  if (raw.includes("reason_required")) return "กรุณาระบุเหตุผล";
  const known = orderCreateErrorMessage(raw);
  if (known !== null) return known;
  if (isDataException(sqlState)) return DATA_EXCEPTION_MESSAGE;
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * The device sends Date.toISOString(); Date.parse alone would accept "1" or "May 5". A zone (Z or
 * ±hh:mm) is required: without one the time would be read in the server's own time zone.
 */
const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * The shop guard and shape check for an offline bill (spec call 7). A bill of another shop than
 * the signed-in one waits (retry): it is never sent there and never refused, so another shop
 * signing in on the same iPad loses nothing. A malformed bill can never succeed, so it goes to
 * review.
 */
export function checkOfflineSale(
  offline: unknown,
  tenantId: string
):
  | { ok: true; sale: OfflineSale }
  | { error: string; outcome: SyncOutcome; reviewCode?: ReviewCode } {
  const invalid = { error: INVALID_OFFLINE_MESSAGE, outcome: "review" as const, reviewCode: "other" as const };
  if (typeof offline !== "object" || offline === null) return invalid;
  const o = offline as Record<string, unknown>;
  if (o.tenantId !== tenantId) return { error: "บิลนี้เป็นของร้านอื่น", outcome: "retry" };

  const { sellerId, soldAt, queueNumber, shiftId } = o;
  if (
    typeof sellerId !== "string" ||
    !UUID_RE.test(sellerId) ||
    typeof soldAt !== "string" ||
    !ISO_DATE_TIME_RE.test(soldAt) ||
    Number.isNaN(Date.parse(soldAt)) ||
    typeof queueNumber !== "number" ||
    !Number.isInteger(queueNumber) ||
    queueNumber < 1 ||
    queueNumber > 9999 ||
    !(shiftId === null || (typeof shiftId === "string" && UUID_RE.test(shiftId)))
  ) {
    return invalid;
  }
  return { ok: true, sale: { tenantId, sellerId, soldAt, queueNumber, shiftId } };
}
