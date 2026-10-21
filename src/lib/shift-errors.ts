// Maps the codes raised by the shift_* functions (migration 20261022120000_shift_management) to
// the Thai message shown to the user. Postgres wraps them ("P0001: expected_changed", or a longer
// message), so the code is matched anywhere in the text.

const MESSAGES: Record<string, string> = {
  shift_not_found: "ไม่พบกะนี้",
  shift_closed: "กะนี้ปิดไปแล้ว กรุณารีเฟรชหน้า",
  shift_already_open: "มีกะที่เปิดอยู่แล้ว",
  recount_required: "ยอดไม่ตรง กรุณานับอีกครั้ง",
  expected_changed: "มีรายการเงินสดใหม่ระหว่างนับ · นับอีกครั้ง",
  count_required: "กรุณานับเงินก่อนปิดกะ",
  invalid_amount: "จำนวนเงินไม่ถูกต้อง",
  invalid_float: "เงินทอนที่เก็บไว้ต้องไม่เกินยอดที่นับได้",
  invalid_reason: "เหตุผลไม่ถูกต้อง",
  note_required: "กรุณาเขียนหมายเหตุ",
  invalid_counts: "ข้อมูลการนับไม่ถูกต้อง",
  forbidden: "ไม่มีสิทธิ์ทำรายการนี้",
};

/** createOrder's refusal of a cash sale with no open shift; the POS shows NoShiftDialog for it. */
export const NO_OPEN_SHIFT_MESSAGE = "ยังไม่ได้เปิดกะ กรุณาเปิดกะก่อนรับเงินสด";

/**
 * The orders drawer guard (migration 20261022130000, guard_order_drawer) refusing a new bill, as
 * the message createOrder shows; null for any other insert error. Only reachable in a race (the
 * shift closed between createOrder's own check and the insert) or with no app check at all.
 */
export function orderInsertShiftError(raw: string): string | null {
  if (raw.includes("no_open_shift")) return NO_OPEN_SHIFT_MESSAGE;
  if (raw.includes("shift_closed")) return "กะถูกปิดไปแล้ว กรุณาเปิดกะใหม่";
  return null;
}

export function shiftErrorMessage(raw: string): string {
  for (const [code, message] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) return message;
  }
  return "ทำรายการไม่สำเร็จ";
}
