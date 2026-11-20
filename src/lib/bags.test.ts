import { test } from "node:test";
import assert from "node:assert/strict";
import { billStockLines, billStockPayload, defaultBags, validBags } from "./bags.ts";

test("defaultBags", () => {
  assert.equal(defaultBags(3, null), 0);
  assert.equal(defaultBags(3, 2), 2);
  assert.equal(defaultBags(1, 2), 1);
  assert.equal(defaultBags(0, 2), 0);
});

test("billStockLines", () => {
  assert.deepEqual(billStockLines(2, null), []);
  assert.deepEqual(billStockLines(0, "m1"), []);
  assert.deepEqual(billStockLines(2, "m1"), [{ materialId: "m1", qty: 2 }]);
});

test("createOrder payload carries bags and bill stock", () => {
  assert.deepEqual(billStockPayload(2, "m1"), { bags: 2, stock: [{ material_id: "m1", qty: 2 }] });
  assert.deepEqual(billStockPayload(2, null), { bags: 2, stock: [] });
  assert.deepEqual(billStockPayload(0, "m1"), { bags: 0, stock: [] });
});

test("bags outside 0..99 or non-integer refused", () => {
  assert.equal(validBags(undefined), 0);
  assert.equal(validBags(0), 0);
  assert.equal(validBags(99), 99);
  for (const bad of [-1, 100, 1.5, NaN, Infinity, "2", null, true]) assert.equal(validBags(bad), null, String(bad));
});

test("defaultBags never exceeds 99", () => {
  assert.equal(defaultBags(100, 1), 99);
  assert.equal(defaultBags(250, 2), 99);
  assert.equal(defaultBags(99, 1), 99);
});
