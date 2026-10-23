import { test } from "node:test";
import assert from "node:assert/strict";
import { computeChange, formatPrice, suggestCashAmounts } from "./cash.ts";

test("computeChange returns the change rounded to satang", () => {
  assert.equal(computeChange(85.5, 100), 14.5);
});

test("computeChange accepts exact payment of a float-noisy total", () => {
  assert.equal(computeChange(85.49999999999999, 85.5), 0);
});

test("computeChange refuses less than the total", () => {
  assert.equal(computeChange(100, 99.99), null);
});

test("computeChange refuses more than MAX_CASH_RECEIVED", () => {
  assert.equal(computeChange(10, 1_000_000.01), null);
});

test("computeChange refuses non-numbers", () => {
  assert.equal(computeChange(NaN, 100), null);
});

test("suggestCashAmounts rounds up to each banknote", () => {
  assert.deepEqual(suggestCashAmounts(85), [100, 500, 1000]);
  assert.deepEqual(suggestCashAmounts(135), [140, 150, 200, 500]);
});

test("suggestCashAmounts offers nothing above an exact 1000", () => {
  assert.deepEqual(suggestCashAmounts(1000), []);
});

test("formatPrice keeps satang only when there are some", () => {
  assert.equal(formatPrice(45.5), "45.50");
  assert.equal(formatPrice(85), "85");
});
