import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHeldItems } from "./held-bill-items.ts";
import { priceLines, type PricingCatalog } from "./order-pricing-core.ts";
import { lineTotal } from "./cart-math.ts";
import { emptyStockCatalog, type StockCatalog } from "./stock/stock-core.ts";
import type { CartChoices, CartItem } from "../types/app.ts";

function stockCatalog(): StockCatalog {
  const stock = emptyStockCatalog();
  const m = (id: string, groupId: string, label: string, tier: "house" | "special", priceDelta: number, isDefault = false) => ({
    id, groupId, materialId: `mat_${id}`, label, tier, priceDelta, isDefault, sortOrder: 1,
  });
  stock.groups.set("beans", {
    id: "beans", kind: "bean", name: "เมล็ด",
    members: [m("m_house", "beans", "เมล็ดบ้าน", "house", 0, true), m("m_kenya", "beans", "เคนย่า", "special", 20)],
  });
  stock.groups.set("sweet", {
    id: "sweet", kind: "sweetener", name: "ความหวาน",
    members: [m("m_syrup", "sweet", "น้ำเชื่อม", "house", 0, true), m("m_mix", "sweet", "นมมิกซ์", "house", 0)],
  });
  stock.recipes.set("latte", [
    { kind: "slot", groupId: "beans", qty: 18, defaultMemberId: "m_house", allowSpecial: true },
  ]);
  stock.levels = [
    { id: "none", name: "ไม่หวาน", isNone: true, isDefault: false, sortOrder: 1 },
    { id: "less", name: "หวานน้อย", isNone: false, isDefault: false, sortOrder: 2 },
    { id: "normal", name: "หวานปกติ", isNone: false, isDefault: true, sortOrder: 3 },
  ];
  stock.productSweetness.set("latte", {
    groupId: "sweet", defaultMemberId: "m_syrup", allowedMemberIds: ["m_mix"], defaultLevelId: null, custom: null,
  });
  stock.optionEffects.set("shot", [{ kind: "slot_add", groupId: "beans", qty: 9 }]);
  return stock;
}

function catalog(stock: StockCatalog = stockCatalog()): PricingCatalog {
  return {
    products: new Map([
      ["latte", { id: "latte", name: "ลาเต้", price: 65, is_active: true, archived_at: null, categories: { name: "กาแฟ" } }],
    ]),
    linkedModifiers: new Map([["latte", new Set(["extras"])]]),
    modifiers: new Map([["extras", { id: "extras", name: "เพิ่ม", is_required: false, is_multi_select: true }]]),
    options: new Map([
      ["shot", { id: "shot", name: "เพิ่มช็อต", price_delta: 10, modifier_id: "extras" }],
      ["pearl", { id: "pearl", name: "ไข่มุก", price_delta: 5, modifier_id: "extras" }],
    ]),
    stock,
  };
}

function cartItem(optionIds: string[], quantity: number, totalPrice: number, choices?: CartChoices): CartItem {
  return {
    cartItemKey: "k1",
    productId: "latte",
    name: "client name",
    basePrice: 999,
    quantity,
    selectedModifiers: optionIds.map((optionId) => ({
      modifierId: "extras", modifierName: "client", optionId, optionName: "client", priceDelta: 0,
    })),
    totalPrice,
    note: "เย็น",
    ...(choices ? { choices } : {}),
  };
}

const kenya = (label = "เคนย่า"): CartChoices["slots"][number] => ({
  groupId: "beans", memberId: "m_kenya", label, tier: "special", priceDelta: 20,
});

function price(items: CartItem[]) {
  const r = priceLines(items, catalog());
  assert.ok(!("error" in r), JSON.stringify(r));
  return r.lines;
}

test("a specialty latte keeps the menu price as base and the bean as a choice", () => {
  // (65 + shot 10 + kenya 20 once: the shot uses the house bean) x 2
  const items = [cartItem(["shot"], 2, 190, { slots: [kenya()], slotAddGroupIds: ["beans"], sweetness: null })];
  const lines = price(items);
  const [out] = normalizeHeldItems(items, lines);
  assert.equal(out!.basePrice, 65);
  assert.deepEqual(out!.choices!.slots[0], {
    groupId: "beans", memberId: "m_kenya", label: "เคนย่า", tier: "special", priceDelta: 20,
    shot: { memberId: "m_house", label: "เมล็ดบ้าน", optionIds: ["shot"] },
  });
  assert.deepEqual(out!.choices!.slotAddGroupIds, ["beans"]);
  assert.equal(lineTotal(out!.basePrice, out!.selectedModifiers, out!.quantity, out!.choices), lines[0]!.lineTotal);
  assert.equal(out!.totalPrice, lines[0]!.lineTotal);
});

