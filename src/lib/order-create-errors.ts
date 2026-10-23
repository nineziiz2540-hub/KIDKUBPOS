// Maps the codes raised by order_create (migration 20261023120000) and by the orders drawer guard
// it fires to the Thai message createOrder shows. Postgres wraps them, so the code is matched
// anywhere in the text, as in src/lib/shift-errors.ts.
import { orderInsertShiftError } from "./shift-errors.ts";

/** A request without a client_ref can only come from a POS tab still running pre-update code. */
export const OLD_TAB_MESSAGE = "กรุณารีเฟรชหน้า POS แล้วลองใหม่ (ระบบเพิ่งอัปเดต)";

const MESSAGES: Record<string, string> = {
  held_bill_stale: "บิลพักนี้ถูกแก้ไข ชำระ หรือยกเลิกไปแล้ว กรุณาเปิดรายการบิลพักใหม่",
  forbidden: "ไม่มีสิทธิ์ทำรายการนี้",
  invalid_client_ref: OLD_TAB_MESSAGE,
};

/** The message for an order_create error, or null when it isn't one of its known codes. */
export function orderCreateErrorMessage(raw: string): string | null {
  for (const [code, message] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) return message;
  }
  return orderInsertShiftError(raw);
}
