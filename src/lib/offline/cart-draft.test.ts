import { test } from "node:test";
import assert from "node:assert/strict";
import type { CartChoices } from "../../types/app.ts";
import { isValidHouseGlass } from "../order-pricing-core.ts";
import { DRAFT_MAX_AGE_MS, draftKey, restorable, toDraft, type DraftState } from "./cart-draft.ts";

const ids = { tenantId: "t1", sellerId: "u1" };

const item = {
  cartItemKey: "k1",
  productId: "p1",
  name: "ลาเต้",
  basePrice: 60,
  quantity: 2,
  selectedModifiers: [
    { modifierId: "m1", modifierName: "ความหวาน", optionId: "o1", optionName: "หวานน้อย", priceDelta: 5 },
  ],
  totalPrice: 130,
  note: "ไม่ใส่น้ำแข็ง",
};

function state(over: Partial<DraftState> = {}): DraftState {
  return {
    savedAt: 1000,
    items: [item],
    orderType: "take_away",
    paymentMethod: "transfer",
    customer: { id: "c1", phone: "0812345678" },
    activeHeld: { id: "h1", version: 3, queueNumber: 7, customerLabel: "พี่เอ" },
    discount: { type: "percent", value: "25", reason: "เพื่อน" },
    ...over,
  };
}

test("draftKey is per tenant and seller", () => {
  assert.equal(draftKey(ids), "cart:t1:u1");
});

test("round trip keeps items, order type, method, customer, held bill and discount", () => {
  const d = toDraft(state(), ids);
  assert.ok(d);
  const back = restorable(JSON.parse(JSON.stringify(d)), ids);
  assert.deepEqual(back, d);
  assert.equal(back?.v, 1);
  assert.equal(back?.items[0]?.note, "ไม่ใส่น้ำแข็ง");
  assert.equal(back?.orderType, "take_away");
  assert.equal(back?.paymentMethod, "transfer");
  assert.deepEqual(back?.customer, { id: "c1", phone: "0812345678" });
  assert.deepEqual(back?.activeHeld, { id: "h1", version: 3, queueNumber: 7, customerLabel: "พี่เอ" });
  assert.deepEqual(back?.discount, { type: "percent", value: "25", reason: "เพื่อน" });
});

test("toDraft never stores a PIN, and drops every unknown key", () => {
  const dirty = { ...state(), approverPin: "9731", approvedForAmount: 9, junk: true } as unknown as DraftState;
  const d = toDraft(dirty, ids);
  assert.ok(d);
  assert.equal(JSON.stringify(d).includes("9731"), false);
  assert.deepEqual(Object.keys(d).sort(), [
    "activeHeld",
    "bags",
    "customer",
    "discount",
    "items",
    "orderType",
    "paymentMethod",
    "savedAt",
    "sellerId",
    "tenantId",
    "v",
  ]);
});

test("another seller or tenant, or a wrong version, gets nothing", () => {
  const d = toDraft(state(), ids);
  assert.equal(restorable(d, { tenantId: "t1", sellerId: "u2" }), null);
  assert.equal(restorable(d, { tenantId: "t2", sellerId: "u1" }), null);
  assert.equal(restorable({ ...d, v: 2 }, ids), null);
});

test("garbage gets nothing", () => {
  for (const g of [undefined, null, 5, "x", [], {}, { v: 1 }, { ...toDraft(state(), ids), items: "no" }]) {
    assert.equal(restorable(g, ids), null);
  }
});

test("a malformed item (non-number price or quantity) gets nothing", () => {
  const d = toDraft(state(), ids);
  assert.equal(restorable({ ...d, items: [{ ...item, basePrice: "60" }] }, ids), null);
  assert.equal(restorable({ ...d, items: [{ ...item, quantity: "2" }] }, ids), null);
  assert.equal(restorable({ ...d, items: [{ ...item, totalPrice: null }] }, ids), null);
  assert.equal(restorable({ ...d, items: [{ ...item, selectedModifiers: [{ priceDelta: "5" }] }] }, ids), null);
});

