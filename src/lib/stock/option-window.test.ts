import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLine,
  choiceParts,
  choicesFromWindow,
  footerText,
  hasOptionRows,
  initialWindowState,
  missingHint,
  missingRequired,
  modifierHint,
  optionRows,
  pickLevel,
  pickSlot,
  pickSweetener,
  priceTag,
  refreshChoices,
  shownSweetener,
  sweetenerHint,
  toggleOption,
  type WindowState,
} from "./option-window.ts";
import { defaultChoices } from "./pos-choices.ts";
import { buildStockCatalog, type StockCatalogRows } from "./catalog-build.ts";
import { cupPriceDeltaSatang, resolveLine, type StockCatalog } from "./stock-core.ts";
import { lineTotal, unitPrice } from "../cart-math.ts";
import type { CartChoices, CartItem, ModifierWithOptions } from "../../types/app.ts";

// Rows shaped like the POS page sends them (slot lines, slot_add effects, no amounts): the client
// builds its catalog from these with the server's own builder.
function rows(): StockCatalogRows {
  const mats = ["light", "med", "dark", "kenya", "ethiopia", "old_peru", "syrup", "condensed", "mix", "uji", "ceremony"];
  const member = (
    id: string, group_id: string, raw_material_id: string, label: string, sort_order: number,
    o: { tier?: "house" | "special"; price_delta?: number; is_default?: boolean } = {}
  ) => ({ id, group_id, raw_material_id, label, sort_order, tier: o.tier ?? "house", price_delta: o.price_delta ?? 0, is_default: o.is_default ?? false });
  const slot = (product_id: string, group_id: string, default_member_id: string | null, allow_special = true) =>
    ({ product_id, line_kind: "slot" as const, raw_material_id: null, group_id, quantity_used: 18, default_member_id, allow_special });
  const sweet = (product_id: string, default_member_id: string, allowed: string[], default_level_id: string | null = null) =>
    ({ product_id, group_id: "g_sweet", default_member_id, allowed_member_ids: allowed, default_level_id, use_custom: false });
  return {
    materials: [
      ...mats.map((id) => ({ id, archived_at: null })),
      { id: "gone", archived_at: "2026-11-01T00:00:00Z" },
    ],
    recipes: [
      slot("latte", "g_bean", "m_med"),
      slot("espresso_house", "g_bean", "m_dark", false),
      slot("matcha_latte", "g_matcha", null),
      slot("kenya_default", "g_bean", "m_kenya"),
    ],
    groups: [
      { id: "g_bean", kind: "bean", name: "เมล็ดกาแฟ", sort_order: 1 },
      { id: "g_matcha", kind: "matcha", name: "มัทฉะ", sort_order: 2 },
      { id: "g_sweet", kind: "sweetener", name: "สารให้ความหวาน", sort_order: 3 },
    ],
    members: [
      member("m_light", "g_bean", "light", "คั่วอ่อน", 1),
      member("m_med", "g_bean", "med", "คั่วกลาง", 2, { is_default: true }),
      member("m_dark", "g_bean", "dark", "คั่วเข้ม", 3),
      member("m_kenya", "g_bean", "kenya", "เคนยา", 4, { tier: "special", price_delta: 20 }),
      member("m_eth", "g_bean", "ethiopia", "เอธิโอเปีย", 5, { tier: "special", price_delta: 30 }),
      member("m_archived", "g_bean", "gone", "เก่า", 6, { tier: "special", price_delta: 60 }),
      member("t_uji", "g_matcha", "uji", "อุจิ", 1, { is_default: true }),
      member("t_cer", "g_matcha", "ceremony", "Ceremonial", 2, { tier: "special", price_delta: 40 }),
      member("s_syrup", "g_sweet", "syrup", "ไซรัป", 1, { is_default: true }),
      member("s_condensed", "g_sweet", "condensed", "นมข้น", 2),
      member("s_mix", "g_sweet", "mix", "นมมิกซ์", 3),
    ],
    levels: [
      { id: "lv_none", name: "ไม่หวาน", is_none: true, is_default: false, sort_order: 1 },
      { id: "lv_less", name: "หวานน้อย", is_none: false, is_default: false, sort_order: 2 },
      { id: "lv_normal", name: "หวานปกติ", is_none: false, is_default: true, sort_order: 3 },
      { id: "lv_more", name: "หวานมาก", is_none: false, is_default: false, sort_order: 4 },
    ],
    amounts: [],
    productSweetness: [
      sweet("latte", "s_syrup", ["s_condensed", "s_mix"]),
      sweet("thai_tea", "s_condensed", [], "lv_more"),
      sweet("unsweet", "s_syrup", ["s_mix"], "lv_none"),
    ],
    optionEffects: [
      { option_id: "o_shot", kind: "slot_add", group_id: "g_bean", raw_material_id: null, amount: 9 },
    ],
  };
}

