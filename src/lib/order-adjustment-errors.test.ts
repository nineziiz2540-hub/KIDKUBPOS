import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustmentErrorMessage } from "./order-adjustment-errors.ts";

test("each database error code maps to its Thai message", () => {
  assert.equal(adjustmentErrorMessage("order_not_found"), "ไม่พบบิลนี้");
  assert.equal(adjustmentErrorMessage("invalid_state"), "สถานะบิลเปลี่ยนไปแล้ว กรุณารีเฟรชหน้า");
  assert.equal(adjustmentErrorMessage("same_method"), "บิลนี้เป็นช่องทางนี้อยู่แล้ว");
  assert.equal(adjustmentErrorMessage("shift_closed"), "แก้ช่องทางชำระได้เฉพาะบิลในกะที่ยังเปิดอยู่");
  assert.equal(adjustmentErrorMessage("invalid_method"), "ช่องทางชำระไม่ถูกต้อง");
  assert.equal(adjustmentErrorMessage("reason_required"), "กรุณาระบุเหตุผล");
  assert.equal(adjustmentErrorMessage("forbidden"), "ไม่มีสิทธิ์ทำรายการนี้");
  assert.equal(
    adjustmentErrorMessage("P0001: no_shift"),
    "บิลนี้ขายตอนไม่ได้เปิดกะ เปลี่ยนเป็นเงินสดไม่ได้"
  );
});

test("a code embedded in a longer Postgres message is still recognised", () => {
  assert.equal(
    adjustmentErrorMessage("P0001: shift_closed"),
    "แก้ช่องทางชำระได้เฉพาะบิลในกะที่ยังเปิดอยู่"
  );
});

test("an unknown error falls back to a generic message", () => {
  assert.equal(adjustmentErrorMessage("boom"), "ทำรายการไม่สำเร็จ");
  assert.equal(adjustmentErrorMessage(""), "ทำรายการไม่สำเร็จ");
});