test("an empty cart with no held bill gives no draft", () => {
  assert.equal(toDraft(state({ items: [], activeHeld: null, discount: null }), ids), null);
});

test("an empty cart with a held bill loaded is still a draft", () => {
  const d = toDraft(state({ items: [] }), ids);
  assert.ok(d);
  assert.equal(d.activeHeld?.id, "h1");
});

test("no discount type means no discount in the draft", () => {
  const d = toDraft(state({ discount: null }), ids);
  assert.equal(d?.discount, null);
});

test("unknown keys inside items and modifiers are stripped", () => {
  const dirtyItem = {
    ...item,
    extra: "x",
    selectedModifiers: [{ ...item.selectedModifiers[0], extra: "y" }],
  };
  const d = toDraft(state({ items: [dirtyItem] as DraftState["items"] }), ids);
  assert.deepEqual(d?.items[0], item);
  const back = restorable({ ...d, items: [dirtyItem] }, ids);
  assert.deepEqual(back?.items[0], item);
});

test("a draft older than 12 hours is ignored", () => {
  const d = toDraft(state({ savedAt: 1000 }), ids);
  assert.ok(restorable(d, ids, 1000 + DRAFT_MAX_AGE_MS));
  assert.equal(restorable(d, ids, 1000 + DRAFT_MAX_AGE_MS + 1), null);
});

// ── choices (round D1) ──────────────────────────────────────────────────────
const choices: CartChoices = {
  slots: [{ groupId: "g-bean", memberId: "m-kenya", label: "Kenya", tier: "special", priceDelta: 20 }],
  slotAddGroupIds: ["g-bean"],
  sweetness: { levelId: "lv-normal", levelName: "หวานปกติ", memberId: "sw-milk", memberLabel: "นมมิกซ์" },
};
const roundTrip = (it: unknown) =>
  restorable(JSON.parse(JSON.stringify(toDraft(state({ items: [it as DraftState["items"][0]] }), ids))), ids);

test("choices survive a save and reload unchanged", () => {
  const back = roundTrip({ ...item, choices });
  assert.deepEqual(back?.items[0]!.choices, choices);
  const noSweet = roundTrip({ ...item, choices: { ...choices, sweetness: null } });
  assert.equal(noSweet?.items[0]!.choices?.sweetness, null);
});

test("an item without choices comes back with no choices key", () => {
  const back = roundTrip(item);
  assert.ok(back);
  assert.equal("choices" in back.items[0]!, false);
});

test("unknown keys inside choices, slots and sweetness are stripped", () => {
  const dirty = {
    ...item,
    choices: {
      ...choices,
      extra: 1,
      slots: [{ ...choices.slots[0]!, extra: 2 }],
      sweetness: { ...choices.sweetness, extra: 3 },
    },
  };
  assert.deepEqual(
    toDraft(state({ items: [dirty] as unknown as DraftState["items"] }), ids)?.items[0]!.choices,
    choices,
  );
  const raw = JSON.parse(JSON.stringify(toDraft(state({ items: [{ ...item, choices }] }), ids)));
  raw.items[0]!.choices = dirty.choices;
  assert.deepEqual(restorable(raw, ids)?.items[0]!.choices, choices);
});

test("a doubled special and an extra shot's house pick survive a save and reload", () => {
  const doubled: CartChoices = {
    ...choices,
    slots: [{ ...choices.slots[0]!, count: 2, shot: { memberId: "m-med", label: "คั่วกลาง", optionIds: ["o-shot"] } }],
  };
  assert.deepEqual(roundTrip({ ...item, choices: doubled })?.items[0]!.choices, doubled);
  // unknown keys inside the shot are stripped too
  const raw = JSON.parse(JSON.stringify(toDraft(state({ items: [{ ...item, choices: doubled }] }), ids)));
  raw.items[0]!.choices.slots[0].shot.materialId = "mat-med";
  assert.deepEqual(restorable(raw, ids)?.items[0]!.choices, doubled);
  // count 1 means ×1: accepted like the server does, and not kept
  const one = roundTrip({ ...item, choices: { ...choices, slots: [{ ...choices.slots[0]!, count: 1 }] } });
  assert.ok(one);
  assert.equal("count" in one.items[0]!.choices!.slots[0]!, false);
});