const catalog: StockCatalog = buildStockCatalog(rows());
const PRODUCTS = ["latte", "espresso_house", "matcha_latte", "kenya_default", "thai_tea", "unsweet", "water"];

const extras: ModifierWithOptions = {
  id: "mod_extra", name: "เพิ่ม", isRequired: false, isMultiSelect: false, sortOrder: 1,
  options: [
    { id: "o_shot", name: "เพิ่มช็อต", priceDelta: 15, sortOrder: 1 },
    { id: "o_oat", name: "นมโอ๊ต", priceDelta: 10, sortOrder: 2 },
  ],
};
const temp: ModifierWithOptions = {
  id: "mod_temp", name: "ร้อน/เย็น", isRequired: true, isMultiSelect: false, sortOrder: 2,
  options: [
    { id: "o_hot", name: "ร้อน", priceDelta: 0, sortOrder: 1 },
    { id: "o_iced", name: "เย็น", priceDelta: 5, sortOrder: 2 },
  ],
};
const toppings: ModifierWithOptions = {
  id: "mod_top", name: "ท็อปปิ้ง", isRequired: false, isMultiSelect: true, sortOrder: 3,
  options: [
    { id: "o_pearl", name: "ไข่มุก", priceDelta: 10, sortOrder: 1 },
    { id: "o_jelly", name: "เยลลี่", priceDelta: 10, sortOrder: 2 },
  ],
};

const latte = { id: "latte", name: "ลาเต้", price: 65 };
const ids = (c: CartChoices) => ({
  slots: c.slots.map((s) => ({ groupId: s.groupId, memberId: s.memberId })),
  sweetness: c.sweetness ? { levelId: c.sweetness.levelId, memberId: c.sweetness.memberId } : null,
});

// ── which rows a menu shows ──────────────────────────────────────────────

test("latte: one bean choice with a house row and a special row, then ความหวาน and หวานด้วย", () => {
  const r = optionRows("latte", catalog);
  assert.equal(r.slots.length, 1);
  const bean = r.slots[0]!;
  assert.equal(bean.houseTitle, "เมล็ดร้าน (ระดับคั่ว)");
  assert.equal(bean.specialTitle, "เมล็ดพิเศษ");
  assert.deepEqual(bean.house.map((c) => c.label), ["คั่วอ่อน", "คั่วกลาง", "คั่วเข้ม"]);
  // an archived material's member is not offered
  assert.deepEqual(bean.special.map((c) => [c.label, c.priceDelta]), [["เคนยา", 20], ["เอธิโอเปีย", 30]]);
  assert.deepEqual(r.sweetness?.levels.map((l) => l.name), ["ไม่หวาน", "หวานน้อย", "หวานปกติ", "หวานมาก"]);
  assert.deepEqual(r.sweetness?.sweeteners.map((c) => c.label), ["ไซรัป", "นมข้น", "นมมิกซ์"]);
  assert.equal(hasOptionRows(r), true);
});

test("a menu that does not allow specials shows no special row", () => {
  const r = optionRows("espresso_house", catalog);
  assert.equal(r.slots[0]!.house.length, 3);
  assert.deepEqual(r.slots[0]!.special, []);
  assert.equal(r.sweetness, null);
});

