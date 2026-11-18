import { test } from "node:test";
import assert from "node:assert/strict";
import { choiceKey } from "./choice-key.ts";
import type { CartChoices } from "../types/app.ts";

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
