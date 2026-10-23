import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDiscount } from "./discount.ts";
import { toSatang } from "./cash.ts";

test("a percent discount is rounded to satang", () => {
  const r = computeDiscount(171, "percent", 10);
  assert.equal(r.discountAmount, 17.1);
  assert.equal(r.requiresApproval, false);
  assert.equal(toSatang(r.total), 15390);
});

test("more than 20 percent needs approval", () => {
  assert.equal(computeDiscount(100, "percent", 21).requiresApproval, true);
});

test("exactly ฿100 off does not need approval, ฿100.01 does", () => {
  assert.equal(computeDiscount(1000, "amount", 100).requiresApproval, false);
  assert.equal(computeDiscount(1000, "amount", 100.01).requiresApproval, true);
});

test("an amount discount never exceeds the subtotal", () => {
  assert.equal(computeDiscount(50, "amount", 80).discountAmount, 50);
});

test("a percent discount is capped at 100", () => {
  assert.equal(computeDiscount(50, "percent", 150).discountAmount, 50);
});

test("no type or a non-positive value means no discount", () => {
  assert.equal(computeDiscount(50, null, 10).discountAmount, 0);
  assert.equal(computeDiscount(50, "percent", -5).discountAmount, 0);
});
