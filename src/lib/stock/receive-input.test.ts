import { test } from "node:test";
import assert from "node:assert/strict";
import { receiveAmountToUseUnits } from "./receive-input.ts";
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
