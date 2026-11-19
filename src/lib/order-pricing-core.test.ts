import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidCartChoices, priceLines, priceLinesAsCharged, STALE, toLineChoices, type PricingCatalog } from "./order-pricing-core.ts";
import type { CartItem } from "../types/app.ts";
import { emptyStockCatalog, type StockCatalog } from "./stock/stock-core.ts";

const BAD = "ข้อมูลสินค้าในตะกร้าไม่ถูกต้อง";

function catalog(overrides: { archived?: boolean; price?: number; stock?: StockCatalog } = {}): PricingCatalog {
  return {
    products: new Map([
      [
        "latte",
        {
          id: "latte",
          name: "ลาเต้",
          price: overrides.price ?? 55,
          is_active: true,
          archived_at: overrides.archived ? "2026-10-01T00:00:00Z" : null,
          categories: { name: "กาแฟ" },
        },
      ],
    ]),
    linkedModifiers: new Map([["latte", new Set(["size", "topping"])]]),
    modifiers: new Map([
      ["size", { id: "size", name: "ขนาด", is_required: true, is_multi_select: false }],
      ["topping", { id: "topping", name: "ท็อปปิ้ง", is_required: false, is_multi_select: true }],
      ["other", { id: "other", name: "อื่นๆ", is_required: false, is_multi_select: true }],
    ]),
    options: new Map([
      ["large", { id: "large", name: "ใหญ่", price_delta: 10, modifier_id: "size" }],
      ["small", { id: "small", name: "เล็ก", price_delta: 0, modifier_id: "size" }],
      ["pearl", { id: "pearl", name: "ไข่มุก", price_delta: 5, modifier_id: "topping" }],
      ["foreign", { id: "foreign", name: "แปลก", price_delta: 0, modifier_id: "other" }],
    ]),
    stock: overrides.stock ?? emptyStockCatalog(),
  };
}

function item(optionIds: string[], totalPrice: number, extra: Partial<CartItem> = {}): CartItem {
  return {
    cartItemKey: "k",
    productId: "latte",
    name: "ลาเต้",
    basePrice: 55,
    quantity: 2,
    selectedModifiers: optionIds.map((optionId) => ({
      modifierId: "",
      modifierName: "",
      optionId,
      optionName: "",
      priceDelta: 0,
    })),
    note: null,
    totalPrice,
    ...extra,
  } as CartItem;
}

test("a valid line is priced from the catalog", () => {
  const r = priceLines([item(["large", "pearl"], 140)], catalog());
  assert.ok(!("error" in r));
  assert.equal(r.subtotal, 140);
  assert.equal(r.lines[0]!.unitPrice, 70);
  assert.equal(r.lines[0]!.modifiersSnapshot?.length, 2);
});

test("a client total that differs from the catalog is stale", () => {
  assert.deepEqual(priceLines([item(["large", "pearl"], 139)], catalog()), { error: STALE });
});

test("a missing required option is stale", () => {
  assert.deepEqual(priceLines([item(["pearl"], 120)], catalog()), { error: STALE });
});

test("two options of a single-select modifier are invalid", () => {
  assert.deepEqual(priceLines([item(["large", "small"], 130)], catalog()), { error: BAD });
});

test("an option of an unlinked modifier is stale", () => {
  assert.deepEqual(priceLines([item(["large", "foreign"], 130)], catalog()), { error: STALE });
});

test("an archived product is stale", () => {
  assert.deepEqual(priceLines([item(["large"], 130)], catalog({ archived: true })), { error: STALE });
});

test("the same option twice in one line is invalid", () => {
  assert.deepEqual(priceLines([item(["large", "pearl", "pearl"], 150)], catalog()), { error: BAD });
});

test("a note over 200 characters is refused", () => {
  assert.deepEqual(priceLines([item(["large"], 130, { note: "ก".repeat(201) })], catalog()), {
    error: "หมายเหตุไม่ถูกต้อง (ไม่เกิน 200 ตัวอักษร)",
  });
});

// ── priceLinesAsCharged ("record as charged") ───────────────────────────────

test("as charged: a changed price keeps the device total and reports the catalog total", () => {
  // Sold at 55 + 10 (large) × 2 = 130; the latte now costs 60, so the catalog says 140.
  const r = priceLinesAsCharged([item(["large"], 130, { name: "ลาเต้เก่า" })], catalog({ price: 60 }));
  assert.ok(!("error" in r));
  assert.equal(r.subtotal, 130);
  assert.equal(r.serverSubtotal, 140);
  assert.equal(r.lines[0]!.lineTotal, 130);
  assert.equal(r.lines[0]!.unitPrice, 65);
  assert.equal(r.lines[0]!.productName, "ลาเต้");
  assert.equal(r.lines[0]!.categoryName, "กาแฟ");
  assert.deepEqual(r.lines[0]!.modifiersSnapshot, [{ group: "ขนาด", option: "ใหญ่", priceDelta: 0, optionId: "large" }]);
});

