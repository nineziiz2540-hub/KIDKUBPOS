import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProductCost } from "./product-cost.ts";

const mats = new Map([
  ["bean", { name: "เมล็ดกาแฟ", unit: "g", costPerUnit: 0.5 }],
  ["milk", { name: "นม", unit: "ml", costPerUnit: 0.04 }],
  ["free", { name: "น้ำแข็ง", unit: "g", costPerUnit: 0 }],
]);

test("buildProductCost prices each stock line at current cost and totals them", () => {
  const r = buildProductCost("p1", [{ materialId: "bean", qty: 18 }, { materialId: "milk", qty: 100 }], mats);
  assert.equal(r.productId, "p1");
  assert.equal(r.recipes.length, 2);
  assert.deepEqual(r.recipes[0], { materialName: "เมล็ดกาแฟ", unit: "g", quantityUsed: 18, costPerUnit: 0.5, lineCost: 9 });
  assert.ok(Math.abs(r.ingredientCost - 13) < 1e-9);
  assert.deepEqual(r.missingMaterials, []);
});
test("buildProductCost reports zero-cost and unknown materials as missing", () => {
  const r = buildProductCost("p1", [{ materialId: "free", qty: 50 }, { materialId: "gone", qty: 5 }, { materialId: "bean", qty: 2 }], mats);
  assert.equal(r.ingredientCost, 1);
  assert.deepEqual(r.missingMaterials, ["น้ำแข็ง", "(วัตถุดิบที่ไม่พบ)"]);
  assert.equal(r.recipes.length, 2); // the unknown material has no row to show
});
test("buildProductCost of no stock lines is zero", () => {
  const r = buildProductCost("p1", [], mats);
  assert.equal(r.ingredientCost, 0);
  assert.deepEqual(r.recipes, []);
});