test("matcha menus say มัทฉะร้าน / มัทฉะพิเศษ", () => {
  const s = optionRows("matcha_latte", catalog).slots[0]!;
  assert.equal(s.houseTitle, "มัทฉะร้าน");
  assert.equal(s.specialTitle, "มัทฉะพิเศษ");
});

test("no sweetener to change to → no หวานด้วย row (levels still shown)", () => {
  const r = optionRows("thai_tea", catalog);
  assert.equal(r.slots.length, 0);
  assert.equal(r.sweetness?.levels.length, 4);
  assert.deepEqual(r.sweetness?.sweeteners, []);
});

test("a menu without stock config has no rows; an empty catalog shows none either", () => {
  assert.equal(hasOptionRows(optionRows("water", catalog)), false);
  assert.equal(hasOptionRows(optionRows("latte", buildStockCatalog({ ...rows(), recipes: [], productSweetness: [] }))), false);
});

test("shop with no sweetness levels → no sweetness rows", () => {
  assert.equal(optionRows("latte", buildStockCatalog({ ...rows(), levels: [] })).sweetness, null);
});

// ── defaults pre-selected (plain latte = menu → เพิ่มลงตะกร้า) ─────────────

test("plain latte: every row starts on its default, and adding it as-is is the menu default", () => {
  const s = initialWindowState("latte", catalog, [extras]);
  assert.deepEqual(s, { slots: { g_bean: "m_med" }, levelId: "lv_normal", sweetenerId: "s_syrup", options: {} });
  assert.deepEqual(choicesFromWindow("latte", catalog, s, []), defaultChoices("latte", catalog));
});

test("INVARIANT: the untouched window equals defaultChoices for every menu", () => {
  for (const p of PRODUCTS) {
    assert.deepEqual(choicesFromWindow(p, catalog, initialWindowState(p, catalog, []), []), defaultChoices(p, catalog), p);
  }
});

test("a menu's own special default is pre-selected with its price", () => {
  const c = choicesFromWindow("kenya_default", catalog, initialWindowState("kenya_default", catalog, []), []);
  assert.deepEqual(c.slots, [{ groupId: "g_bean", memberId: "m_kenya", label: "เคนยา", tier: "special", priceDelta: 20 }]);
});

// ── picks ────────────────────────────────────────────────────────────────

test("one bean choice across both rows: special replaces the roast and back", () => {
  let s = initialWindowState("latte", catalog, []);
  s = pickSlot(s, "g_bean", "m_kenya");
  assert.deepEqual(s.slots, { g_bean: "m_kenya" });
  assert.deepEqual(choicesFromWindow("latte", catalog, s, []).slots,
    [{ groupId: "g_bean", memberId: "m_kenya", label: "เคนยา", tier: "special", priceDelta: 20 }]);
  s = pickSlot(s, "g_bean", "m_dark");
  assert.deepEqual(choicesFromWindow("latte", catalog, s, []).slots,
    [{ groupId: "g_bean", memberId: "m_dark", label: "คั่วเข้ม", tier: "house", priceDelta: 0 }]);
});

test("หวานน้อย + นมมิกซ์", () => {
  let s = initialWindowState("latte", catalog, []);
  s = pickLevel(s, "lv_less");
  s = pickSweetener(s, optionRows("latte", catalog), "s_mix");
  assert.deepEqual(choicesFromWindow("latte", catalog, s, []).sweetness,
    { levelId: "lv_less", levelName: "หวานน้อย", memberId: "s_mix", memberLabel: "นมมิกซ์" });
});

