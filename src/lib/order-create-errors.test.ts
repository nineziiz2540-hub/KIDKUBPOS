import { test } from "node:test";
import assert from "node:assert/strict";
import { OLD_TAB_MESSAGE, orderCreateErrorMessage } from "./order-create-errors.ts";
import { NO_OPEN_SHIFT_MESSAGE } from "./shift-errors.ts";

test("a stale held bill asks to reopen the held-bill list", () => {
  assert.equal(
    orderCreateErrorMessage("held_bill_stale"),
    "บิลพักนี้ถูกแก้ไข ชำระ หรือยกเลิกไปแล้ว กรุณาเปิดรายการบิลพักใหม่"
  );
});

test("an actor outside the tenant is forbidden", () => {
  assert.equal(orderCreateErrorMessage("forbidden"), "ไม่มีสิทธิ์ทำรายการนี้");
});

test("a missing client_ref means an old POS tab", () => {
  assert.equal(orderCreateErrorMessage("invalid_client_ref"), OLD_TAB_MESSAGE);
  assert.equal(OLD_TAB_MESSAGE, "กรุณารีเฟรชหน้า POS แล้วลองใหม่ (ระบบเพิ่งอัปเดต)");
});

test("the drawer guard's codes reuse the shift messages", () => {
  assert.equal(orderCreateErrorMessage("no_open_shift"), NO_OPEN_SHIFT_MESSAGE);
  assert.equal(orderCreateErrorMessage("shift_closed"), "กะถูกปิดไปแล้ว กรุณาเปิดกะใหม่");
});

test("a code wrapped in a Postgres message is still found", () => {
  assert.equal(
    orderCreateErrorMessage('P0001: held_bill_stale (CONTEXT: PL/pgSQL function order_create)'),
    "บิลพักนี้ถูกแก้ไข ชำระ หรือยกเลิกไปแล้ว กรุณาเปิดรายการบิลพักใหม่"
  );
});

test("anything else is not ours to explain", () => {
  assert.equal(orderCreateErrorMessage('insert or update on table "order_items" violates foreign key'), null);
});
