import { test } from "node:test";
import assert from "node:assert/strict";
import { posStock, posStockRows, refreshCatalogOf } from "./pos-stock.ts";
import { buildStockCatalog, type StockCatalogRows } from "./catalog-build.ts";
import { choicesFromWindow, initialWindowState, pickLevel, pickSlot, pickSweetener, optionRows, type WindowState } from "./option-window.ts";
import { defaultChoices } from "./pos-choices.ts";
import { cupPriceDeltaSatang, resolveLine } from "./stock-core.ts";
import { repriceItems } from "../cart-lines.ts";
import type { CartChoices, CartItem } from "../../types/app.ts";

// What the server reads (catalog.ts): fixed lines, material_add effects, sweetness amounts, menus
// and options the POS does not sell.
function fullRows(): StockCatalogRows {
  const mats = ["light", "med", "dark", "kenya", "eth", "milk", "ice", "water", "tea", "oat", "syrup", "condensed", "mix"];
  const m = (
    id: string, group_id: string, raw_material_id: string, label: string, sort_order: number,
    o: { tier?: "house" | "special"; price_delta?: number; is_default?: boolean } = {}
  ) => ({ id, group_id, raw_material_id, label, sort_order, tier: o.tier ?? "house", price_delta: o.price_delta ?? 0, is_default: o.is_default ?? false });
  const slot = (product_id: string, default_member_id: string | null, allow_special = true) =>
    ({ product_id, line_kind: "slot" as const, raw_material_id: null, group_id: "g_bean", quantity_used: 18, default_member_id, allow_special });
  const fixed = (product_id: string, raw_material_id: string, quantity_used: number) =>
    ({ product_id, line_kind: "fixed" as const, raw_material_id, group_id: null, quantity_used, default_member_id: null, allow_special: true });
  const amt = (product_id: string | null, member_id: string, v: number[]) =>
    ["lv_none", "lv_less", "lv_normal", "lv_more"].map((level_id, i) => ({ product_id, member_id, level_id, amount: v[i]! }));
  return {
    materials: mats.map((id) => ({ id, archived_at: null })),
    recipes: [
      slot("latte", "m_med"), fixed("latte", "milk", 180), fixed("latte", "ice", 150),
      slot("americano", "m_dark"), fixed("americano", "water", 200),
      slot("espresso_house", "m_med", false),
      fixed("thai_tea", "tea", 10),
      slot("retired", "m_kenya"), fixed("retired", "milk", 100),
    ],
    groups: [
      { id: "g_bean", kind: "bean", name: "เมล็ดกาแฟ", sort_order: 1 },
      { id: "g_sweet", kind: "sweetener", name: "หวาน", sort_order: 2 },
    ],
    members: [
      m("m_light", "g_bean", "light", "คั่วอ่อน", 1),
      m("m_med", "g_bean", "med", "คั่วกลาง", 2, { is_default: true }),
      m("m_dark", "g_bean", "dark", "คั่วเข้ม", 3),
      m("m_kenya", "g_bean", "kenya", "เคนยา", 4, { tier: "special", price_delta: 20 }),
      m("m_eth", "g_bean", "eth", "เอธิโอเปีย", 5, { tier: "special", price_delta: 30 }),
      m("s_syrup", "g_sweet", "syrup", "ไซรัป", 1, { is_default: true }),
      m("s_condensed", "g_sweet", "condensed", "นมข้น", 2),
      m("s_mix", "g_sweet", "mix", "นมมิกซ์", 3),
    ],
    levels: [
      { id: "lv_none", name: "ไม่หวาน", is_none: true, is_default: false, sort_order: 1 },
      { id: "lv_less", name: "หวานน้อย", is_none: false, is_default: false, sort_order: 2 },
      { id: "lv_normal", name: "หวานปกติ", is_none: false, is_default: true, sort_order: 3 },
      { id: "lv_more", name: "หวานมาก", is_none: false, is_default: false, sort_order: 4 },
    ],
    amounts: [
      ...amt(null, "s_syrup", [0, 10, 20, 35]), ...amt(null, "s_condensed", [0, 15, 30, 45]), ...amt(null, "s_mix", [0, 15, 30, 45]),
      ...amt("thai_tea", "s_condensed", [0, 20, 40, 60]),
    ],
    productSweetness: [
      { product_id: "latte", group_id: "g_sweet", default_member_id: "s_syrup", allowed_member_ids: ["s_condensed", "s_mix"], default_level_id: null, use_custom: false },
      { product_id: "thai_tea", group_id: "g_sweet", default_member_id: "s_condensed", allowed_member_ids: ["s_mix"], default_level_id: "lv_more", use_custom: true },
      { product_id: "retired", group_id: "g_sweet", default_member_id: "s_syrup", allowed_member_ids: [], default_level_id: null, use_custom: false },
    ],
    optionEffects: [
      { option_id: "o_shot", kind: "slot_add", group_id: "g_bean", raw_material_id: null, amount: 9 },
      { option_id: "o_oat", kind: "material_add", group_id: null, raw_material_id: "oat", amount: 180 },
      { option_id: "o_unlinked", kind: "slot_add", group_id: "g_bean", raw_material_id: null, amount: 9 },
    ],
  };
}

