import { test } from "node:test";
import assert from "node:assert/strict";
import { addLine, replaceLine, repriceItems, restoreLine, withQuantity } from "./cart-lines.ts";
import { buildStockCatalog, type StockCatalogRows } from "./stock/catalog-build.ts";
import type { CartChoices, CartItem, ModifierWithOptions, SelectedModifier } from "../types/app.ts";

const shot: SelectedModifier = { modifierId: "mod_extra", modifierName: "เพิ่ม", optionId: "o_shot", optionName: "เพิ่มช็อต", priceDelta: 15 };
const oat: SelectedModifier = { modifierId: "mod_milk", modifierName: "นม", optionId: "o_oat", optionName: "นมโอ๊ต", priceDelta: 10 };

const choices = (member: string, tier: "house" | "special", priceDelta: number, level = "lv_normal", sweetener: string | null = "s_syrup"): CartChoices => ({
  slots: [{ groupId: "g_bean", memberId: member, label: member, tier, priceDelta }],
  slotAddGroupIds: [],
  sweetness: { levelId: level, levelName: level, memberId: sweetener, memberLabel: sweetener },
});

function line(key: string, o: Partial<CartItem> = {}): CartItem {
  return {
    cartItemKey: key, productId: "latte", name: "ลาเต้", basePrice: 65, quantity: 1,
    selectedModifiers: [], totalPrice: 65, note: null, choices: choices("m_med", "house", 0), ...o,
  };
}

// ── merge identity ───────────────────────────────────────────────────────

test("an identical cup adds to the existing line (quantity and total)", () => {
  const cart = addLine([line("a", { choices: choices("m_kenya", "special", 20), totalPrice: 85 })], line("b", { choices: choices("m_kenya", "special", 20), totalPrice: 85 }));
  assert.equal(cart.length, 1);
  assert.equal(cart[0]!.cartItemKey, "a");
  assert.equal(cart[0]!.quantity, 2);
  assert.equal(cart[0]!.totalPrice, 170);
});

test("same option ids in another order, same note, same choice ids (other labels) → one line", () => {
  const a = line("a", { selectedModifiers: [shot, oat], note: "แยกน้ำแข็ง", totalPrice: 90 });
  const b = line("b", {
    selectedModifiers: [oat, shot], note: "แยกน้ำแข็ง", totalPrice: 90,
    choices: { ...choices("m_med", "house", 0), slots: [{ groupId: "g_bean", memberId: "m_med", label: "renamed", tier: "house", priceDelta: 0 }] },
  });
  assert.equal(addLine([a], b).length, 1);
});

test("any difference keeps a separate line: bean, sweetness, sweetener, option, note, pre-D1 line", () => {
  const base = line("a");
  const others: CartItem[] = [
    line("b", { choices: choices("m_dark", "house", 0) }),
    line("c", { choices: choices("m_med", "house", 0, "lv_less") }),
    line("d", { choices: choices("m_med", "house", 0, "lv_normal", "s_mix") }),
    line("e", { selectedModifiers: [shot], totalPrice: 80 }),
    line("f", { note: "ไม่ใส่หลอด" }),
    line("g", { choices: undefined }),
    line("h", { productId: "mocha" }),
  ];
  for (const o of others) assert.equal(addLine([base], o).length, 2, o.cartItemKey);
});

test("two pre-D1-style plain lines (no choices) still merge, a noted one does not", () => {
  const plain = (key: string, note: string | null = null): CartItem =>
    ({ cartItemKey: key, productId: "water", name: "น้ำ", basePrice: 15, quantity: 1, selectedModifiers: [], totalPrice: 15, note });
  assert.deepEqual(addLine([plain("water")], plain("x")).map((l) => [l.cartItemKey, l.quantity, l.totalPrice]), [["water", 2, 30]]);
  assert.equal(addLine([plain("water", "แยกน้ำแข็ง")], plain("x")).length, 2);
});

test("Kenya ×1 and Kenya ×2 are different cups; so are two different shot beans; the same ×2 merges", () => {
  const k1 = choices("m_kenya", "special", 20);
  const k2: CartChoices = { ...k1, slots: [{ ...k1.slots[0]!, count: 2 }] };
  assert.equal(addLine([line("a", { choices: k1, totalPrice: 85 })], line("b", { choices: k2, totalPrice: 105 })).length, 2);
  const merged = addLine([line("a", { choices: k2, totalPrice: 105 })], line("b", { choices: k2, totalPrice: 105 }));
  assert.deepEqual(merged.map((l) => [l.quantity, l.totalPrice]), [[2, 210]]);
  const shotOn = (memberId: string): CartChoices => ({ ...k1, slots: [{ ...k1.slots[0]!, shot: { memberId, label: memberId, optionIds: ["o_shot"] } }] });
  assert.equal(
    addLine([line("a", { choices: shotOn("m_med"), selectedModifiers: [shot] })], line("b", { choices: shotOn("m_dark"), selectedModifiers: [shot] })).length,
    2
  );
});