test("a doubled special and the extra shot's house pick are kept from the server snapshot (no material id)", () => {
  const stock = stockCatalog();
  stock.groups.get("beans")!.members.push({
    id: "m_dark", groupId: "beans", materialId: "mat_m_dark", label: "คั่วเข้ม", tier: "house", priceDelta: 0, isDefault: false, sortOrder: 2,
  });
  const items = [cartItem(["shot"], 1, 65 + 10 + 40, {
    slots: [{ ...kenya("FAKE"), count: 2, shot: { memberId: "m_dark", label: "FAKE", optionIds: ["FAKE"] } }],
    slotAddGroupIds: [], sweetness: null,
  })];
  const r = priceLines(items, catalog(stock));
  assert.ok(!("error" in r), JSON.stringify(r));
  const [out] = normalizeHeldItems(items, r.lines);
  assert.deepEqual(out!.choices!.slots, [{
    groupId: "beans", memberId: "m_kenya", label: "เคนย่า", tier: "special", priceDelta: 20, count: 2,
    shot: { memberId: "m_dark", label: "คั่วเข้ม", optionIds: ["shot"] },
  }]);
  assert.equal(lineTotal(out!.basePrice, out!.selectedModifiers, out!.quantity, out!.choices), 115);
  // reopened and paid again: same total, same stock
  const again = priceLines([out!], catalog(stock));
  assert.ok(!("error" in again), JSON.stringify(again));
  assert.equal(again.lines[0]!.lineTotal, 115);
  assert.deepEqual(again.lines[0]!.stock, r.lines[0]!.stock);
  // no count on a ×1 cup and no shot on a house cup
  const plain = [cartItem(["shot"], 1, 75, { slots: [{ ...kenya(), memberId: "m_house", tier: "house", priceDelta: 0 }], slotAddGroupIds: [], sweetness: null })];
  const [p] = normalizeHeldItems(plain, price(plain));
  assert.deepEqual(Object.keys(p!.choices!.slots[0]!).sort(), ["groupId", "label", "memberId", "priceDelta", "tier"]);
});

test("reopening a parked bill re-prices to the same totals", () => {
  const items = [
    cartItem(["shot"], 2, 190, { slots: [kenya()], slotAddGroupIds: ["beans"], sweetness: null }),
    { ...cartItem(["pearl"], 1, 70), cartItemKey: "k2" },
  ];
  const lines = price(items);
  const stored = normalizeHeldItems(items, lines);
  const again = priceLines(stored, catalog());
  assert.ok(!("error" in again), JSON.stringify(again));
  assert.deepEqual(again.lines.map((l) => l.lineTotal), lines.map((l) => l.lineTotal));
  stored.forEach((s, i) =>
    assert.equal(lineTotal(s.basePrice, s.selectedModifiers, s.quantity, s.choices), lines[i]!.lineTotal));
});

test("a client's own labels are not stored", () => {
  const items = [cartItem([], 1, 85, { slots: [kenya("FAKE")], slotAddGroupIds: [], sweetness: null })];
  const [out] = normalizeHeldItems(items, price(items));
  assert.equal(out!.choices!.slots[0]!.label, "เคนย่า");
});

test("a pre-D1 item gets no choices key and the old fields", () => {
  const items = [cartItem(["pearl"], 2, 140)];
  const lines = price(items);
  const [out] = normalizeHeldItems(items, lines);
  assert.ok(!("choices" in out!));
  assert.deepEqual(out, {
    cartItemKey: "k1",
    productId: "latte",
    name: "ลาเต้",
    basePrice: 65,
    quantity: 2,
    selectedModifiers: [
      { modifierId: "extras", optionId: "pearl", modifierName: "เพิ่ม", optionName: "ไข่มุก", priceDelta: 5 },
    ],
    totalPrice: 140,
    note: "เย็น",
  });
});

test("sweetness is stored from the catalog, and no sweetness has no sweetener", () => {
  const less = [cartItem([], 1, 65, {
    slots: [], slotAddGroupIds: [],
    sweetness: { levelId: "less", levelName: "x", memberId: "m_mix", memberLabel: "x" },
  })];
  const [a] = normalizeHeldItems(less, price(less));
  assert.deepEqual(a!.choices!.sweetness, { levelId: "less", levelName: "หวานน้อย", memberId: "m_mix", memberLabel: "นมมิกซ์" });
  const none = [cartItem([], 1, 65, {
    slots: [], slotAddGroupIds: [],
    sweetness: { levelId: "none", levelName: "x", memberId: null, memberLabel: null },
  })];
  const [b] = normalizeHeldItems(none, price(none));
  assert.deepEqual(b!.choices!.sweetness, { levelId: "none", levelName: "ไม่หวาน", memberId: null, memberLabel: null });
});

test("held bill items keep houseGlass after normalizeHeldItems", () => {
  const items = [
    { ...cartItem([], 1, 65), houseGlass: true },
    { ...cartItem([], 1, 65), houseGlass: false },
    cartItem([], 1, 65),
  ];
  const out = normalizeHeldItems(items, price(items));
  assert.equal(out[0]!.houseGlass, true);
  assert.equal(out[1]!.houseGlass, false);
  assert.ok(!("houseGlass" in out[2]!), "absent stays absent");
});
