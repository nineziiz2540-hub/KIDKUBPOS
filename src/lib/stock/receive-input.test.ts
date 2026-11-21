import { test } from "node:test";
import assert from "node:assert/strict";
import { AMOUNT_PROBLEM, RECEIVE_MAX_QTY, amountProblem, parseReceiveFields, receiveAmountToUseUnits } from "./receive-input.ts";
import { WASTE_MAX_QTY } from "./waste-input.ts";
import { toBaseQty } from "./units.ts";

const milk = { purchaseSize: 2000 };

test("receiveAmountToUseUnits: 6 bottles of 2,000 ml is 12,000 ml; half a bottle is 1,000 ml", () => {
  assert.equal(receiveAmountToUseUnits(6, "purchase", milk), 12000);
  assert.equal(receiveAmountToUseUnits(0.5, "purchase", milk), 1000);
  assert.equal(receiveAmountToUseUnits(2.25, "purchase", milk), 4500);
});

test("receiveAmountToUseUnits: the use unit passes through as typed", () => {
  assert.equal(receiveAmountToUseUnits(150, "use", milk), 150);
});

test("receiveAmountToUseUnits: no purchase size means the number is already the use unit", () => {
  assert.equal(receiveAmountToUseUnits(3, "purchase", { purchaseSize: null }), 3);
});

test("receiveAmountToUseUnits: nothing typed (0 or less) is null, never a save", () => {
  assert.equal(receiveAmountToUseUnits(0, "purchase", milk), null);
  assert.equal(receiveAmountToUseUnits(0, "use", milk), null);
});

test("receiveAmountToUseUnits agrees with the D1 unit maths (units.ts toBaseQty)", () => {
  assert.equal(receiveAmountToUseUnits(6, "purchase", milk), toBaseQty(6, 2000));
});

test("amountProblem: a real delivery of 125,000 passes the receive limit but not the waste limit", () => {
  assert.equal(amountProblem(125000, RECEIVE_MAX_QTY, true), null);
  assert.equal(amountProblem(125000, WASTE_MAX_QTY, true), AMOUNT_PROBLEM);
  assert.ok(RECEIVE_MAX_QTY < 10_000_000);
});

test("amountProblem: too many decimals, or 0 after typing, say so; an untouched 0 stays quiet", () => {
  assert.equal(amountProblem(1.2345, RECEIVE_MAX_QTY, true), AMOUNT_PROBLEM);
  assert.equal(amountProblem(null, RECEIVE_MAX_QTY, true), AMOUNT_PROBLEM);
  assert.equal(amountProblem(null, RECEIVE_MAX_QTY, false), null);
});

// ── parseReceiveFields: the inventory form (FormData) and the POS route (JSON) share it (final review I3) ──

/** The inventory form's FormData, read the way receiveStock reads it. */
function form(fields: Record<string, string>): (k: string) => unknown {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return (k) => fd.get(k);
}

test("parseReceiveFields reads the inventory form exactly as receiveStock did", () => {
  assert.deepEqual(parseReceiveFields(form({ raw_material_id: "m1", quantity: "12000" }), false), {
    value: { materialId: "m1", quantity: 12000, totalPrice: null, note: null },
  });
  assert.deepEqual(
    parseReceiveFields(form({ raw_material_id: "m1", quantity: "2.5", total_price: " 120 ", note: "  ส่งเช้า  " }), true),
    { value: { materialId: "m1", quantity: 2.5, totalPrice: 120, note: "ส่งเช้า" } }
  );
  // an empty price or note is "none"
  assert.deepEqual(parseReceiveFields(form({ raw_material_id: "m1", quantity: "1", total_price: "  ", note: " " }), true), {
    value: { materialId: "m1", quantity: 1, totalPrice: null, note: null },
  });
});

test("parseReceiveFields: a staff price is ignored, never refused or saved", () => {
  assert.deepEqual(parseReceiveFields(form({ raw_material_id: "m1", quantity: "1", total_price: "120" }), false), {
    value: { materialId: "m1", quantity: 1, totalPrice: null, note: null },
  });
  assert.deepEqual(parseReceiveFields(form({ raw_material_id: "m1", quantity: "1", total_price: "-5" }), false), {
    value: { materialId: "m1", quantity: 1, totalPrice: null, note: null },
  });
});

test("parseReceiveFields keeps the action's Thai and its order of checks", () => {
  const long = "x".repeat(501);
  // the note is checked first, then the material, then the amount, then the price
  assert.deepEqual(parseReceiveFields(form({ quantity: "0", note: long }), true), { error: "หมายเหตุยาวเกินไป (ไม่เกิน 500 ตัวอักษร)" });
  assert.deepEqual(parseReceiveFields(form({ quantity: "0" }), true), { error: "ข้อมูลไม่ถูกต้อง" });
  for (const q of ["0", "-1", "abc", ""]) {
    assert.deepEqual(parseReceiveFields(form({ raw_material_id: "m1", quantity: q, total_price: "-1" }), true), {
      error: "กรุณากรอกจำนวนที่ถูกต้อง (> 0)",
    });
  }
  assert.ok("value" in parseReceiveFields(form({ raw_material_id: "m1", quantity: "1" }), true));
  assert.deepEqual(parseReceiveFields(form({ raw_material_id: "m1", quantity: "1", total_price: "-1" }), true), {
    error: "กรุณากรอกราคาที่ถูกต้อง",
  });
  assert.deepEqual(parseReceiveFields(form({ raw_material_id: "m1", quantity: "1", total_price: "abc" }), true), {
    error: "กรุณากรอกราคาที่ถูกต้อง",
  });
});

test("parseReceiveFields takes the POS's numbers like the form's strings", () => {
  const json = (o: Record<string, unknown>) => (k: string) => o[k];
  assert.deepEqual(parseReceiveFields(json({ raw_material_id: "m1", quantity: 12000, total_price: 120 }), true), {
    value: { materialId: "m1", quantity: 12000, totalPrice: 120, note: null },
  });
  assert.deepEqual(parseReceiveFields(json({ raw_material_id: "m1", quantity: Number.NaN }), true), {
    error: "กรุณากรอกจำนวนที่ถูกต้อง (> 0)",
  });
  assert.deepEqual(parseReceiveFields(json({ raw_material_id: "m1", quantity: 1, total_price: Number.POSITIVE_INFINITY }), true), {
    error: "กรุณากรอกราคาที่ถูกต้อง",
  });
});