test("withQuantity re-prices the specialty per cup (an extra shot adds only its own price; ×2 doubles the specialty)", () => {
  const k = line("a", { choices: { ...choices("m_kenya", "special", 20), slotAddGroupIds: ["g_bean"] }, selectedModifiers: [shot] });
  assert.equal(withQuantity(k, 3).totalPrice, (65 + 15 + 20) * 3);
  const k2 = line("b", { choices: { ...choices("m_kenya", "special", 20), slots: [{ ...choices("m_kenya", "special", 20).slots[0]!, count: 2 }] } });
  assert.equal(withQuantity(k2, 2).totalPrice, (65 + 40) * 2);
});

// ── editing a line replaces it ───────────────────────────────────────────

test("save replaces the edited line in place, keeping its key and quantity", () => {
  const cart = [line("a", { quantity: 3, totalPrice: 195 }), line("b", { productId: "mocha" })];
  const edited = line("new-key", { choices: choices("m_kenya", "special", 20), note: "แยกน้ำแข็ง", quantity: 1, totalPrice: 85 });
  const out = replaceLine(cart, "a", edited);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.cartItemKey, "a");
  assert.equal(out[0]!.quantity, 3);
  assert.equal(out[0]!.totalPrice, 255);
  assert.equal(out[0]!.note, "แยกน้ำแข็ง");
  assert.equal(out[0]!.choices?.slots[0]!.memberId, "m_kenya");
  assert.equal(out[1], cart[1]);
});

test("replace does not merge into an identical neighbour, and a vanished line is not brought back", () => {
  const cart = [line("a", { choices: choices("m_dark", "house", 0) }), line("b")];
  assert.equal(replaceLine(cart, "a", line("x")).length, 2);
  assert.equal(replaceLine([], "a", line("x")).length, 0);
  assert.deepEqual(replaceLine(cart, "zzz", line("x")), cart);
});

// ── a parked bill / restored draft brought back ──────────────────────────

const stockRows: StockCatalogRows = {
  materials: [{ id: "med", archived_at: null }, { id: "kenya", archived_at: null }, { id: "syrup", archived_at: null }],
  recipes: [{ product_id: "latte", line_kind: "slot", raw_material_id: null, group_id: "g_bean", quantity_used: 18, default_member_id: "m_med", allow_special: true }],
  groups: [{ id: "g_bean", kind: "bean", name: "เมล็ดกาแฟ", sort_order: 1 }, { id: "g_sweet", kind: "sweetener", name: "หวาน", sort_order: 2 }],
  members: [
    { id: "m_med", group_id: "g_bean", raw_material_id: "med", label: "คั่วกลาง", tier: "house", price_delta: 0, is_default: true, sort_order: 1 },
    { id: "m_kenya", group_id: "g_bean", raw_material_id: "kenya", label: "เคนยา", tier: "special", price_delta: 25, is_default: false, sort_order: 2 },
    { id: "s_syrup", group_id: "g_sweet", raw_material_id: "syrup", label: "ไซรัป", tier: "house", price_delta: 0, is_default: true, sort_order: 1 },
  ],
  levels: [{ id: "lv_normal", name: "หวานปกติ", is_none: false, is_default: true, sort_order: 1 }],
  amounts: [],
  productSweetness: [{ product_id: "latte", group_id: "g_sweet", default_member_id: "s_syrup", allowed_member_ids: [], default_level_id: null, use_custom: false }],
  optionEffects: [{ option_id: "o_shot", kind: "slot_add", group_id: "g_bean", raw_material_id: null, amount: 9 }],
};
const stock = buildStockCatalog(stockRows);
const products = [{ id: "latte", price: 70 }, { id: "water", price: 15 }];
const modifiers: ModifierWithOptions[] = [{
  id: "mod_extra", name: "เพิ่ม", isRequired: false, isMultiSelect: false, sortOrder: 1,
  options: [{ id: "o_shot", name: "เพิ่มช็อต", priceDelta: 20, sortOrder: 1 }],
}];

