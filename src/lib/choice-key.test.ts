import { test } from "node:test";
import assert from "node:assert/strict";
import { choiceKey } from "./choice-key.ts";
import { lineIdentity } from "./held-bill-diff.ts";
import { attemptFingerprint } from "./payment-attempt.ts";
import { saleKey } from "./offline/outbox-rules.ts";
import type { CartChoices, CartItem } from "../types/app.ts";

const kenya: CartChoices = {
  slots: [{ groupId: "g-bean", memberId: "m-kenya", label: "Kenya", tier: "special", priceDelta: 20 }],
  slotAddGroupIds: [],
  sweetness: { levelId: "lv-normal", levelName: "หวานปกติ", memberId: "sw-milk", memberLabel: "นมมิกซ์" },
};

test("choiceKey is the chosen ids only", () => {
  assert.deepEqual(choiceKey(kenya), [[["g-bean", "m-kenya"]], ["lv-normal", "sw-milk"]]);
});

test("labels, prices and tiers do not change the key", () => {
  const renamed: CartChoices = {
    slots: [{ groupId: "g-bean", memberId: "m-kenya", label: "เคนย่า", tier: "house", priceDelta: 0 }],
    slotAddGroupIds: ["x"],
    sweetness: { levelId: "lv-normal", levelName: "x", memberId: "sw-milk", memberLabel: "y" },
  };
  assert.deepEqual(choiceKey(renamed), choiceKey(kenya));
});

test("a different member, level or sweetener changes the key", () => {
  const k = JSON.stringify(choiceKey(kenya));
  const slot = kenya.slots[0]!;
  assert.notEqual(JSON.stringify(choiceKey({ ...kenya, slots: [{ ...slot, memberId: "m-other" }] })), k);
  assert.notEqual(JSON.stringify(choiceKey({ ...kenya, slots: [{ ...slot, groupId: "g-other" }] })), k);
  assert.notEqual(
    JSON.stringify(choiceKey({ ...kenya, sweetness: { ...kenya.sweetness!, levelId: "lv-less" } })),
    k,
  );
  assert.notEqual(
    JSON.stringify(choiceKey({ ...kenya, sweetness: { ...kenya.sweetness!, memberId: "sw-oat" } })),
    k,
  );
});

test("no sweetness gives null as the second element", () => {
  assert.equal(choiceKey({ ...kenya, sweetness: null })[1], null);
});

// ── doubled special / extra shot's house pick: appended, so existing keys never change ──

test("PIN: a line without count or shot keeps its key, payment fingerprint, outbox key and cart identity byte for byte", () => {
  // These strings were produced before count/shot existed; they must never change (a parked bill,
  // an outbox entry or an unresolved payment from before would otherwise stop matching itself).
  assert.equal(JSON.stringify(choiceKey(kenya)), '[[["g-bean","m-kenya"]],["lv-normal","sw-milk"]]');
  const line: CartItem = {
    cartItemKey: "k", productId: "latte", name: "ลาเต้", basePrice: 65, quantity: 1, totalPrice: 85, note: null,
    selectedModifiers: [{ modifierId: "mod", modifierName: "เพิ่ม", optionId: "o-shot", optionName: "เพิ่มช็อต", priceDelta: 15 }],
    choices: kenya,
  };
  assert.equal(lineIdentity(line), '["latte","o-shot","",[[["g-bean","m-kenya"]],["lv-normal","sw-milk"]]]');
  const item = '["latte",1,85,null,["o-shot"],[[["g-bean","m-kenya"]],["lv-normal","sw-milk"]]]';
  assert.equal(
    attemptFingerprint({ items: [line], paymentMethod: "cash", orderType: "dine_in", customerId: null, discountType: null, discountValue: "", heldBillId: null, heldBillVersion: null }),
    `[[${item}],"cash","dine_in",null,null,"",null,null]`
  );
  assert.equal(saleKey({ items: [line], paymentMethod: "cash", orderType: "dine_in" }), `[[${item}],"cash","dine_in",null,null,null,null,null]`);
});

test("count 2 and the shot member are appended to the slot's key", () => {
  const slot = kenya.slots[0]!;
  const shot = { memberId: "m-med", label: "คั่วกลาง", optionIds: ["o-shot"] };
  assert.deepEqual(choiceKey({ ...kenya, slots: [{ ...slot, count: 2 }] })[0], [["g-bean", "m-kenya", 2]]);
  assert.deepEqual(choiceKey({ ...kenya, slots: [{ ...slot, shot }] })[0], [["g-bean", "m-kenya", "m-med"]]);
  assert.deepEqual(choiceKey({ ...kenya, slots: [{ ...slot, count: 2, shot }] })[0], [["g-bean", "m-kenya", 2, "m-med"]]);
  // the shot's label and option ids are not part of it
  assert.deepEqual(
    choiceKey({ ...kenya, slots: [{ ...slot, shot: { ...shot, label: "x", optionIds: [] } }] }),
    choiceKey({ ...kenya, slots: [{ ...slot, shot }] })
  );
  // another shot member is another cup
  assert.notDeepEqual(
    choiceKey({ ...kenya, slots: [{ ...slot, shot: { ...shot, memberId: "m-dark" } }] }),
    choiceKey({ ...kenya, slots: [{ ...slot, shot }] })
  );
});
