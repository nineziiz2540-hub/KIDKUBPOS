import { test } from "node:test";
import assert from "node:assert/strict";
import { priceLines, priceLinesAsCharged, STALE, type PricingCatalog } from "./order-pricing-core.ts";
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
  assert.deepEqual(r.lines[0]!.modifiersSnapshot, [{ group: "ขนาด", option: "ใหญ่", priceDelta: 0 }]);
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
  assert.deepEqual(plain.lines[0]!.choicesSnapshot, { slots: [], sweetness: null });
});

test("as charged keeps the device total but still resolves stock", () => {
  const r = priceLinesAsCharged([beanItem("m_kenya", 60)], catalog({ stock: beanStock() }));
  assert.ok(!("error" in r));
  assert.equal(r.subtotal, 60);
  assert.equal(r.serverSubtotal, 75);
  assert.deepEqual(r.lines[0]!.stock, [{ materialId: "mat_m_kenya", qty: 18 }]);
  assert.equal(r.lines[0]!.choicesSnapshot.slots[0]!.memberId, "m_kenya");
});
