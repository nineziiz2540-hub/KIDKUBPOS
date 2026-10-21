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

export function shiftErrorMessage(raw: string): string {
  for (const [code, message] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) return message;
  }
  return "ทำรายการไม่สำเร็จ";
}
