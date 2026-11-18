import { test } from "node:test";
import assert from "node:assert/strict";
import { movingAverage, toBaseQty } from "./units.ts";

test("toBaseQty converts purchase units to base units", () => {
  assert.equal(toBaseQty(6, 2000), 12000);
  assert.equal(toBaseQty(250, null), 250);
  assert.equal(toBaseQty(0.75, 2000), 1500);
  assert.equal(toBaseQty(0.1, 3), 0.3);
});

test("toBaseQty throws on programmer errors", () => {
  assert.throws(() => toBaseQty(0, 2000), RangeError);
  assert.throws(() => toBaseQty(1, 0), RangeError);
  assert.throws(() => toBaseQty(NaN, null), RangeError);
});

test("movingAverage blends old stock with the new lot", () => {
  const x = movingAverage(1000, 0.05, 2000, 0.06);
  assert.ok(Math.abs(x - 0.0566667) < 1e-6);
});

test("movingAverage uses the latest cost when balance is zero or negative", () => {
  assert.equal(movingAverage(-20, 0.05, 1000, 0.06), 0.06);
  assert.equal(movingAverage(0, 0.05, 1000, 0.06), 0.06);
});

test("movingAverage: an average of 0 (cost never entered) is unknown, so the lot cost becomes the average (R43)", () => {
  assert.equal(movingAverage(1000, 0, 2000, 0.06), 0.06);
  assert.equal(movingAverage(1000, 0, 500, 0), 0);
});

test("movingAverage throws on programmer errors", () => {
  assert.throws(() => movingAverage(10, 0.05, 0, 0.06), RangeError);
  assert.throws(() => movingAverage(10, 0.05, 5, -1), RangeError);
  assert.throws(() => movingAverage(10, -0.05, 5, 1), RangeError);
  assert.throws(() => movingAverage(Infinity, 0.05, 5, 1), RangeError);
});
