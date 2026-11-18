import { test } from "node:test";
import assert from "node:assert/strict";
import { sumCost } from "./cost.ts";

test("sumCost adds numbers and numeric strings", () => {
  assert.deepEqual(sumCost([{ cost_total: 18 }, { cost_total: "7.5" }]), { cost: 25.5, missingLines: 0 });
});
test("sumCost counts null as missing, not zero", () => {
  assert.deepEqual(sumCost([{ cost_total: null }, { cost_total: 10 }]), { cost: 10, missingLines: 1 });
});
test("sumCost treats 0 as a real cost", () => {
  assert.deepEqual(sumCost([{ cost_total: 0 }]), { cost: 0, missingLines: 0 });
});
test("sumCost counts non-numeric as missing", () => {
  assert.deepEqual(sumCost([{ cost_total: "abc" }]), { cost: 0, missingLines: 1 });
});
test("sumCost of nothing is zero", () => {
  assert.deepEqual(sumCost([]), { cost: 0, missingLines: 0 });
});
test("sumCost never multiplies by quantity", () => {
  const rows = [{ cost_total: 18, quantity: 3 }];
  assert.equal(sumCost(rows).cost, 18);
});
test("sumCost counts empty and whitespace-only strings as missing, not zero", () => {
  assert.deepEqual(sumCost([{ cost_total: "" }, { cost_total: "   " }, { cost_total: 4 }]), { cost: 4, missingLines: 2 });
});
test("sumCost counts non-finite numbers and strings as missing", () => {
  const rows = [{ cost_total: NaN }, { cost_total: Infinity }, { cost_total: -Infinity }, { cost_total: "Infinity" }, { cost_total: "NaN" }];
  assert.deepEqual(sumCost(rows), { cost: 0, missingLines: 5 });
});