test("as charged: a product no longer in the catalog can't be recorded", () => {
  assert.deepEqual(
    priceLinesAsCharged([item(["large"], 130, { productId: "gone" })], catalog()),
    { error: "product_missing" }
  );
});

test("as charged: an archived product still records, with catalog names and no server total", () => {
  const r = priceLinesAsCharged([item(["large"], 130)], catalog({ archived: true }));
  assert.ok(!("error" in r));
  assert.equal(r.subtotal, 130);
  assert.equal(r.serverSubtotal, null);
  assert.equal(r.lines[0]!.productName, "ลาเต้");
});

test("as charged: a note over 200 characters is cut, not refused", () => {
  const r = priceLinesAsCharged([item(["large"], 130, { note: "ก".repeat(201) })], catalog());
  assert.ok(!("error" in r));
  assert.equal(r.lines[0]!.note, "ก".repeat(200));
});

// ---- round D1: bean/sweetness choices and specialty prices ----

function beanStock(): StockCatalog {
  const stock = emptyStockCatalog();
  const m = (id: string, tier: "house" | "special", priceDelta: number, isDefault = false) => ({
    id, groupId: "beans", materialId: `mat_${id}`, label: id, tier, priceDelta, isDefault, sortOrder: 1,
  });
  stock.groups.set("beans", {
    id: "beans", kind: "bean", name: "เมล็ด",
    members: [m("m_house", "house", 0, true), m("m_kenya", "special", 20)],
  });
  stock.recipes.set("latte", [
    { kind: "slot", groupId: "beans", qty: 18, defaultMemberId: "m_house", allowSpecial: true },
  ]);
  return stock;
}

function beanItem(memberId: string | null, totalPrice: number, extra: Partial<CartItem> = {}): CartItem {
  return item(["small"], totalPrice, {
    quantity: 1,
    ...(memberId
      ? {
          choices: {
            slots: [{ groupId: "beans", memberId, label: "x", tier: "special", priceDelta: 20 }],
            slotAddGroupIds: [],
            sweetness: null,
          },
        }
      : {}),
    ...extra,
  });
}

test("a specialty bean is part of the server price", () => {
  const r = priceLines([beanItem("m_kenya", 75)], catalog({ stock: beanStock() }));
  assert.ok(!("error" in r));
  assert.equal(r.lines[0]!.unitPrice, 75);
  assert.equal(r.subtotal, 75);
  assert.deepEqual(r.lines[0]!.stock, [{ materialId: "mat_m_kenya", qty: 18 }]);
  assert.equal(r.lines[0]!.choicesSnapshot.slots[0]!.memberId, "m_kenya");
});

test("a client that leaves out the specialty price is stale", () => {
  assert.deepEqual(priceLines([beanItem("m_kenya", 55)], catalog({ stock: beanStock() })), { error: STALE });
});

test("a client cannot lie its way to a cheaper bean through display fields", () => {
  const cheat = beanItem("m_kenya", 55, {
    choices: { slots: [{ groupId: "beans", memberId: "m_kenya", label: "x", tier: "house", priceDelta: 0 }], slotAddGroupIds: [], sweetness: null },
  });
  assert.deepEqual(priceLines([cheat], catalog({ stock: beanStock() })), { error: STALE });
});

test("a cart line without choices (pre-D1) prices as before", () => {
  const r = priceLines([item(["large", "pearl"], 140)], catalog({ stock: beanStock() }));
  assert.ok(!("error" in r));
  assert.equal(r.lines[0]!.unitPrice, 70);
  assert.deepEqual(r.lines[0]!.stock, [{ materialId: "mat_m_house", qty: 36 }]);
  const plain = priceLines([item(["large", "pearl"], 140)], catalog());
  assert.ok(!("error" in plain));
  assert.deepEqual(plain.lines[0]!.stock, []);
  assert.deepEqual(plain.lines[0]!.choicesSnapshot, { slots: [], slotAddGroupIds: [], sweetness: null });
  assert.equal(plain.lines[0]!.basePrice, 55);
});

test("as charged keeps the device total but still resolves stock", () => {
  const r = priceLinesAsCharged([beanItem("m_kenya", 60)], catalog({ stock: beanStock() }));
  assert.ok(!("error" in r));
  assert.equal(r.subtotal, 60);
  assert.equal(r.serverSubtotal, 75);
  assert.deepEqual(r.lines[0]!.stock, [{ materialId: "mat_m_kenya", qty: 18 }]);
  assert.equal(r.lines[0]!.choicesSnapshot.slots[0]!.memberId, "m_kenya");
});

