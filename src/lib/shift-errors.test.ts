import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_OPEN_SHIFT_MESSAGE, orderInsertShiftError, shiftErrorMessage } from "./shift-errors.ts";

test("shiftErrorMessage finds the code inside a Postgres error", () => {
  assert.equal(
    shiftErrorMessage("P0001: expected_changed"),
    "มีรายการเงินสดใหม่ระหว่างนับ · นับอีกครั้ง"
  );
  assert.equal(shiftErrorMessage("recount_required"), "ยอดไม่ตรง กรุณานับอีกครั้ง");
  assert.equal(shiftErrorMessage("shift_already_open"), "มีกะที่เปิดอยู่แล้ว");
});

test("orderInsertShiftError explains the drawer guard's refusals of a new bill", () => {
  assert.equal(orderInsertShiftError("P0001: no_open_shift"), NO_OPEN_SHIFT_MESSAGE);
  assert.equal(orderInsertShiftError("shift_closed"), "กะถูกปิดไปแล้ว กรุณาเปิดกะใหม่");
  assert.equal(orderInsertShiftError("duplicate key value"), null);
});

test("shiftErrorMessage falls back for unknown errors", () => {
  assert.equal(shiftErrorMessage("connection reset"), "ทำรายการไม่สำเร็จ");
});
