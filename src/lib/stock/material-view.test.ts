import { test } from "node:test";
import assert from "node:assert/strict";
import {
  materialStatus,
  approxPurchaseText,
  padPress,
  composeEntryQty,
  entryToBaseQty,
  ledgerLine,
  formatQty,
  undoErrorMessage,
} from "./material-view.ts";

test("materialStatus: low, negative, normal", () => {
  assert.deepEqual(materialStatus(500, 1000), { kind: "low", label: "ใกล้หมด" });
  assert.deepEqual(materialStatus(1000, 1000), { kind: "low", label: "ใกล้หมด" });
  assert.deepEqual(materialStatus(0, 1000), { kind: "low", label: "ใกล้หมด" });
  assert.deepEqual(materialStatus(-5, 1000), { kind: "negative", label: "ยอดน่าจะผิด" });
  assert.deepEqual(materialStatus(-5, 0), { kind: "negative", label: "ยอดน่าจะผิด" });
  assert.deepEqual(materialStatus(500, 0), { kind: "ok", label: "ปกติ" });
  assert.deepEqual(materialStatus(5000, 1000), { kind: "ok", label: "ปกติ" });
});

test("approxPurchaseText: only with purchase size, one decimal max", () => {
  assert.equal(approxPurchaseText(12000, 2000, "ขวด"), "≈ 6 ขวด");
  assert.equal(approxPurchaseText(5000, 2000, "ขวด"), "≈ 2.5 ขวด");
  assert.equal(approxPurchaseText(3333, 2000, "ขวด"), "≈ 1.7 ขวด");
  assert.equal(approxPurchaseText(3333, null, "ขวด"), null);
  assert.equal(approxPurchaseText(3333, 2000, null), null);
});

test("padPress builds a number string", () => {
  assert.equal(padPress("", "6"), "6");
  assert.equal(padPress("6", "0"), "60");
  assert.equal(padPress("", "0"), "0");
  assert.equal(padPress("0", "5"), "5");
  assert.equal(padPress("6", "."), "6.");
  assert.equal(padPress("6.5", "."), "6.5");
  assert.equal(padPress("", "."), "0.");
  assert.equal(padPress("60", "back"), "6");
  assert.equal(padPress("", "back"), "");
  assert.equal(padPress("12345678", "9"), "12345678");
});

test("composeEntryQty: whole number plus fraction button", () => {
  assert.equal(composeEntryQty("6", 0), 6);
  assert.equal(composeEntryQty("", 0.5), 0.5);
  assert.equal(composeEntryQty("2", 0.75), 2.75);
  assert.equal(composeEntryQty("2", 0.25), 2.25);
  assert.equal(composeEntryQty("", 0), 0);
});

test("entryToBaseQty converts purchase units to base units", () => {
  assert.equal(entryToBaseQty(6, 2000), 12000);
  assert.equal(entryToBaseQty(0.5, 2000), 1000);
  assert.equal(entryToBaseQty(250, null), 250);
  assert.equal(entryToBaseQty(0, 2000), null);
});

test("formatQty: signed, base unit, up to 3 decimals", () => {
  assert.equal(formatQty(-18, "g"), "−18 g");
  assert.equal(formatQty(12000, "ml"), "+12,000 ml");
  assert.equal(formatQty(0.5, "ชิ้น"), "+0.5 ชิ้น");
  assert.equal(formatQty(-0.0001, "g"), "0 g");
});

const base = { quantity: -18, reason: null, legacy: false, order_number: null, occurred_at: "2026-11-18T03:05:00Z" };

test("ledgerLine: each type in plain Thai", () => {
  assert.equal(ledgerLine({ ...base, type: "sale", order_number: "KK.031" }, "g").title, "ขาย · บิล KK.031");
  assert.equal(ledgerLine({ ...base, type: "sale", order_number: "KK.031" }, "g").qty, "−18 g");
  assert.equal(ledgerLine({ ...base, type: "sale" }, "g").title, "ขาย");
  assert.equal(
    ledgerLine({ ...base, type: "void_restock", quantity: 18, order_number: "KK.031" }, "g").title,
    "คืนจากยกเลิกบิล · บิล KK.031"
  );
  assert.equal(ledgerLine({ ...base, type: "waste", reason: "ทำหก" }, "g").title, "ของเสีย · ทำหก");
  assert.equal(ledgerLine({ ...base, type: "waste" }, "g").title, "ของเสีย");
  assert.equal(ledgerLine({ ...base, type: "receive", quantity: 12000 }, "ml").title, "รับของเข้า");
  assert.equal(ledgerLine({ ...base, type: "adjust", reason: "นับจริง" }, "g").title, "ปรับยอด · นับจริง");
  assert.equal(ledgerLine({ ...base, type: "opening" }, "g").title, "ยอดตั้งต้น");
  assert.equal(ledgerLine({ ...base, type: "deduct" }, "g").title, "ตัดสต๊อก (ระบบเดิม)");
  assert.equal(ledgerLine({ ...base, type: "sale", legacy: true }, "g").title, "ตัดสต๊อก (ระบบเดิม)");
  assert.equal(ledgerLine({ ...base, type: "zzz" }, "g").title, "รายการอื่น");
});

test("ledgerLine: Bangkok time", () => {
  // 03:05Z = 10:05 in Bangkok
  assert.match(ledgerLine({ ...base, type: "sale" }, "g").when, /10:05/);
});

test("undoErrorMessage maps codes to short Thai", () => {
  assert.equal(undoErrorMessage("ย้อนกลับไม่ได้แล้ว (เกิน 10 นาที)"), "ย้อนกลับไม่ได้แล้ว (เกิน 10 นาที)");
  assert.equal(undoErrorMessage("undo_expired"), "ย้อนกลับไม่ได้แล้ว (เกิน 10 นาที)");
  assert.equal(undoErrorMessage("already_undone"), "รายการนี้ย้อนกลับไปแล้ว");
  assert.equal(undoErrorMessage("undo_forbidden"), "ไม่มีสิทธิ์ย้อนกลับรายการนี้");
  assert.equal(undoErrorMessage("whatever"), "ย้อนกลับไม่สำเร็จ");
});
