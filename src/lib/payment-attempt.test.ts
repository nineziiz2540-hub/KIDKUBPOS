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
import type { CartChoices, CartItem } from "../types/app.ts";

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

// ── choices (round D1): bean / sweetness are part of what makes one sale ─────
const kenyaChoices: CartChoices = {
  slots: [{ groupId: "g-bean", memberId: "m-kenya", label: "Kenya", tier: "special", priceDelta: 20 }],
  slotAddGroupIds: [],
  sweetness: { levelId: "lv-normal", levelName: "หวานปกติ", memberId: "sw-milk", memberLabel: "นมมิกซ์" },
};
const withChoices = (c: CartChoices): AttemptInput => ({ ...base, items: [{ ...latte, choices: c }, tea] });

test("an item without choices fingerprints exactly as before round D1", () => {
  const old = JSON.stringify([
    [
      ["latte", 1, 55, null, []],
      ["tea", 1, 50, null, []],
    ],
    "cash",
    "dine_in",
    null,
    null,
    "",
    null,
    null,
  ]);
  assert.equal(attemptFingerprint(base), old);
});

test("changing only the roast changes the fingerprint", () => {
  const house = { ...kenyaChoices, slots: [{ ...kenyaChoices.slots[0]!, memberId: "m-medium" }] };
  assert.notEqual(attemptFingerprint(withChoices(kenyaChoices)), attemptFingerprint(withChoices(house)));
});

test("changing only the sweetness level or the sweetener changes the fingerprint", () => {
  const s = kenyaChoices.sweetness!;
  const fp = attemptFingerprint(withChoices(kenyaChoices));
  assert.notEqual(fp, attemptFingerprint(withChoices({ ...kenyaChoices, sweetness: { ...s, levelId: "lv-less" } })));
  assert.notEqual(fp, attemptFingerprint(withChoices({ ...kenyaChoices, sweetness: { ...s, memberId: "sw-oat" } })));
});

test("the same choices with different labels give the same fingerprint", () => {
  const s = kenyaChoices.sweetness!;
  const relabeled: CartChoices = {
    ...kenyaChoices,
    slots: [{ ...kenyaChoices.slots[0]!, label: "เคนย่า", priceDelta: 25 }],
    sweetness: { ...s, levelName: "x", memberLabel: "y" },
  };
  assert.equal(attemptFingerprint(withChoices(kenyaChoices)), attemptFingerprint(withChoices(relabeled)));
});
