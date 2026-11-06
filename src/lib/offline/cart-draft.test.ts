import { test } from "node:test";
import assert from "node:assert/strict";
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
