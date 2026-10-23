import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attemptFingerprint,
  cartWarning,
  DeadlineError,
  UNRESOLVED_PAYMENT_MESSAGE,
  withDeadline,
  type AttemptInput,
} from "./payment-attempt.ts";
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

// ── Final review fixes ──────────────────────────────────────────────────────

test("withDeadline gives up on a hung call", async () => {
  const hung = new Promise<string>(() => {});
  await assert.rejects(withDeadline(hung, 20), DeadlineError);
});

test("withDeadline passes a timely answer through", async () => {
  assert.equal(await withDeadline(Promise.resolve("ok"), 1000), "ok");
});

test("an unresolved payment keeps its warning whatever else the cart shows", () => {
  assert.equal(cartWarning(null, "ref-1"), UNRESOLVED_PAYMENT_MESSAGE);
  assert.equal(cartWarning("PIN ไม่ถูกต้อง", "ref-1"), `${UNRESOLVED_PAYMENT_MESSAGE}\nPIN ไม่ถูกต้อง`);
  assert.equal(cartWarning("PIN ไม่ถูกต้อง", null), "PIN ไม่ถูกต้อง");
  assert.equal(cartWarning(UNRESOLVED_PAYMENT_MESSAGE, "ref-1"), UNRESOLVED_PAYMENT_MESSAGE);
  assert.equal(cartWarning(null, null), null);
});
