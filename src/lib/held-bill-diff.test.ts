import { test } from "node:test";
import assert from "node:assert/strict";
import { diffReductions, lineIdentity } from "./held-bill-diff.ts";
import { choiceKey } from "./choice-key.ts";
import type { CartChoices, CartItem } from "../types/app.ts";

const shot = { modifierId: "m1", modifierName: "ช็อต", optionId: "o-shot", optionName: "เพิ่มช็อต", priceDelta: 10 };
const latte: CartItem = {
  cartItemKey: "k",
  productId: "p1",
  name: "ลาเต้",
  basePrice: 55,
  quantity: 2,
  selectedModifiers: [shot],
  totalPrice: 130,
  note: "ร้อน",
};
const choices = (
  member: string,
  label: string,
  level: string,
  levelName: string,
  sw: string | null,
  swLabel: string | null,
): CartChoices => ({
  slots: [{ groupId: "g-bean", memberId: member, label, tier: member === "m-kenya" ? "special" : "house", priceDelta: 0 }],
  slotAddGroupIds: [],
  sweetness: { levelId: level, levelName, memberId: sw, memberLabel: swLabel },
});
const kenya = choices("m-kenya", "Kenya", "lv-normal", "หวานปกติ", "sw-milk", "นมมิกซ์");

test("an item without choices keeps exactly the old identity string", () => {
  assert.equal(lineIdentity(latte), "p1|o-shot|ร้อน");
  assert.equal(lineIdentity({ ...latte, note: null, selectedModifiers: [] }), "p1||");
});

test("an item with choices gets the serialised choice key appended", () => {
  assert.equal(
    lineIdentity({ ...latte, choices: kenya }),
    '["p1","o-shot","ร้อน",[[["g-bean","m-kenya"]],["lv-normal","sw-milk"]]]',
  );
});

test("a crafted note cannot imitate the choice segment", () => {
  const forged = { ...latte, note: "x|" + JSON.stringify(choiceKey(kenya)) };
  const real = { ...latte, note: "x", choices: kenya };
  assert.notEqual(lineIdentity(forged), lineIdentity(real));
  const house = choices("m-house", "House", "lv-normal", "หวานปกติ", "sw-milk", "นมมิกซ์");
  // Kenya line swapped for a no-choices line carrying the forged note: still a reduction.
  const r = diffReductions([real], [{ ...forged, choices: undefined }]);
  assert.equal(r.length, 1);
  assert.ok(r[0]!.options.includes("Kenya"));
  assert.equal(diffReductions([real], [{ ...real, choices: house }]).length, 1);
});

test("choices: undefined as an own key keeps the old identity string", () => {
  assert.equal(lineIdentity({ ...latte, choices: undefined }), "p1|o-shot|ร้อน");
});

test("2 Kenya lattes becoming 2 house lattes records a reduction with the choice names", () => {
  const house = choices("m-house", "House", "lv-normal", "หวานปกติ", "sw-milk", "นมมิกซ์");
  const r = diffReductions([{ ...latte, choices: kenya }], [{ ...latte, choices: house }]);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.fromQty, 2);
  assert.equal(r[0]!.toQty, 0);
  assert.deepEqual(r[0]!.options, ["เพิ่มช็อต", "Kenya", "หวานปกติ", "นมมิกซ์"]);
});

test("same choices with different labels records nothing", () => {
  const relabeled = choices("m-kenya", "เคนย่า", "lv-normal", "ปกติ", "sw-milk", "นม");
  assert.deepEqual(diffReductions([{ ...latte, choices: kenya }], [{ ...latte, choices: relabeled }]), []);
});

test("normal sweetness becoming less sweet records a reduction", () => {
  const less = choices("m-kenya", "Kenya", "lv-less", "หวานน้อย", "sw-milk", "นมมิกซ์");
  const r = diffReductions([{ ...latte, choices: kenya }], [{ ...latte, choices: less }]);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.toQty, 0);
});

test("without choices the reduction options are just the modifier names", () => {
  const r = diffReductions([latte], [{ ...latte, quantity: 1 }]);
  assert.deepEqual(r, [{ name: "ลาเต้", options: ["เพิ่มช็อต"], note: "ร้อน", fromQty: 2, toQty: 1 }]);
});

test("a sweetness with no sweetener lists only the level name", () => {
  const plain = choices("m-kenya", "Kenya", "lv-0", "ไม่หวาน", null, null);
  const r = diffReductions([{ ...latte, choices: plain }], []);
  assert.deepEqual(r[0]!.options, ["เพิ่มช็อต", "Kenya", "ไม่หวาน"]);
});