test("reprice: menu price, option price and the specialty price all come from today's menu", () => {
  const parked = line("a", {
    quantity: 2, selectedModifiers: [shot], totalPrice: (65 + 15 + 20) * 2,
    choices: { ...choices("m_kenya", "special", 20), slotAddGroupIds: ["g_bean"], sweetness: { levelId: "lv_normal", levelName: "x", memberId: "s_syrup", memberLabel: "x" } },
  });
  const [out] = repriceItems([parked], products, modifiers, stock);
  assert.equal(out!.basePrice, 70);
  assert.equal(out!.selectedModifiers[0]!.priceDelta, 20);
  assert.deepEqual(out!.choices, {
    slots: [{
      groupId: "g_bean", memberId: "m_kenya", label: "เคนยา", tier: "special", priceDelta: 25,
      shot: { memberId: "m_med", label: "คั่วกลาง", optionIds: ["o_shot"] },
    }],
    slotAddGroupIds: ["g_bean"],
    sweetness: { levelId: "lv_normal", levelName: "หวานปกติ", memberId: "s_syrup", memberLabel: "ไซรัป" },
  });
  assert.equal(out!.totalPrice, (70 + 20 + 25) * 2);
  // a parked ×2 stays ×2 and is re-priced at today's specialty price
  const doubled = line("b", { choices: { ...choices("m_kenya", "special", 20), slots: [{ ...choices("m_kenya", "special", 20).slots[0]!, count: 2 }] } });
  const [d] = repriceItems([doubled], products, modifiers, stock);
  assert.equal(d!.choices!.slots[0]!.count, 2);
  assert.equal(d!.totalPrice, 70 + 50);
  assert.equal(out!.cartItemKey, "a");
  assert.equal(out!.quantity, 2);
});

test("reprice: a removed member falls back to the default — no stale specialty price is kept", () => {
  const gone = line("a", { choices: choices("m_retired", "special", 60), totalPrice: 125 });
  const [out] = repriceItems([gone], products, modifiers, stock);
  assert.equal(out!.choices?.slots[0]!.memberId, "m_med");
  assert.equal(out!.totalPrice, 70);
});

test("reprice: a pre-D1 line stays without choices; a menu no longer on sale is left alone", () => {
  const legacy: CartItem = { cartItemKey: "w", productId: "water", name: "น้ำ", basePrice: 10, quantity: 1, selectedModifiers: [], totalPrice: 10, note: null };
  const [w] = repriceItems([legacy], products, modifiers, stock);
  assert.equal("choices" in w!, false);
  assert.equal(w!.totalPrice, 15);
  const off = line("x", { productId: "retired" });
  assert.equal(repriceItems([off], products, modifiers, stock)[0], off);
});

test("reprice: stock data not loaded on this page → the line's choices are kept as they are", () => {
  const k = line("a", { choices: choices("m_kenya", "special", 20), totalPrice: 85 });
  const [out] = repriceItems([k], products, modifiers, null);
  assert.deepEqual(out!.choices, k.choices);
  assert.equal(out!.totalPrice, 90);
});

test("reprice: a resumed line without choices, on a menu that has option rows now, gets the menu defaults (as the server applies)", () => {
  const legacy: CartItem = { cartItemKey: "l", productId: "latte", name: "ลาเต้", basePrice: 65, quantity: 2, selectedModifiers: [], totalPrice: 130, note: null };
  const [out] = repriceItems([legacy], products, modifiers, stock);
  assert.deepEqual(out!.choices, {
    slots: [{ groupId: "g_bean", memberId: "m_med", label: "คั่วกลาง", tier: "house", priceDelta: 0 }],
    slotAddGroupIds: [],
    sweetness: { levelId: "lv_normal", levelName: "หวานปกติ", memberId: "s_syrup", memberLabel: "ไซรัป" },
  });
  assert.equal(out!.totalPrice, 140);
  // stock data not loaded: untouched, still no choices
  assert.equal("choices" in repriceItems([legacy], products, modifiers, null)[0]!, false);
});

// ── undo a removed line ──────────────────────────────────────────────────

test("restoreLine puts the line back where it was", () => {
  const a = line("a"), b = line("b"), c = line("c");
  assert.deepEqual(restoreLine([a, c], b, 1).map((l) => l.cartItemKey), ["a", "b", "c"]);
});

test("restoreLine clamps an index past the end", () => {
  const a = line("a"), b = line("b");
  assert.deepEqual(restoreLine([a], b, 5).map((l) => l.cartItemKey), ["a", "b"]);
});

test("restoreLine clamps a negative index", () => {
  const a = line("a"), b = line("b");
  assert.deepEqual(restoreLine([a], b, -3).map((l) => l.cartItemKey), ["b", "a"]);
});

test("restoreLine ignores a line already in the cart", () => {
  const cart = [line("a"), line("b")];
  assert.equal(restoreLine(cart, line("b", { quantity: 9 }), 0), cart);
});

test("restoreLine keeps the line exactly", () => {
  const ch = choices("m_kenya", "special", 20);
  ch.slots[0]!.count = 2;
  const item = line("x", { quantity: 2, choices: ch, note: "ไม่ใส่น้ำแข็ง", totalPrice: 170 });
  const out = restoreLine([line("a")], item, 1);
  assert.deepEqual(out[1], item);
  assert.deepEqual(out[1]!.choices, ch);
});
