import { test } from "node:test";
import assert from "node:assert/strict";
import { billStockLines, billStockPayload, defaultBags, manualFromDraft, MAX_BAGS, shownBags, stepBags, validBags } from "./bags.ts";

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

test("shownBags: manual wins, else the automatic count; the draft round-trips", () => {
  assert.equal(shownBags(null, 3, 2), 2);
  assert.equal(shownBags(5, 3, 2), 5);
  assert.equal(shownBags(0, 3, 2), 0);
  assert.equal(shownBags(null, 3, null), 0);
  assert.equal(manualFromDraft(0), null);
  assert.equal(manualFromDraft(4), 4);
});

test("stepBags stops at 0 and MAX_BAGS", () => {
  assert.equal(stepBags(0, -1), 0);
  assert.equal(stepBags(2, -1), 1);
  assert.equal(stepBags(2, 1), 3);
  assert.equal(stepBags(MAX_BAGS, 1), MAX_BAGS);
});