test("ไม่หวาน clears the sweetener and locks หวานด้วย; going back brings the earlier pick", () => {
  const r = optionRows("latte", catalog);
  let s = pickSweetener(initialWindowState("latte", catalog, []), r, "s_mix");
  s = pickLevel(s, "lv_none");
  assert.deepEqual(choicesFromWindow("latte", catalog, s, []).sweetness,
    { levelId: "lv_none", levelName: "ไม่หวาน", memberId: null, memberLabel: null });
  assert.equal(shownSweetener(s, r), null);
  assert.equal(sweetenerHint(s, r), "ไม่หวาน · ไม่ต้องเลือก");
  // disabled, not hidden: a tap does nothing
  assert.deepEqual(pickSweetener(s, r, "s_condensed"), s);
  assert.equal(r.sweetness?.sweeteners.length, 3);
  s = pickLevel(s, "lv_more");
  assert.equal(shownSweetener(s, r), "s_mix");
  assert.equal(sweetenerHint(s, r), null);
  assert.deepEqual(choicesFromWindow("latte", catalog, s, []).sweetness,
    { levelId: "lv_more", levelName: "หวานมาก", memberId: "s_mix", memberLabel: "นมมิกซ์" });
});

test("a menu whose default is ไม่หวาน starts locked; picking a level gives the menu's sweetener", () => {
  const r = optionRows("unsweet", catalog);
  let s = initialWindowState("unsweet", catalog, []);
  assert.equal(shownSweetener(s, r), null);
  s = pickLevel(s, "lv_less");
  assert.equal(shownSweetener(s, r), "s_syrup");
});

test("a pick the menu does not offer falls back to the default (never refused)", () => {
  // special on a house-only menu, unknown member, sweetener not allowed, unknown level
  const s: WindowState = { slots: { g_bean: "m_kenya" }, levelId: "lv_gone", sweetenerId: "s_mix", options: {} };
  const c = choicesFromWindow("espresso_house", catalog, s, []);
  assert.equal(c.slots[0]!.memberId, "m_dark");
  const t = choicesFromWindow("thai_tea", catalog, { ...s, levelId: "lv_less" }, []);
  assert.deepEqual(t.sweetness, { levelId: "lv_less", levelName: "หวานน้อย", memberId: "s_condensed", memberLabel: "นมข้น" });
  assert.equal(choicesFromWindow("latte", catalog, { ...s, slots: { g_bean: "nope" } }, []).slots[0]!.memberId, "m_med");
  assert.equal(choicesFromWindow("latte", catalog, s, []).sweetness?.levelId, "lv_normal");
});

test("เพิ่มช็อต on a special bean charges the special again; on a house bean it is free", () => {
  let s = pickSlot(initialWindowState("latte", catalog, []), "g_bean", "m_kenya");
  const kenya = choicesFromWindow("latte", catalog, s, ["o_shot"]);
  assert.deepEqual(kenya.slotAddGroupIds, ["g_bean"]);
  assert.equal(unitPrice(65, [{ priceDelta: 15 }], kenya), 65 + 15 + 40);
  s = pickSlot(s, "g_bean", "m_med");
  const house = choicesFromWindow("latte", catalog, s, ["o_shot", "o_oat"]);
  assert.deepEqual(house.slotAddGroupIds, ["g_bean"]);
  assert.equal(unitPrice(65, [{ priceDelta: 15 }, { priceDelta: 10 }], house), 90);
  // no slot for the effect's group → nothing added
  assert.deepEqual(choicesFromWindow("thai_tea", catalog, initialWindowState("thai_tea", catalog, []), ["o_shot"]).slotAddGroupIds, []);
});

test("INVARIANT: the cart's specialty price equals the server's for every pick", () => {
  const picks: [string, string, string[]][] = [
    ["latte", "m_kenya", []], ["latte", "m_eth", ["o_shot"]], ["latte", "m_light", ["o_shot"]],
    ["kenya_default", "m_kenya", ["o_shot"]], ["espresso_house", "m_kenya", ["o_shot"]],
  ];
  for (const [p, member, options] of picks) {
    const c = choicesFromWindow(p, catalog, pickSlot(initialWindowState(p, catalog, []), "g_bean", member), options);
    const server = resolveLine(p, 1, ids(c), options, catalog);
    assert.ok(!("error" in server), p);
    assert.equal(cupPriceDeltaSatang(c.slots, c.slotAddGroupIds), server.priceDeltaSatang, `${p} ${member}`);
    assert.deepEqual(c.slots.map((x) => x.memberId), server.snapshot.slots.map((x) => x.memberId));
  }
});

