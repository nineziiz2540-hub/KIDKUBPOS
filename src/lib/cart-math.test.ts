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

test("cart unitPrice adds the specialty price once (an extra shot adds only its own option price)", () => {
  const choices = {
    slots: [{ groupId: "beans", memberId: "k", label: "Kenya", tier: "special" as const, priceDelta: 20 }],
    slotAddGroupIds: ["beans"],
    sweetness: null,
  };
  assert.equal(unitPrice(65, [{ priceDelta: 5 }], choices), 70 + 20);
  // a doubled special pays its price twice; a house member never pays
  assert.equal(unitPrice(65, [], { ...choices, slots: [{ ...choices.slots[0]!, count: 2 as const }] }), 65 + 40);
  assert.equal(
    unitPrice(65, [], { ...choices, slots: [{ groupId: "beans", memberId: "h", label: "คั่วกลาง", tier: "house" as const, priceDelta: 0, count: 2 as const }] }),
    65
  );
  assert.equal(unitPrice(65, [], { slots: [], slotAddGroupIds: [], sweetness: null }), 65);
  assert.equal(unitPrice(65, []), 65);
});

test("lineTotal keeps the specialty price per cup", () => {
  const choices = {
    slots: [{ groupId: "beans", memberId: "k", label: "Kenya", tier: "special" as const, priceDelta: 20 }],
    slotAddGroupIds: [],
    sweetness: null,
  };
  assert.equal(lineTotal(65, [], 2, choices), (65 + 20) * 2);
  assert.equal(lineTotal(65, [], 2), 130);
});
