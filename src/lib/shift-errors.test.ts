import { test } from "node:test";
import assert from "node:assert/strict";
import { shiftErrorMessage } from "./shift-errors.ts";

test("shiftErrorMessage finds the code inside a Postgres error", () => {
  assert.equal(
    shiftErrorMessage("P0001: expected_changed"),
    "มีรายการเงินสดใหม่ระหว่างนับ · นับอีกครั้ง"
  );
  assert.equal(shiftErrorMessage("recount_required"), "ยอดไม่ตรง กรุณานับอีกครั้ง");
  assert.equal(shiftErrorMessage("shift_already_open"), "มีกะที่เปิดอยู่แล้ว");
});

test("shiftErrorMessage falls back for unknown errors", () => {
  assert.equal(shiftErrorMessage("connection reset"), "ทำรายการไม่สำเร็จ");
});