// ── other options (modifiers) ────────────────────────────────────────────

test("single choice: tap again to take it back; required single stays; multi toggles", () => {
  let s = initialWindowState("latte", catalog, [extras, temp, toppings]);
  s = toggleOption(s, extras, "o_shot");
  assert.deepEqual(s.options.mod_extra, ["o_shot"]);
  s = toggleOption(s, extras, "o_oat");
  assert.deepEqual(s.options.mod_extra, ["o_oat"]);
  s = toggleOption(s, extras, "o_oat");
  assert.deepEqual(s.options.mod_extra, []);
  s = toggleOption(toggleOption(s, temp, "o_iced"), temp, "o_iced");
  assert.deepEqual(s.options.mod_temp, ["o_iced"]);
  s = toggleOption(toggleOption(s, toppings, "o_pearl"), toppings, "o_jelly");
  assert.deepEqual(s.options.mod_top, ["o_pearl", "o_jelly"]);
  s = toggleOption(s, toppings, "o_pearl");
  assert.deepEqual(s.options.mod_top, ["o_jelly"]);
});

test("missing required options are named", () => {
  const s = initialWindowState("latte", catalog, [extras, temp]);
  assert.deepEqual(missingRequired(s, [extras, temp]).map((m) => m.id), ["mod_temp"]);
  assert.equal(missingHint(missingRequired(s, [extras, temp])), "เลือก ร้อน/เย็น ก่อน");
  assert.equal(missingHint([]), null);
  assert.deepEqual(missingRequired(toggleOption(s, temp, "o_hot"), [extras, temp]), []);
});

test("modifier row hints", () => {
  assert.equal(modifierHint(extras), null);
  assert.equal(modifierHint(temp), "จำเป็น");
  assert.equal(modifierHint(toppings), "เลือกได้หลายอย่าง");
  assert.equal(modifierHint({ ...toppings, isRequired: true }), "จำเป็น · เลือกได้หลายอย่าง");
});

// ── the cart line it becomes ─────────────────────────────────────────────

test("buildLine: price from cart-math, choices attached, options in menu order, note trimmed", () => {
  let s = pickSlot(initialWindowState("latte", catalog, [extras, toppings]), "g_bean", "m_kenya");
  s = toggleOption(toggleOption(s, toppings, "o_jelly"), toppings, "o_pearl");
  s = toggleOption(s, extras, "o_shot");
  const line = buildLine({ product: latte, modifiers: [extras, toppings], catalog, state: s, note: "  แยกน้ำแข็ง ", quantity: 1, key: "k1" });
  assert.deepEqual(line.selectedModifiers.map((m) => m.optionId), ["o_shot", "o_pearl", "o_jelly"]);
  assert.equal(line.note, "แยกน้ำแข็ง");
  assert.equal(line.cartItemKey, "k1");
  assert.equal(line.basePrice, 65);
  assert.deepEqual(line.choices, choicesFromWindow("latte", catalog, s, ["o_shot", "o_pearl", "o_jelly"]));
  assert.equal(line.totalPrice, lineTotal(65, line.selectedModifiers, 1, line.choices));
  assert.equal(line.totalPrice, 65 + 15 + 10 + 10 + 20 * 2);
  assert.equal(footerText("add", line), "เพิ่มลงตะกร้า · ฿140");
});

test("a menu with no stock rows gets no choices key at all (same shape as before D1)", () => {
  const line = buildLine({
    product: { id: "water", name: "น้ำ", price: 15 }, modifiers: [], catalog,
    state: initialWindowState("water", catalog, []), note: "", quantity: 1, key: "w",
  });
  assert.equal("choices" in line, false);
  assert.equal(line.note, null);
  assert.equal(line.totalPrice, 15);
});

