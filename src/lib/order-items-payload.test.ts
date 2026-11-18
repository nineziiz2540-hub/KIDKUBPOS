import { test } from "node:test";
import assert from "node:assert/strict";
import { orderItemsPayload } from "./order-items-payload.ts";
import { priceLines, type PricingCatalog } from "./order-pricing-core.ts";
import { buildStockCatalog } from "./stock/catalog-build.ts";
import { emptyStockCatalog } from "./stock/stock-core.ts";
import type { CartItem } from "../types/app.ts";

function pricing(stock = emptyStockCatalog()): PricingCatalog {
  return {
    products: new Map([["latte", { id: "latte", name: "ลาเต้", price: 55, is_active: true, archived_at: null, categories: { name: "กาแฟ" } }]]),
    linkedModifiers: new Map(),
    modifiers: new Map(),
    options: new Map(),
    stock,
  };
}

const cartItem = (extra: Partial<CartItem> = {}): CartItem =>
  ({
    cartItemKey: "k", productId: "latte", name: "ลาเต้", basePrice: 55, quantity: 2,
    selectedModifiers: [], note: "ไม่ใส่น้ำแข็ง", totalPrice: 110, ...extra,
  }) as CartItem;

function priced(catalog: PricingCatalog, item: CartItem) {
  const r = priceLines([item], catalog);
  assert.ok(!("error" in r), "expected priced lines");
  return r.lines;
}

test("a plain line keeps every existing field and sends empty stock", () => {
  const p = orderItemsPayload(priced(pricing(), cartItem()))[0]!;
  assert.deepEqual(
    { ...p, stock: undefined, choices: undefined },
    {
      product_id: "latte", product_name: "ลาเต้", unit_price: 55, quantity: 2, subtotal: 110,
      category_name: "กาแฟ", modifiers_snapshot: null, note: "ไม่ใส่น้ำแข็ง", stock: undefined, choices: undefined,
    }
  );
  assert.deepEqual(p.stock, []);
  assert.deepEqual(p.choices, { slots: [], slotAddGroupIds: [], sweetness: null });
});

test("a Kenya latte line sends whole-line stock and the choices snapshot", () => {
  const stock = buildStockCatalog({
    materials: [{ id: "med", archived_at: null }, { id: "kenya", archived_at: null }],
    recipes: [{ product_id: "latte", line_kind: "slot", raw_material_id: null, group_id: "beans", quantity_used: 18, default_member_id: "m_med", allow_special: true }],
    groups: [{ id: "beans", kind: "bean", name: "เมล็ด", sort_order: 0 }],
    members: [
      { id: "m_med", group_id: "beans", raw_material_id: "med", label: "med", tier: "house", price_delta: 0, is_default: true, sort_order: 0 },
      { id: "m_kenya", group_id: "beans", raw_material_id: "kenya", label: "kenya", tier: "special", price_delta: 20, is_default: false, sort_order: 1 },
    ],
    levels: [], amounts: [], productSweetness: [], optionEffects: [],
  });
  const item = cartItem({
    quantity: 1, totalPrice: 75,
    choices: { slots: [{ groupId: "beans", memberId: "m_kenya" }] },
  } as Partial<CartItem>);
  const p = orderItemsPayload(priced(pricing(stock), item))[0]!;
  assert.deepEqual(p.stock, [{ material_id: "kenya", qty: 18 }]);
  assert.equal(p.unit_price, 75);
  assert.equal(p.choices.slots[0]!.memberId, "m_kenya");
  assert.equal(p.choices.slots[0]!.materialId, "kenya");
});