test("a specialty bean is charged per cup on quantity 2", () => {
  const r = priceLines([beanItem("m_kenya", 150, { quantity: 2 })], catalog({ stock: beanStock() }));
  assert.ok(!("error" in r));
  assert.equal(r.lines[0]!.lineTotal, 150);
  assert.deepEqual(r.lines[0]!.stock, [{ materialId: "mat_m_kenya", qty: 36 }]);
});

test("a slot_add option on a special cup uses the house bean and adds only its own price", () => {
  const stock = beanStock();
  stock.optionEffects.set("pearl", [{ kind: "slot_add", groupId: "beans", qty: 9 }]);
  const r = priceLines(
    [beanItem("m_kenya", 80, { selectedModifiers: item(["small", "pearl"], 0).selectedModifiers })],
    catalog({ stock })
  );
  assert.ok(!("error" in r), JSON.stringify(r));
  // 55 + pearl 5 + kenya 20 once
  assert.equal(r.lines[0]!.unitPrice, 80);
  assert.deepEqual(r.lines[0]!.stock, [{ materialId: "mat_m_house", qty: 9 }, { materialId: "mat_m_kenya", qty: 18 }]);
  assert.deepEqual(r.lines[0]!.choicesSnapshot.slots[0]!.shot, { memberId: "m_house", materialId: "mat_m_house", label: "m_house", optionIds: ["pearl"] });
  // the old price (special charged again for the shot) is now stale
  assert.deepEqual(
    priceLines([beanItem("m_kenya", 100, { selectedModifiers: item(["small", "pearl"], 0).selectedModifiers })], catalog({ stock })),
    { error: STALE }
  );
});

test("a doubled special (count 2) is charged twice and deducts two doses; the shot pick reaches the server", () => {
  const stock = beanStock();
  stock.optionEffects.set("pearl", [{ kind: "slot_add", groupId: "beans", qty: 9 }]);
  const doubled = (shot?: string) => ({
    slots: [{
      groupId: "beans", memberId: "m_kenya", label: "x", tier: "special" as const, priceDelta: 20, count: 2 as const,
      ...(shot ? { shot: { memberId: shot, label: "x", optionIds: ["pearl"] } } : {}),
    }],
    slotAddGroupIds: [],
    sweetness: null,
  });
  const r = priceLines([beanItem("m_kenya", 95, { choices: doubled() })], catalog({ stock }));
  assert.ok(!("error" in r), JSON.stringify(r));
  assert.equal(r.lines[0]!.unitPrice, 95);
  assert.deepEqual(r.lines[0]!.stock, [{ materialId: "mat_m_kenya", qty: 36 }]);
  assert.equal(r.lines[0]!.choicesSnapshot.slots[0]!.count, 2);
  // a forged special shot pick is ignored: the shot still uses the house bean
  const s = priceLines(
    [beanItem("m_kenya", 100, { choices: doubled("m_kenya"), selectedModifiers: item(["small", "pearl"], 0).selectedModifiers })],
    catalog({ stock })
  );
  assert.ok(!("error" in s), JSON.stringify(s));
  assert.deepEqual(s.lines[0]!.stock, [{ materialId: "mat_m_house", qty: 9 }, { materialId: "mat_m_kenya", qty: 36 }]);
});

test("toLineChoices passes count 2 and the shot member id, and nothing else", () => {
  const slot = { groupId: "g", memberId: "m", label: "x", tier: "special" as const, priceDelta: 20 };
  assert.deepEqual(toLineChoices({ slots: [slot], slotAddGroupIds: ["g"], sweetness: null }), {
    slots: [{ groupId: "g", memberId: "m" }], sweetness: null,
  });
  assert.deepEqual(
    toLineChoices({ slots: [{ ...slot, count: 2, shot: { memberId: "h", label: "y", optionIds: ["o"] } }], slotAddGroupIds: [], sweetness: null }),
    { slots: [{ groupId: "g", memberId: "m", count: 2, shotMemberId: "h" }], sweetness: null }
  );
  // a count 1 from a client is dropped (same as absent)
  const one = toLineChoices({ slots: [{ ...slot, count: 1 as unknown as 2 }], slotAddGroupIds: [], sweetness: null });
  assert.deepEqual(one, { slots: [{ groupId: "g", memberId: "m" }], sweetness: null });
});