test("footer text: add shows the cup price, edit shows the line's total", () => {
  const plain = buildLine({ product: latte, modifiers: [], catalog, state: initialWindowState("latte", catalog, []), note: "", quantity: 1, key: "a" });
  assert.equal(footerText("add", plain), "เพิ่มลงตะกร้า · ฿65");
  const kenyaTwo = buildLine({
    product: latte, modifiers: [], catalog, state: pickSlot(initialWindowState("latte", catalog, []), "g_bean", "m_kenya"),
    note: "", quantity: 2, key: "b",
  });
  assert.equal(footerText("edit", kenyaTwo), "บันทึก · ฿170");
  const satang = buildLine({ product: { ...latte, price: 45.5 }, modifiers: [], catalog, state: initialWindowState("latte", catalog, []), note: "", quantity: 1, key: "c" });
  assert.equal(footerText("add", satang), "เพิ่มลงตะกร้า · ฿45.50");
});

test("priceTag", () => {
  assert.equal(priceTag(20), "+20");
  assert.equal(priceTag(12.5), "+12.50");
  assert.equal(priceTag(0), null);
  assert.equal(priceTag(-5), "−5");
});

// ── editing a cart line: the window opens pre-filled ─────────────────────

const kenyaLine: CartItem = {
  cartItemKey: "line1", productId: "latte", name: "ลาเต้", basePrice: 65, quantity: 2,
  selectedModifiers: [{ modifierId: "mod_extra", modifierName: "เพิ่ม", optionId: "o_shot", optionName: "เพิ่มช็อต", priceDelta: 15 }],
  totalPrice: (65 + 15 + 40) * 2, note: "แยกน้ำแข็ง",
  choices: {
    slots: [{ groupId: "g_bean", memberId: "m_kenya", label: "เคนยา", tier: "special", priceDelta: 20 }],
    slotAddGroupIds: ["g_bean"],
    sweetness: { levelId: "lv_less", levelName: "หวานน้อย", memberId: "s_mix", memberLabel: "นมมิกซ์" },
  },
};

test("edit: the window starts on the line's own picks and rebuilds the same line", () => {
  const s = initialWindowState("latte", catalog, [extras, temp], kenyaLine);
  assert.deepEqual(s, { slots: { g_bean: "m_kenya" }, levelId: "lv_less", sweetenerId: "s_mix", options: { mod_extra: ["o_shot"] } });
  const again = buildLine({ product: latte, modifiers: [extras, temp], catalog, state: s, note: kenyaLine.note!, quantity: 2, key: "line1" });
  assert.deepEqual(again, kenyaLine);
});

test("edit: a pre-D1 line (no choices) opens on the menu defaults; a ไม่หวาน line remembers the menu's sweetener", () => {
  const legacy: CartItem = { ...kenyaLine, choices: undefined, selectedModifiers: [] };
  delete legacy.choices;
  assert.deepEqual(initialWindowState("latte", catalog, [], legacy), initialWindowState("latte", catalog, []));
  const none: CartItem = { ...kenyaLine, choices: { ...kenyaLine.choices!, sweetness: { levelId: "lv_none", levelName: "ไม่หวาน", memberId: null, memberLabel: null } } };
  const s = initialWindowState("latte", catalog, [], none);
  assert.equal(s.levelId, "lv_none");
  assert.equal(s.sweetenerId, "s_syrup");
});

// ── a parked line brought back: choices refreshed from today's catalog ────

test("refresh: labels, tier and price come from the catalog, never the parked copy", () => {
  const parked: CartChoices = {
    slots: [{ groupId: "g_bean", memberId: "m_kenya", label: "Kenya (old)", tier: "house", priceDelta: 15 }],
    slotAddGroupIds: [],
    sweetness: { levelId: "lv_less", levelName: "น้อย", memberId: "s_mix", memberLabel: "mix" },
  };
  assert.deepEqual(refreshChoices("latte", catalog, parked, ["o_shot"]), {
    slots: [{ groupId: "g_bean", memberId: "m_kenya", label: "เคนยา", tier: "special", priceDelta: 20 }],
    slotAddGroupIds: ["g_bean"],
    sweetness: { levelId: "lv_less", levelName: "หวานน้อย", memberId: "s_mix", memberLabel: "นมมิกซ์" },
  });
});