test("a malformed count or shot makes the draft not restorable", () => {
  const slot = choices.slots[0]!;
  const bad = [
    { ...slot, count: 3 },
    { ...slot, count: "2" },
    { ...slot, count: null },
    { ...slot, shot: null },
    { ...slot, shot: { label: "x", optionIds: [] } },
    { ...slot, shot: { memberId: 1, label: "x", optionIds: [] } },
    { ...slot, shot: { memberId: "m", optionIds: [] } },
    { ...slot, shot: { memberId: "m", label: "x" } },
    { ...slot, shot: { memberId: "m", label: "x", optionIds: [1] } },
  ];
  for (const s of bad) {
    const raw = JSON.parse(JSON.stringify(toDraft(state(), ids)));
    raw.items[0]!.choices = { ...choices, slots: [s] };
    assert.equal(restorable(raw, ids), null, JSON.stringify(s));
  }
});

test("malformed choices make the draft not restorable", () => {
  const bad = [
    { ...choices, slots: [{ ...choices.slots[0]!, tier: "gold" }] },
    { ...choices, slots: [{ ...choices.slots[0]!, priceDelta: "20" }] },
    { slots: choices.slots, sweetness: choices.sweetness },
    { ...choices, sweetness: { levelId: 1 } },
    { ...choices, slots: "x" },
    { ...choices, slotAddGroupIds: [1] },
    "kenya",
    null,
  ];
  for (const c of bad) {
    const raw = JSON.parse(JSON.stringify(toDraft(state(), ids)));
    raw.items[0]!.choices = c;
    assert.equal(restorable(raw, ids), null, JSON.stringify(c));
  }
});

test("draft restores bags and houseGlass; a pre-D2a draft restores with bags 0", () => {
  const glassItem = { ...item, houseGlass: true };
  const saved = JSON.parse(JSON.stringify(toDraft(state({ items: [glassItem], bags: 3 }), ids)));
  const back = restorable(saved, ids);
  assert.equal(back!.bags, 3);
  assert.equal(back!.items[0]!.houseGlass, true);
  // a draft saved before D2a has neither key
  const old = JSON.parse(JSON.stringify(toDraft(state(), ids)));
  delete old.bags;
  const oldBack = restorable(old, ids);
  assert.equal(oldBack!.bags, 0);
  assert.ok(!("houseGlass" in oldBack!.items[0]!));
  // a malformed bag count is dropped, the cart still comes back
  assert.equal(restorable({ ...saved, bags: 100 }, ids)!.bags, 0);
  assert.equal(restorable({ ...saved, bags: 1.5 }, ids)!.bags, 0);
});

test("houseGlass that is not a boolean is refused (createOrder, draft, outbox)", () => {
  // createOrder and the outbox sync (which calls createOrder) share this one shape check
  for (const bad of ["yes", "true", 1, 0, null, {}]) assert.equal(isValidHouseGlass(bad), false, String(bad));
  for (const ok of [true, false, undefined]) assert.equal(isValidHouseGlass(ok), true);
  // draft leg
  const d = JSON.parse(JSON.stringify(toDraft(state(), ids)));
  for (const bad of ["yes", 1, null]) {
    d.items[0].houseGlass = bad;
    assert.equal(restorable(d, ids), null, String(bad));
  }
  d.items[0].houseGlass = false;
  assert.equal(restorable(d, ids)!.items[0]!.houseGlass, false);
  delete d.items[0].houseGlass;
  assert.ok(restorable(d, ids));
});