test("modifiersSnapshot entries carry the option id in both pricing paths", () => {
  const r = priceLines([item(["large", "pearl"], 140)], catalog());
  assert.ok(!("error" in r));
  assert.deepEqual(r.lines[0]!.modifiersSnapshot, [
    { group: "ขนาด", option: "ใหญ่", priceDelta: 10, optionId: "large" },
    { group: "ท็อปปิ้ง", option: "ไข่มุก", priceDelta: 5, optionId: "pearl" },
  ]);
  const charged = priceLinesAsCharged([item(["large", "pearl"], 140)], catalog());
  assert.ok(!("error" in charged));
  assert.deepEqual(charged.lines[0]!.modifiersSnapshot!.map((m) => m.optionId), ["large", "pearl"]);
  // an option gone from the catalog keeps the device's id and words
  const gone = priceLinesAsCharged(
    [item(["large"], 130, { selectedModifiers: [{ modifierId: "x", modifierName: "เก่า", optionId: "old", optionName: "เดิม", priceDelta: 3 }] })],
    catalog()
  );
  assert.ok(!("error" in gone));
  assert.deepEqual(gone.lines[0]!.modifiersSnapshot, [{ group: "เก่า", option: "เดิม", priceDelta: 3, optionId: "old" }]);
});

test("as charged keeps default stock and snapshot when the special bean is no longer allowed", () => {
  const stock = beanStock();
  stock.recipes.set("latte", [
    { kind: "slot", groupId: "beans", qty: 18, defaultMemberId: "m_house", allowSpecial: false },
    { kind: "fixed", materialId: "milk", qty: 100 },
  ]);
  const r = priceLinesAsCharged([beanItem("m_kenya", 75)], catalog({ stock }));
  assert.ok(!("error" in r));
  assert.deepEqual(r.lines[0]!.stock, [
    { materialId: "mat_m_house", qty: 18 },
    { materialId: "milk", qty: 100 },
  ]);
  assert.equal(r.lines[0]!.choicesSnapshot.slots[0]!.memberId, "m_house");
  assert.equal(r.serverSubtotal, null);
});

test("isValidCartChoices shape-checks the client's choices", () => {
  assert.equal(isValidCartChoices(undefined), true);
  assert.equal(isValidCartChoices({ slots: [{ groupId: "g", memberId: "m" }], sweetness: null }), true);
  assert.equal(isValidCartChoices({ slots: [], sweetness: { levelId: "l", memberId: null } }), true);
  assert.equal(isValidCartChoices(1), false);
  assert.equal(isValidCartChoices(null), false);
  assert.equal(isValidCartChoices({ slots: 1 }), false);
  assert.equal(isValidCartChoices({ slots: {} }), false);
  assert.equal(isValidCartChoices({ slots: [null] }), false);
  assert.equal(isValidCartChoices({ slots: [{ groupId: "g" }] }), false);
  assert.equal(isValidCartChoices({ slots: Array.from({ length: 9 }, () => ({ groupId: "g", memberId: "m" })) }), false);
  assert.equal(isValidCartChoices({ slots: [], sweetness: { levelId: 1 } }), false);
});

test("isValidCartChoices: a slot's count is absent, 1 or 2; its shot is absent or has a string memberId", () => {
  const slot = { groupId: "g", memberId: "m" };
  for (const ok of [
    { ...slot }, { ...slot, count: 1 }, { ...slot, count: 2 },
    { ...slot, shot: { memberId: "h" } }, { ...slot, count: 2, shot: { memberId: "h", label: "x", optionIds: ["o"] } },
  ]) {
    assert.equal(isValidCartChoices({ slots: [ok], sweetness: null }), true, JSON.stringify(ok));
  }
  for (const bad of [
    { ...slot, count: 3 }, { ...slot, count: "2" }, { ...slot, count: 0 }, { ...slot, count: null }, { ...slot, count: 1.5 },
    { ...slot, shot: {} }, { ...slot, shot: { memberId: 1 } }, { ...slot, shot: null }, { ...slot, shot: "h" },
  ]) {
    assert.equal(isValidCartChoices({ slots: [bad], sweetness: null }), false, JSON.stringify(bad));
  }
});

test("basePrice is the menu price, without the specialty bean, in both pricing paths", () => {
  const priced = priceLines([beanItem("m_kenya", 75)], catalog({ stock: beanStock() }));
  assert.ok(!("error" in priced));
  assert.equal(priced.lines[0]!.unitPrice, 75);
  assert.equal(priced.lines[0]!.basePrice, 55);
  const charged = priceLinesAsCharged([beanItem("m_kenya", 60)], catalog({ stock: beanStock() }));
  assert.ok(!("error" in charged));
  assert.equal(charged.lines[0]!.basePrice, 55);
});