const ON_SALE = ["latte", "americano", "espresso_house", "thai_tea", "water"];
const OFFERED = ["o_shot", "o_oat"];

test("the POS rows: menus on sale and their options only, slot lines and slot_add effects only, no amounts", () => {
  const full = fullRows();
  const pos = posStockRows(full, ON_SALE, OFFERED);
  assert.ok(pos.recipes.length > 0);
  assert.ok(pos.recipes.every((r) => r.line_kind === "slot" && ON_SALE.includes(r.product_id)));
  assert.deepEqual(pos.recipes.map((r) => r.product_id), ["latte", "americano", "espresso_house"]);
  assert.deepEqual(pos.optionEffects.map((e) => e.option_id), ["o_shot"]);
  assert.deepEqual(pos.amounts, []);
  assert.deepEqual(pos.productSweetness.map((p) => p.product_id), ["latte", "thai_tea"]);
  assert.deepEqual(pos.materials, full.materials);
  assert.deepEqual(pos.groups, full.groups);
  assert.deepEqual(pos.members, full.members);
  assert.deepEqual(pos.levels, full.levels);
});

const ids = (c: CartChoices) => ({
  slots: c.slots.map((s) => ({ groupId: s.groupId, memberId: s.memberId })),
  sweetness: c.sweetness ? { levelId: c.sweetness.levelId, memberId: c.sweetness.memberId } : null,
});

test("INVARIANT: the client catalog (POS rows) prices and resolves every pick like the server's full catalog", () => {
  const server = buildStockCatalog(fullRows());
  const client = buildStockCatalog(posStockRows(fullRows(), ON_SALE, OFFERED));
  const start = (p: string) => initialWindowState(p, client, []);
  const cases: [string, string, WindowState, string[]][] = [
    ["plain latte", "latte", start("latte"), []],
    ["kenya + เพิ่มช็อต", "latte", pickSlot(start("latte"), "g_bean", "m_kenya"), ["o_shot"]],
    ["ethiopia + oat", "latte", pickSlot(start("latte"), "g_bean", "m_eth"), ["o_oat"]],
    ["kenya + เพิ่มช็อต + oat", "latte", pickSlot(start("latte"), "g_bean", "m_kenya"), ["o_shot", "o_oat"]],
    ["less + mix", "latte", pickSweetener(pickLevel(start("latte"), "lv_less"), optionRows("latte", client), "s_mix"), []],
    ["no sugar", "latte", pickLevel(start("latte"), "lv_none"), ["o_shot"]],
    ["americano dark + shot", "americano", start("americano"), ["o_shot"]],
    ["house-only menu, kenya tapped", "espresso_house", pickSlot(start("espresso_house"), "g_bean", "m_kenya"), ["o_shot"]],
    ["thai tea mix less", "thai_tea", pickSweetener(pickLevel(start("thai_tea"), "lv_less"), optionRows("thai_tea", client), "s_mix"), []],
    ["water", "water", start("water"), []],
  ];
  for (const [name, product, state, options] of cases) {
    const choices = choicesFromWindow(product, client, state, options);
    const s = resolveLine(product, 2, ids(choices), options, server);
    const c = resolveLine(product, 2, ids(choices), options, client);
    assert.ok(!("error" in s) && !("error" in c), name);
    assert.equal(cupPriceDeltaSatang(choices.slots, choices.slotAddGroupIds), s.priceDeltaSatang, `${name}: cart price`);
    assert.equal(c.priceDeltaSatang, s.priceDeltaSatang, `${name}: client resolve price`);
    assert.deepEqual(c.snapshot, s.snapshot, `${name}: snapshot`);
    assert.deepEqual(choices.slots.map((x) => x.memberId), s.snapshot.slots.map((x) => x.memberId), name);
    assert.deepEqual(choices.sweetness && [choices.sweetness.levelId, choices.sweetness.memberId],
      s.snapshot.sweetness && [s.snapshot.sweetness.levelId, s.snapshot.sweetness.memberId], name);
  }
  for (const p of ON_SALE) assert.deepEqual(defaultChoices(p, client), defaultChoices(p, server), p);
  // a sanity check that the case list really exercises the specialty price
  const kenyaShot = choicesFromWindow("latte", client, pickSlot(start("latte"), "g_bean", "m_kenya"), ["o_shot"]);
  assert.equal(cupPriceDeltaSatang(kenyaShot.slots, kenyaShot.slotAddGroupIds), 4000);
});

