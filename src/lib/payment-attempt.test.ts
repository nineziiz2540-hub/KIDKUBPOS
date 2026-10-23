import { test } from "node:test";
import assert from "node:assert/strict";
import { attemptFingerprint, type AttemptInput } from "./payment-attempt.ts";
import type { CartItem } from "../types/app.ts";

const latte: CartItem = {
  cartItemKey: "latte",
  productId: "latte",
  name: "ลาเต้",
  basePrice: 55,
  quantity: 1,
  selectedModifiers: [],
  note: null,
  totalPrice: 55,
};
const tea: CartItem = { ...latte, cartItemKey: "tea", productId: "tea", name: "ชาไทย", basePrice: 50, totalPrice: 50 };

const base: AttemptInput = {
  items: [latte, tea],
  paymentMethod: "cash",
  orderType: "dine_in",
  customerId: null,
  discountType: null,
  discountValue: "",
  heldBillId: null,
  heldBillVersion: null,
};

test("the same attempt gives the same fingerprint", () => {
  assert.equal(attemptFingerprint(base), attemptFingerprint({ ...base, items: [{ ...latte }, { ...tea }] }));
});

test("changing a quantity changes the fingerprint", () => {
  assert.notEqual(
    attemptFingerprint(base),
    attemptFingerprint({ ...base, items: [{ ...latte, quantity: 2, totalPrice: 110 }, tea] })
  );
});

test("changing the payment method changes the fingerprint", () => {
  assert.notEqual(attemptFingerprint(base), attemptFingerprint({ ...base, paymentMethod: "transfer" }));
});

test("changing the discount value changes the fingerprint", () => {
  assert.notEqual(
    attemptFingerprint({ ...base, discountType: "amount", discountValue: "10" }),
    attemptFingerprint({ ...base, discountType: "amount", discountValue: "15" })
  );
});

test("changing the held bill version changes the fingerprint", () => {
  assert.notEqual(
    attemptFingerprint({ ...base, heldBillId: "h1", heldBillVersion: 1 }),
    attemptFingerprint({ ...base, heldBillId: "h1", heldBillVersion: 2 })
  );
});

test("item order matters", () => {
  assert.notEqual(attemptFingerprint(base), attemptFingerprint({ ...base, items: [tea, latte] }));
});
