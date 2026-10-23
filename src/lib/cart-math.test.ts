import { test } from "node:test";
import assert from "node:assert/strict";
import { cartSubtotal, lineTotal, unitPrice } from "./cart-math.ts";

test("unitPrice adds every option's price delta", () => {
  assert.equal(unitPrice(55, [{ priceDelta: 10 }, { priceDelta: -5 }]), 60);
});

test("lineTotal is computed in satang, not floats", () => {
  // 0.3 * 3 in floats is 0.8999999999999999
  assert.equal(lineTotal(0.1, [{ priceDelta: 0.2 }], 3), 0.9);
});

test("lineTotal multiplies by quantity", () => {
  assert.equal(lineTotal(55, [], 2), 110);
});

test("cartSubtotal sums line totals in satang", () => {
  assert.equal(cartSubtotal([{ totalPrice: 0.1 }, { totalPrice: 0.2 }]), 0.3);
});
