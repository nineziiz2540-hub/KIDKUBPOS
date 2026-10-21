// Maps the codes raised by the order_* adjustment functions (migration
// 20261021120000_order_adjustments) to the Thai message shown to the user. Postgres wraps them
// ("P0001: shift_closed", or a longer message), so the code is matched anywhere in the text.

const MESSAGES: Record<string, string> = {
  order_not_found: "ไม่พบบิลนี้",
  invalid_state: "สถานะบิลเปลี่ยนไปแล้ว กรุณารีเฟรชหน้า",
  same_method: "บิลนี้เป็นช่องทางนี้อยู่แล้ว",
  shift_closed: "แก้ช่องทางชำระได้เฉพาะบิลในกะที่ยังเปิดอยู่",
  // Round B lock-down (migration 20261022130000): a bill sold with no shift can't become cash.
  no_shift: "บิลนี้ขายตอนไม่ได้เปิดกะ เปลี่ยนเป็นเงินสดไม่ได้",
  invalid_method: "ช่องทางชำระไม่ถูกต้อง",
  reason_required: "กรุณาระบุเหตุผล",
  forbidden: "ไม่มีสิทธิ์ทำรายการนี้",
};

export function adjustmentErrorMessage(raw: string): string {
  for (const [code, message] of Object.entries(MESSAGES)) {
    if (raw.includes(code)) return message;
  }
  return "ทำรายการไม่สำเร็จ";
}