test("refresh: a member, level or sweetener no longer offered falls back to the menu default", () => {
  const parked: CartChoices = {
    slots: [
      { groupId: "g_bean", memberId: "m_archived", label: "เก่า", tier: "special", priceDelta: 60 },
      { groupId: "g_removed", memberId: "x", label: "x", tier: "house", priceDelta: 0 },
    ],
    slotAddGroupIds: ["g_bean"],
    sweetness: { levelId: "lv_deleted", levelName: "หวานพิเศษ", memberId: "s_condensed", memberLabel: "นมข้น" },
  };
  const r = refreshChoices("latte", catalog, parked, []);
  assert.deepEqual(r.slots, [{ groupId: "g_bean", memberId: "m_med", label: "คั่วกลาง", tier: "house", priceDelta: 0 }]);
  assert.deepEqual(r.slotAddGroupIds, []);
  assert.deepEqual(r.sweetness, { levelId: "lv_normal", levelName: "หวานปกติ", memberId: "s_condensed", memberLabel: "นมข้น" });
  // a special kept on a menu that no longer allows specials
  assert.equal(refreshChoices("espresso_house", catalog, parked, []).slots[0]!.memberId, "m_dark");
  // sweetener no longer allowed on the menu
  const thai = refreshChoices("thai_tea", catalog, { ...parked, sweetness: { ...parked.sweetness!, levelId: "lv_less", memberId: "s_mix" } }, []);
  assert.equal(thai.sweetness?.memberId, "s_condensed");
  // a ไม่หวาน level that was deleted → the default level with the menu's sweetener
  const none = refreshChoices("latte", catalog, { ...parked, sweetness: { levelId: "lv_x", levelName: "ไม่หวาน", memberId: null, memberLabel: null } }, []);
  assert.deepEqual(none.sweetness, { levelId: "lv_normal", levelName: "หวานปกติ", memberId: "s_syrup", memberLabel: "ไซรัป" });
});

test("refresh: config removed from the menu → nothing to choose", () => {
  assert.deepEqual(refreshChoices("water", catalog, kenyaLine.choices!, ["o_shot"]), { slots: [], slotAddGroupIds: [], sweetness: null });
});

// ── the cart line text ───────────────────────────────────────────────────

test("cart text: every choice shown, non-defaults marked", () => {
  const d = defaultChoices("latte", catalog);
  assert.deepEqual(choiceParts(d, d), [
    { text: "คั่วกลาง", changed: false }, { text: "หวานปกติ", changed: false }, { text: "ไซรัป", changed: false },
  ]);
  const lessMix = choicesFromWindow("latte", catalog,
    pickSweetener(pickLevel(initialWindowState("latte", catalog, []), "lv_less"), optionRows("latte", catalog), "s_mix"), []);
  assert.deepEqual(choiceParts(lessMix, d), [
    { text: "คั่วกลาง", changed: false }, { text: "หวานน้อย", changed: true }, { text: "นมมิกซ์", changed: true },
  ]);
  assert.deepEqual(choiceParts(kenyaLine.choices, d).map((p) => [p.text, p.changed]),
    [["เคนยา", true], ["หวานน้อย", true], ["นมมิกซ์", true]]);
  const none = choicesFromWindow("latte", catalog, pickLevel(initialWindowState("latte", catalog, []), "lv_none"), []);
  assert.deepEqual(choiceParts(none, d), [{ text: "คั่วกลาง", changed: false }, { text: "ไม่หวาน", changed: true }]);
});

test("cart text: a ไม่หวาน-default menu marks the added sweetener; a pre-D1 line shows nothing extra", () => {
  const d = defaultChoices("unsweet", catalog);
  assert.deepEqual(choiceParts(d, d), [{ text: "ไม่หวาน", changed: false }]);
  const sweet = choicesFromWindow("unsweet", catalog, pickLevel(initialWindowState("unsweet", catalog, []), "lv_less"), []);
  assert.deepEqual(choiceParts(sweet, d), [{ text: "หวานน้อย", changed: true }, { text: "ไซรัป", changed: true }]);
  assert.deepEqual(choiceParts(undefined, d), []);
});