// ── not loaded: a query failure (null) or a builder throw ─────────────────

test("posStock: loaded rows build the catalog; null or a builder throw → not loaded, empty catalog, error reported", () => {
  const ok = posStock(posStockRows(fullRows(), ON_SALE, OFFERED));
  assert.equal(ok.loaded, true);
  assert.ok(ok.catalog.recipes.has("latte"));
  assert.equal(refreshCatalogOf(ok), ok.catalog);

  const none = posStock(null);
  assert.equal(none.loaded, false);
  assert.equal(none.catalog.recipes.size, 0);
  assert.equal(refreshCatalogOf(none), null);

  const errors: unknown[] = [];
  const broken = { ...fullRows(), levels: undefined } as unknown as StockCatalogRows;
  const threw = posStock(broken, (e) => errors.push(e));
  assert.equal(threw.loaded, false);
  assert.equal(threw.catalog.recipes.size, 0);
  assert.equal(errors.length, 1);
  assert.equal(refreshCatalogOf(threw), null);
});

test("a builder throw leaves a resumed line's choices exactly as stored (never wiped to defaults)", () => {
  const parked: CartItem = {
    cartItemKey: "a", productId: "latte", name: "ลาเต้", basePrice: 65, quantity: 1,
    selectedModifiers: [{ modifierId: "mod_extra", modifierName: "เพิ่ม", optionId: "o_shot", optionName: "เพิ่มช็อต", priceDelta: 15 }],
    totalPrice: 65 + 15 + 40, note: null,
    choices: {
      slots: [{ groupId: "g_bean", memberId: "m_kenya", label: "เคนยา", tier: "special", priceDelta: 20 }],
      slotAddGroupIds: ["g_bean"],
      sweetness: { levelId: "lv_less", levelName: "หวานน้อย", memberId: "s_mix", memberLabel: "นมมิกซ์" },
    },
  };
  const stored = structuredClone(parked.choices);
  const products = [{ id: "latte", price: 65 }];
  const threw = posStock({ ...fullRows(), levels: undefined } as unknown as StockCatalogRows, () => {});
  const [out] = repriceItems([parked], products, [], refreshCatalogOf(threw));
  assert.deepEqual(out!.choices, stored);
  assert.equal(out!.totalPrice, 65 + 15 + 40);
  // what passing the empty catalog itself would have done — the reason "not loaded" is null
  const [wiped] = repriceItems([parked], products, [], threw.catalog);
  assert.deepEqual(wiped!.choices, { slots: [], slotAddGroupIds: [], sweetness: null });
});
