import { test } from "node:test";
import assert from "node:assert/strict";
import { priceLines, STALE, type PricingCatalog } from "./order-pricing-core.ts";
import type { CartItem } from "../types/app.ts";

const BAD = "ข้อมูลสินค้าในตะกร้าไม่ถูกต้อง";

function catalog(overrides: { archived?: boolean } = {}): PricingCatalog {
  return {
    products: new Map([
      [
        "latte",
        {
          id: "latte",
          name: "ลาเต้",
          price: 55,
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
