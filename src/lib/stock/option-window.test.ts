import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLine,
  billLineDetail,
  houseGlassToggle,
  toggleHouseGlass,
  cartLineParts,
  choiceParts,
  choicesFromWindow,
  footerText,
  hasOptionRows,
  initialWindowState,
  missingHint,
  missingRequired,
  modifierHint,
  optionRows,
  optionStock,
  pickLevel,
  pickShot,
  pickSlot,
  pickSweetener,
  priceTag,
  refreshChoices,
  shotRows,
  shownSweetener,
  snapshotParts,
  sweetenerHint,
  sweetenerStock,
  tapSpecial,
  toggleOption,
  type WindowState,
} from "./option-window.ts";
import { asksFirst, suppressedMaterials, suppressMaterial, tileState } from "./pos-states.ts";
import { defaultChoices } from "./pos-choices.ts";
import { buildStockCatalog, type StockCatalogRows } from "./catalog-build.ts";
import { cupPriceDeltaSatang, emptyStockCatalog, resolveLine, type ChoiceSnapshot, type ResolvedLine, type StockCatalog } from "./stock-core.ts";
import { lineTotal, unitPrice } from "../cart-math.ts";
import { toLineChoices } from "../order-pricing-core.ts";
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
    productPackaging: [], packagingSets: [], packagingItems: [],
    optionEffects: [
      { option_id: "o_shot", kind: "slot_add", group_id: "g_bean", raw_material_id: null, amount: 18 },
      { option_id: "o_matcha_shot", kind: "slot_add", group_id: "g_matcha", raw_material_id: null, amount: 4 },
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
  assert.deepEqual(s, { slots: { g_bean: "m_med" }, counts: {}, shots: {}, levelId: "lv_normal", sweetenerId: "s_syrup", options: {} });
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
  const s: WindowState = { slots: { g_bean: "m_kenya" }, counts: {}, shots: {}, levelId: "lv_gone", sweetenerId: "s_mix", options: {} };
  const c = choicesFromWindow("espresso_house", catalog, s, []);
  assert.equal(c.slots[0]!.memberId, "m_dark");
  const t = choicesFromWindow("thai_tea", catalog, { ...s, levelId: "lv_less" }, []);
  assert.deepEqual(t.sweetness, { levelId: "lv_less", levelName: "หวานน้อย", memberId: "s_condensed", memberLabel: "นมข้น" });
  assert.equal(choicesFromWindow("latte", catalog, { ...s, slots: { g_bean: "nope" } }, []).slots[0]!.memberId, "m_med");
  assert.equal(choicesFromWindow("latte", catalog, s, []).sweetness?.levelId, "lv_normal");
});

test("เพิ่มช็อต on a special bean uses a house bean and adds only the shot's price; on a house bean it is the same bean", () => {
  let s = tapSpecial(initialWindowState("latte", catalog, []), "g_bean", "m_kenya");
  const kenya = choicesFromWindow("latte", catalog, s, ["o_shot"]);
  assert.deepEqual(kenya.slotAddGroupIds, ["g_bean"]);
  assert.deepEqual(kenya.slots, [{
    groupId: "g_bean", memberId: "m_kenya", label: "เคนยา", tier: "special", priceDelta: 20,
    shot: { memberId: "m_med", label: "คั่วกลาง", optionIds: ["o_shot"] },
  }]);
  assert.equal(unitPrice(65, [{ priceDelta: 15 }], kenya), 65 + 15 + 20);
  s = pickSlot(s, "g_bean", "m_med");
  const house = choicesFromWindow("latte", catalog, s, ["o_shot", "o_oat"]);
  assert.deepEqual(house.slotAddGroupIds, ["g_bean"]);
  assert.deepEqual(house.slots, [{ groupId: "g_bean", memberId: "m_med", label: "คั่วกลาง", tier: "house", priceDelta: 0 }]);
  assert.equal(unitPrice(65, [{ priceDelta: 15 }, { priceDelta: 10 }], house), 90);
  // no slot for the effect's group → nothing added
  assert.deepEqual(choicesFromWindow("thai_tea", catalog, initialWindowState("thai_tea", catalog, []), ["o_shot"]).slotAddGroupIds, []);
});

test("the shot member: the picked house bean; a special or unknown pick → the menu's house default", () => {
  const kenya = tapSpecial(initialWindowState("latte", catalog, []), "g_bean", "m_kenya");
  const shotOf = (s: WindowState, p = "latte") => choicesFromWindow(p, catalog, s, ["o_shot"]).slots[0]!.shot;
  assert.deepEqual(shotOf(pickShot(kenya, "g_bean", "m_dark")), { memberId: "m_dark", label: "คั่วเข้ม", optionIds: ["o_shot"] });
  assert.equal(shotOf(pickShot(kenya, "g_bean", "m_eth"))?.memberId, "m_med");
  assert.equal(shotOf(pickShot(kenya, "g_bean", "nope"))?.memberId, "m_med");
  // a menu whose own default is a special: the shot uses the group's house default
  assert.equal(shotOf(initialWindowState("kenya_default", catalog, []), "kenya_default")?.memberId, "m_med");
  // no shot option ticked → no shot written, even with a pick kept
  assert.equal("shot" in choicesFromWindow("latte", catalog, pickShot(kenya, "g_bean", "m_dark"), []).slots[0]!, false);
});

test("INVARIANT: the cart's specialty price equals the server's for every pick", () => {
  const start = (p: string) => initialWindowState(p, catalog, []);
  const twice = (s: WindowState, m: string) => tapSpecial(tapSpecial(s, "g_bean", m), "g_bean", m);
  const picks: [string, WindowState, string[]][] = [
    ["latte", pickSlot(start("latte"), "g_bean", "m_kenya"), []],
    ["latte", pickSlot(start("latte"), "g_bean", "m_eth"), ["o_shot"]],
    ["latte", pickSlot(start("latte"), "g_bean", "m_light"), ["o_shot"]],
    ["latte", twice(start("latte"), "m_kenya"), []],
    ["latte", pickShot(twice(start("latte"), "m_eth"), "g_bean", "m_light"), ["o_shot"]],
    ["kenya_default", start("kenya_default"), ["o_shot"]],
    ["kenya_default", twice(pickSlot(start("kenya_default"), "g_bean", "m_med"), "m_kenya"), ["o_shot"]],
    ["espresso_house", pickSlot(start("espresso_house"), "g_bean", "m_kenya"), ["o_shot"]],
    // a ×2 kept in the state for a special the menu does not allow: the house fallback is ×1
    ["espresso_house", twice(start("espresso_house"), "m_kenya"), ["o_shot"]],
  ];
  for (const [p, state, options] of picks) {
    const c = choicesFromWindow(p, catalog, state, options);
    const server = resolveLine(p, 1, toLineChoices({ choices: c }), options, catalog);
    assert.ok(!("error" in server), p);
    assert.equal(cupPriceDeltaSatang(c.slots), server.priceDeltaSatang, `${p} ${JSON.stringify(state.slots)}`);
    assert.deepEqual(c.slots.map((x) => [x.memberId, x.count, x.shot?.memberId, x.shot?.optionIds]),
      server.snapshot.slots.map((x) => [x.memberId, x.count, x.shot?.memberId, x.shot?.optionIds]), p);
  }
});

// ── taps: a special doubles, a house chip never does ─────────────────────

test("tapSpecial: ×1 → ×2 → ×1; another special starts at ×1; a house chip clears ×2", () => {
  const s0 = initialWindowState("latte", catalog, []);
  const once = tapSpecial(s0, "g_bean", "m_kenya");
  assert.deepEqual([once.slots, once.counts], [{ g_bean: "m_kenya" }, {}]);
  const twice = tapSpecial(once, "g_bean", "m_kenya");
  assert.deepEqual([twice.slots, twice.counts], [{ g_bean: "m_kenya" }, { g_bean: 2 }]);
  assert.equal(choicesFromWindow("latte", catalog, twice, []).slots[0]!.count, 2);
  const thrice = tapSpecial(twice, "g_bean", "m_kenya");
  assert.deepEqual([thrice.slots, thrice.counts], [{ g_bean: "m_kenya" }, {}]);
  assert.equal("count" in choicesFromWindow("latte", catalog, thrice, []).slots[0]!, false);
  // switching to another special resets to ×1
  const eth = tapSpecial(twice, "g_bean", "m_eth");
  assert.deepEqual([eth.slots, eth.counts], [{ g_bean: "m_eth" }, {}]);
  // a house chip after ×2: that house member, count cleared; re-tapping it changes nothing
  const house = pickSlot(twice, "g_bean", "m_dark");
  assert.deepEqual([house.slots, house.counts], [{ g_bean: "m_dark" }, {}]);
  assert.deepEqual(pickSlot(house, "g_bean", "m_dark"), house);
  // a house member never doubles, even with a stray count in the state
  const stray: WindowState = { ...house, counts: { g_bean: 2 } };
  assert.equal("count" in choicesFromWindow("latte", catalog, stray, []).slots[0]!, false);
});

test("×2 stays only on the chosen member: a parked Ethiopia ×2 whose bean is gone resumes as Kenya ×1 at ฿85", () => {
  const noEth = buildStockCatalog({ ...rows(), members: rows().members.filter((m) => m.id !== "m_eth") });
  const parked: CartChoices = {
    slots: [{ groupId: "g_bean", memberId: "m_eth", label: "เอธิโอเปีย", tier: "special", priceDelta: 30, count: 2 }],
    slotAddGroupIds: [],
    sweetness: null,
  };
  const back = refreshChoices("kenya_default", noEth, parked, []);
  assert.deepEqual(back.slots, [{ groupId: "g_bean", memberId: "m_kenya", label: "เคนยา", tier: "special", priceDelta: 20 }]);
  assert.equal(lineTotal(65, [], 1, back), 85);
  // the server agrees on what it receives
  const server = resolveLine("kenya_default", 1, toLineChoices({ choices: back }), [], noEth);
  assert.ok(!("error" in server));
  assert.equal(server.priceDeltaSatang, 2000);
  // a state pick the menu does not know (or a special the menu forbids) keeps no ×2 on the fallback
  const s0 = initialWindowState("kenya_default", catalog, []);
  assert.equal("count" in choicesFromWindow("kenya_default", catalog, { ...s0, slots: { g_bean: "nope" }, counts: { g_bean: 2 } }, []).slots[0]!, false);
  assert.equal(choicesFromWindow("kenya_default", catalog, { ...s0, counts: { g_bean: 2 } }, []).slots[0]!.count, 2);
});

test("an option adding to two special slots names every shot bean, in slot order: เพิ่มทั้งคู่ คั่วกลาง/อุจิ (+60)", () => {
  const c = buildStockCatalog({
    ...rows(),
    recipes: [
      ...rows().recipes,
      { product_id: "dirty", line_kind: "slot", raw_material_id: null, group_id: "g_bean", quantity_used: 18, default_member_id: "m_med", allow_special: true },
      { product_id: "dirty", line_kind: "slot", raw_material_id: null, group_id: "g_matcha", quantity_used: 4, default_member_id: "t_uji", allow_special: true },
    ],
    optionEffects: [
      ...rows().optionEffects,
      { option_id: "o_both", kind: "slot_add", group_id: "g_bean", raw_material_id: null, amount: 18 },
      { option_id: "o_both", kind: "slot_add", group_id: "g_matcha", raw_material_id: null, amount: 4 },
    ],
  });
  const both: ModifierWithOptions = {
    id: "mod_both", name: "เพิ่ม", isRequired: false, isMultiSelect: false, sortOrder: 1,
    options: [{ id: "o_both", name: "เพิ่มทั้งคู่", priceDelta: 60, sortOrder: 1 }],
  };
  let s = initialWindowState("dirty", c, [both]);
  s = toggleOption(tapSpecial(tapSpecial(s, "g_bean", "m_kenya"), "g_matcha", "t_cer"), both, "o_both");
  const line = buildLine({ product: { id: "dirty", name: "เดอร์ตี้", price: 90 }, modifiers: [both], catalog: c, state: s, note: "", quantity: 1, key: "d" });
  const words = "เคนยา (+20) · Ceremonial (+40) · เพิ่มทั้งคู่ คั่วกลาง/อุจิ (+60)";
  assert.equal(cartLineParts(line, null).map((p) => p.text).join(" · "), words);
  const server = resolveLine("dirty", 1, toLineChoices(line), ["o_both"], c);
  assert.ok(!("error" in server));
  assert.equal(billLineDetail(server.snapshot, [{ option: "เพิ่มทั้งคู่", priceDelta: 60, optionId: "o_both" }]), words);
  assert.equal(line.totalPrice, 90 + 20 + 40 + 60);
  // only the slots whose shot lists the option are named: a house matcha cup names the bean only
  const houseMatcha = buildLine({ product: { id: "dirty", name: "เดอร์ตี้", price: 90 }, modifiers: [both], catalog: c,
    state: pickSlot(s, "g_matcha", "t_uji"), note: "", quantity: 1, key: "d" });
  assert.equal(cartLineParts(houseMatcha, null).at(-1)!.text, "เพิ่มทั้งคู่ คั่วกลาง (+60)");
});

test("pickShot: the pick is kept when the shot option is unticked and ticked again", () => {
  let s = tapSpecial(initialWindowState("latte", catalog, [extras]), "g_bean", "m_kenya");
  s = toggleOption(s, extras, "o_shot");
  s = pickShot(s, "g_bean", "m_dark");
  const built = (st: WindowState) => buildLine({ product: latte, modifiers: [extras], catalog, state: st, note: "", quantity: 1, key: "k" });
  assert.equal(built(s).choices!.slots[0]!.shot?.memberId, "m_dark");
  s = toggleOption(s, extras, "o_shot");
  assert.equal("shot" in built(s).choices!.slots[0]!, false);
  assert.deepEqual(s.shots, { g_bean: "m_dark" });
  s = toggleOption(s, extras, "o_shot");
  assert.equal(built(s).choices!.slots[0]!.shot?.memberId, "m_dark");
  // and when the cup goes house and back to Kenya
  s = tapSpecial(pickSlot(s, "g_bean", "m_light"), "g_bean", "m_kenya");
  assert.equal(built(s).choices!.slots[0]!.shot?.memberId, "m_dark");
});

// ── the "ช็อตเพิ่มใช้…" sub-row ──────────────────────────────────────────

test("shot sub-row titles: bean, matcha, any other group by its name", () => {
  assert.equal(optionRows("latte", catalog).slots[0]!.shotTitle, "ช็อตเพิ่มใช้เมล็ดร้าน");
  assert.equal(optionRows("matcha_latte", catalog).slots[0]!.shotTitle, "ช็อตเพิ่มใช้มัทฉะร้าน");
  const other = buildStockCatalog({ ...rows(), groups: rows().groups.map((g) => (g.id === "g_bean" ? { ...g, kind: "other" as const, name: "ช็อต" } : g)) });
  assert.equal(optionRows("latte", other).slots[0]!.shotTitle, "ช็อตเพิ่มใช้ช็อต");
});

test("shotRows: a special cup with a ticked shot gets the house chips right after that option's row", () => {
  const r = optionRows("latte", catalog);
  const lineOf = (s: WindowState) => buildLine({ product: latte, modifiers: [temp, extras], catalog, state: s, note: "", quantity: 1, key: "k" });
  let s = initialWindowState("latte", catalog, [temp, extras]);
  // a house cup, with or without the shot: no row
  assert.deepEqual(shotRows(r, lineOf(s)), []);
  assert.deepEqual(shotRows(r, lineOf(toggleOption(s, extras, "o_shot"))), []);
  // a special cup without the shot: no row
  s = tapSpecial(s, "g_bean", "m_kenya");
  assert.deepEqual(shotRows(r, lineOf(s)), []);
  s = toggleOption(s, extras, "o_shot");
  assert.deepEqual(shotRows(r, lineOf(s)), [{
    groupId: "g_bean", title: "ช็อตเพิ่มใช้เมล็ดร้าน", chips: r.slots[0]!.house, selectedId: "m_med", afterModifierId: "mod_extra",
  }]);
  assert.deepEqual(r.slots[0]!.house.map((c) => c.label), ["คั่วอ่อน", "คั่วกลาง", "คั่วเข้ม"]);
  assert.equal(shotRows(r, lineOf(pickShot(s, "g_bean", "m_dark")))[0]!.selectedId, "m_dark");
  // ×2 keeps the row
  assert.equal(shotRows(r, lineOf(tapSpecial(s, "g_bean", "m_kenya"))).length, 1);
  // a matcha menu with its own shot option
  const matchaShot: ModifierWithOptions = {
    id: "mod_matcha", name: "เพิ่ม", isRequired: false, isMultiSelect: false, sortOrder: 1,
    options: [{ id: "o_matcha_shot", name: "เพิ่มช็อตมัทฉะ", priceDelta: 50, sortOrder: 1 }],
  };
  const m = toggleOption(tapSpecial(initialWindowState("matcha_latte", catalog, [matchaShot]), "g_matcha", "t_cer"), matchaShot, "o_matcha_shot");
  const mLine = buildLine({ product: { id: "matcha_latte", name: "มัทฉะลาเต้", price: 70 }, modifiers: [matchaShot], catalog, state: m, note: "", quantity: 1, key: "m" });
  assert.deepEqual(shotRows(optionRows("matcha_latte", catalog), mLine).map((x) => [x.title, x.selectedId, x.afterModifierId, x.chips.map((c) => c.label)]),
    [["ช็อตเพิ่มใช้มัทฉะร้าน", "t_uji", "mod_matcha", ["อุจิ"]]]);
  assert.equal(mLine.totalPrice, 70 + 40 + 50);
  assert.deepEqual(cartLineParts(mLine, null).map((p) => p.text), ["Ceremonial (+40)", "เพิ่มช็อตมัทฉะ อุจิ (+50)"]);
});

test("shotRows: the row follows the FIRST modifier row holding a shot option; no house member → no row", () => {
  const second: ModifierWithOptions = {
    id: "mod_more", name: "เพิ่มอีก", isRequired: false, isMultiSelect: false, sortOrder: 0,
    options: [{ id: "o_shot2", name: "ช็อตคู่", priceDelta: 25, sortOrder: 1 }],
  };
  const c = buildStockCatalog({
    ...rows(),
    optionEffects: [...rows().optionEffects, { option_id: "o_shot2", kind: "slot_add", group_id: "g_bean", raw_material_id: null, amount: 18 }],
  });
  let s = tapSpecial(initialWindowState("latte", c, [second, extras]), "g_bean", "m_kenya");
  s = toggleOption(toggleOption(s, extras, "o_shot"), second, "o_shot2");
  const line = buildLine({ product: latte, modifiers: [second, extras], catalog: c, state: s, note: "", quantity: 1, key: "k" });
  assert.deepEqual(line.choices!.slots[0]!.shot?.optionIds, ["o_shot2", "o_shot"]);
  assert.equal(shotRows(optionRows("latte", c), line)[0]!.afterModifierId, "mod_more");
  // both options name the house bean
  assert.deepEqual(cartLineParts(line, null).map((p) => p.text).slice(-2), ["ช็อตคู่ คั่วกลาง (+25)", "เพิ่มช็อต คั่วกลาง (+15)"]);
  // a group with only special members: the shot uses the special itself and there is nothing to pick
  const onlySpecial = buildStockCatalog({
    ...rows(),
    members: rows().members.filter((m) => m.group_id !== "g_matcha" || m.tier === "special"),
    recipes: [{ product_id: "ceremony_only", line_kind: "slot", raw_material_id: null, group_id: "g_matcha", quantity_used: 4, default_member_id: "t_cer", allow_special: true }],
  });
  const ms: ModifierWithOptions = { ...extras, id: "mod_m", options: [{ id: "o_matcha_shot", name: "เพิ่มช็อตมัทฉะ", priceDelta: 50, sortOrder: 1 }] };
  const st = toggleOption(initialWindowState("ceremony_only", onlySpecial, [ms]), ms, "o_matcha_shot");
  const ml = buildLine({ product: { id: "ceremony_only", name: "มัทฉะพิเศษ", price: 90 }, modifiers: [ms], catalog: onlySpecial, state: st, note: "", quantity: 1, key: "m" });
  assert.equal(ml.choices!.slots[0]!.shot?.memberId, "t_cer");
  assert.equal(ml.totalPrice, 90 + 40 + 50);
  assert.deepEqual(shotRows(optionRows("ceremony_only", onlySpecial), ml), []);
  const server = resolveLine("ceremony_only", 1, toLineChoices(ml), ["o_matcha_shot"], onlySpecial);
  assert.ok(!("error" in server));
  assert.equal(server.priceDeltaSatang, 4000);
  assert.deepEqual(server.stock, [{ materialId: "ceremony", qty: 8 }]);
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
  assert.equal(line.totalPrice, 65 + 15 + 10 + 10 + 20);
  assert.equal(footerText("add", line), "เพิ่มลงตะกร้า · ฿120");
  // the footer follows ×2 too
  const doubled = buildLine({ product: latte, modifiers: [extras, toppings], catalog, state: tapSpecial(s, "g_bean", "m_kenya"), note: "", quantity: 1, key: "k1" });
  assert.equal(footerText("add", doubled), "เพิ่มลงตะกร้า · ฿140");
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
  totalPrice: (65 + 15 + 20) * 2, note: "แยกน้ำแข็ง",
  choices: {
    slots: [{
      groupId: "g_bean", memberId: "m_kenya", label: "เคนยา", tier: "special", priceDelta: 20,
      shot: { memberId: "m_med", label: "คั่วกลาง", optionIds: ["o_shot"] },
    }],
    slotAddGroupIds: ["g_bean"],
    sweetness: { levelId: "lv_less", levelName: "หวานน้อย", memberId: "s_mix", memberLabel: "นมมิกซ์" },
  },
};

test("edit: the window starts on the line's own picks and rebuilds the same line", () => {
  const s = initialWindowState("latte", catalog, [extras, temp], kenyaLine);
  assert.deepEqual(s, {
    slots: { g_bean: "m_kenya" }, counts: {}, shots: { g_bean: "m_med" },
    levelId: "lv_less", sweetenerId: "s_mix", options: { mod_extra: ["o_shot"] },
  });
  const again = buildLine({ product: latte, modifiers: [extras, temp], catalog, state: s, note: kenyaLine.note!, quantity: 2, key: "line1" });
  assert.deepEqual(again, kenyaLine);
});

test("edit: a Kenya ×2 line with its shot on คั่วเข้ม opens on ×2 and that shot bean, and rebuilds the same line", () => {
  const slot = { ...kenyaLine.choices!.slots[0]!, count: 2 as const, shot: { memberId: "m_dark", label: "คั่วเข้ม", optionIds: ["o_shot"] } };
  const line: CartItem = { ...kenyaLine, totalPrice: (65 + 15 + 40) * 2, choices: { ...kenyaLine.choices!, slots: [slot] } };
  const s = initialWindowState("latte", catalog, [extras, temp], line);
  assert.deepEqual([s.counts, s.shots], [{ g_bean: 2 }, { g_bean: "m_dark" }]);
  assert.deepEqual(buildLine({ product: latte, modifiers: [extras, temp], catalog, state: s, note: line.note!, quantity: 2, key: "line1" }), line);
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
    slots: [{
      groupId: "g_bean", memberId: "m_kenya", label: "เคนยา", tier: "special", priceDelta: 20,
      shot: { memberId: "m_med", label: "คั่วกลาง", optionIds: ["o_shot"] },
    }],
    slotAddGroupIds: ["g_bean"],
    sweetness: { levelId: "lv_less", levelName: "หวานน้อย", memberId: "s_mix", memberLabel: "นมมิกซ์" },
  });
});

test("refresh: ×2 and the shot bean are kept while still offered; a stale label is replaced; ×2 on a house member is dropped", () => {
  const parked: CartChoices = {
    slots: [{ groupId: "g_bean", memberId: "m_kenya", label: "old", tier: "special", priceDelta: 15, count: 2, shot: { memberId: "m_light", label: "old", optionIds: ["x"] } }],
    slotAddGroupIds: [],
    sweetness: null,
  };
  assert.deepEqual(refreshChoices("latte", catalog, parked, ["o_shot"]).slots, [{
    groupId: "g_bean", memberId: "m_kenya", label: "เคนยา", tier: "special", priceDelta: 20, count: 2,
    shot: { memberId: "m_light", label: "คั่วอ่อน", optionIds: ["o_shot"] },
  }]);
  // the shot option no longer chosen → no shot; a house member stored with ×2 → ×1
  assert.equal("shot" in refreshChoices("latte", catalog, parked, []).slots[0]!, false);
  const house: CartChoices = { ...parked, slots: [{ ...parked.slots[0]!, memberId: "m_dark", tier: "house" }] };
  assert.deepEqual(refreshChoices("latte", catalog, house, ["o_shot"]).slots, [
    { groupId: "g_bean", memberId: "m_dark", label: "คั่วเข้ม", tier: "house", priceDelta: 0 },
  ]);
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
    [["เคนยา (+20)", true], ["หวานน้อย", true], ["นมมิกซ์", true]]);
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

test("cart text when the bean/sweetness data did not load: every word shown, none marked", () => {
  assert.deepEqual(choiceParts(kenyaLine.choices, null), [
    { text: "เคนยา (+20)", changed: false }, { text: "หวานน้อย", changed: false }, { text: "นมมิกซ์", changed: false },
  ]);
});

test("R42: every chosen option shows after the bean/sweetness words, always marked (options are never defaults)", () => {
  const d = defaultChoices("latte", catalog);
  const line: CartItem = {
    ...kenyaLine,
    selectedModifiers: [
      ...kenyaLine.selectedModifiers,
      { modifierId: "mod_top", modifierName: "ท็อปปิ้ง", optionId: "o_pearl", optionName: "ไข่มุก", priceDelta: 10 },
    ],
  };
  assert.deepEqual(cartLineParts(line, d), [
    { text: "เคนยา (+20)", changed: true }, { text: "หวานน้อย", changed: true }, { text: "นมมิกซ์", changed: true },
    { text: "เพิ่มช็อต คั่วกลาง (+15)", changed: true }, { text: "ไข่มุก (+10)", changed: true },
  ]);
  // defaults stay plain; options are still marked even when the stock data did not load
  const plainShot: CartItem = { ...line, choices: d, selectedModifiers: [line.selectedModifiers[0]!] };
  assert.deepEqual(cartLineParts(plainShot, d).map((p) => p.changed), [false, false, false, true]);
  assert.deepEqual(cartLineParts(plainShot, null).map((p) => p.changed), [false, false, false, true]);
  // a pre-D1 line: only its options
  const legacy: CartItem = { ...plainShot };
  delete legacy.choices;
  assert.deepEqual(cartLineParts(legacy, d), [{ text: "เพิ่มช็อต (+15)", changed: true }]);
});

test("a special shows its price in the cart words; a free special and a house pick show the label only", () => {
  const free = { ...kenyaLine.choices!, slots: [{ ...kenyaLine.choices!.slots[0]!, priceDelta: 0 }] };
  assert.equal(choiceParts(free, null)[0]!.text, "เคนยา");
  const house = { ...kenyaLine.choices!, slots: [{ groupId: "g_bean", memberId: "m_med", label: "คั่วกลาง", tier: "house" as const, priceDelta: 0 }] };
  assert.equal(choiceParts(house, null)[0]!.text, "คั่วกลาง");
});

const snap = {
  slots: [{ groupId: "g_bean", memberId: "m_kenya", materialId: "mat1", label: "เคนยา", tier: "special" as const, priceDelta: 20 }],
  slotAddGroupIds: [],
  sweetness: { levelId: "lv_less", levelName: "หวานน้อย", memberId: "s_mix", label: "นมมิกซ์" },
};

test("bill history words: same words and order as the cart", () => {
  assert.deepEqual(snapshotParts(snap), ["เคนยา (+20)", "หวานน้อย", "นมมิกซ์"]);
  assert.deepEqual(snapshotParts(snap), choiceParts(kenyaLine.choices, null).map((p) => p.text));
  assert.equal(billLineDetail(snap, ["เพิ่มช็อต"]), "เคนยา (+20) · หวานน้อย · นมมิกซ์ · เพิ่มช็อต");
  assert.deepEqual(snapshotParts({ ...snap, sweetness: { levelId: "n", levelName: "ไม่หวาน", memberId: null, label: null } }), ["เคนยา (+20)", "ไม่หวาน"]);
});

test("bill history: a pre-D1 line (no snapshot) renders as before; an empty snapshot shows nothing", () => {
  assert.deepEqual(snapshotParts(null), []);
  assert.equal(billLineDetail(null, ["ร้อน", "หวาน"]), "ร้อน, หวาน");
  assert.equal(billLineDetail(null, []), null);
  assert.equal(billLineDetail({ slots: [], slotAddGroupIds: [], sweetness: null }, []), null);
});

// ---- extra shot on a house bean, ×2 specials: the words add up to the price charged ----

/** Every "(+N)" / "(−N)" amount in the words; "×2" after an amount counts it twice. */
function amountsOf(words: string[]): number {
  let sum = 0;
  for (const w of words) {
    const m = /\(([+−])(\d+(?:\.\d+)?)\)( ×2)?/.exec(w);
    if (m) sum += (m[1] === "+" ? 1 : -1) * Number(m[2]) * (m[3] ? 2 : 1);
  }
  return sum;
}

const latteProduct = { id: "latte", name: "ลาเต้", price: 65 };
function fixture(pick: (s: WindowState) => WindowState): CartItem {
  const base = initialWindowState("latte", catalog, [extras, temp]);
  return buildLine({ product: latteProduct, modifiers: [extras, temp], catalog, state: pick(base), note: "", quantity: 1, key: "k" });
}
const withKenya = (s: WindowState) => tapSpecial(s, "g_bean", "m_kenya");
const withKenya2 = (s: WindowState) => tapSpecial(tapSpecial(s, "g_bean", "m_kenya"), "g_bean", "m_kenya");
const withShot = (s: WindowState) => toggleOption(s, extras, "o_shot");
const withOat = (s: WindowState) => toggleOption(s, extras, "o_oat");
const withIced = (s: WindowState) => toggleOption(s, temp, "o_iced");
const shotOnDark = (s: WindowState) => pickShot(s, "g_bean", "m_dark");

/** The server's view of the window's line: the ids it receives (toLineChoices) resolved from the catalog. */
function serverOf(line: CartItem): ResolvedLine {
  const r = resolveLine("latte", line.quantity, toLineChoices(line), line.selectedModifiers.map((m) => m.optionId), catalog);
  assert.ok(!("error" in r));
  return r;
}
/** The bill's words: the server's snapshot + the stored modifiers_snapshot entries (with optionId). */
function billOf(line: CartItem): string | null {
  return billLineDetail(
    serverOf(line).snapshot,
    line.selectedModifiers.map((m) => ({ option: m.optionName, priceDelta: m.priceDelta, optionId: m.optionId }))
  );
}

test("invariant: {house, special ×1, special ×2} × {no shot, shot} × {default shot bean, another house bean}", () => {
  const cups: [string, (s: WindowState) => WindowState][] = [["house", (s) => s], ["special ×1", withKenya], ["special ×2", withKenya2]];
  const shots: [string, (s: WindowState) => WindowState][] = [["no shot", (s) => s], ["shot", withShot]];
  const shotPicks: [string, (s: WindowState) => WindowState][] = [["default shot bean", (s) => s], ["other house shot bean", shotOnDark]];
  // and the same with a priced option that adds no shot, to keep the option words honest
  const extrasToo: [string, (s: WindowState) => WindowState][] = [["", (s) => s], [" + oat + iced", (s) => withIced(withOat(s))]];
  let cases = 0;
  for (const [cupName, cup] of cups) for (const [shotName, shot] of shots) for (const [pickName, pick] of shotPicks) for (const [moreName, more] of extrasToo) {
    // the extras row is single-select: "+ oat" replaces the shot, so only combine it with "no shot"
    if (moreName !== "" && shotName === "shot") continue;
    const name = `${cupName}, ${shotName}, ${pickName}${moreName}`;
    const line = fixture((s) => more(pick(shot(cup(s)))));
    const server = serverOf(line);
    const optionTotal = line.selectedModifiers.reduce((a, m) => a + m.priceDelta, 0);
    const unit = unitPrice(line.basePrice, line.selectedModifiers, line.choices);
    // the window's price is the server's price plus the option prices
    assert.equal(unit, line.basePrice + optionTotal + server.priceDeltaSatang / 100, `price: ${name}`);
    assert.equal(line.totalPrice, unit, `line total: ${name}`);
    // the cart words and the bill words both add up to it
    assert.equal(line.basePrice + amountsOf(cartLineParts(line, null).map((p) => p.text)), unit, `cart words: ${name}`);
    assert.equal(line.basePrice + amountsOf((billOf(line) ?? "").split(" · ")), unit, `bill words: ${name}`);
    // the cart and the bill say the same thing
    assert.equal(cartLineParts(line, null).map((p) => p.text).join(" · "), billOf(line), `same words: ${name}`);
    // the window's shot bean is the one the server deducts
    assert.equal(line.choices!.slots[0]!.shot?.memberId, server.snapshot.slots[0]!.shot?.memberId, `shot member: ${name}`);
    assert.equal(line.choices!.slots[0]!.count, server.snapshot.slots[0]!.count, `count: ${name}`);
    cases++;
  }
  assert.equal(cases, 3 * 2 * 2 + 3 * 1 * 2);
});

test("exact words: house latte + shot", () => {
  const line = fixture(withShot);
  const words = "คั่วกลาง · หวานปกติ · ไซรัป · เพิ่มช็อต (+15)";
  assert.equal(cartLineParts(line, null).map((p) => p.text).join(" · "), words);
  assert.equal(billOf(line), words);
  assert.equal(unitPrice(65, line.selectedModifiers, line.choices), 80);
  // the same house bean twice: 18 + 18 g
  assert.deepEqual(serverOf(line).stock.filter((l) => ["med", "dark", "kenya"].includes(l.materialId)), [{ materialId: "med", qty: 36 }]);
});

test("exact words: Kenya + shot on คั่วกลาง (the menu's house default) is ฿100", () => {
  const line = fixture((s) => withShot(withKenya(s)));
  const words = "เคนยา (+20) · หวานปกติ · ไซรัป · เพิ่มช็อต คั่วกลาง (+15)";
  assert.equal(cartLineParts(line, null).map((p) => p.text).join(" · "), words);
  assert.equal(billOf(line), words);
  assert.equal(unitPrice(65, line.selectedModifiers, line.choices), 100);
  assert.deepEqual(serverOf(line).stock.filter((l) => ["med", "dark", "kenya"].includes(l.materialId)),
    [{ materialId: "kenya", qty: 18 }, { materialId: "med", qty: 18 }]);
});

test("exact words: Kenya ×2 is ฿105", () => {
  const line = fixture(withKenya2);
  const words = "เคนยา (+20) ×2 · หวานปกติ · ไซรัป";
  assert.equal(cartLineParts(line, null).map((p) => p.text).join(" · "), words);
  assert.equal(billOf(line), words);
  assert.equal(unitPrice(65, line.selectedModifiers, line.choices), 105);
  assert.deepEqual(serverOf(line).stock.filter((l) => ["med", "dark", "kenya"].includes(l.materialId)), [{ materialId: "kenya", qty: 36 }]);
});

test("exact words: Kenya ×2 + shot on คั่วเข้ม is ฿120 — Kenya 36 g + คั่วเข้ม 18 g", () => {
  const line = fixture((s) => shotOnDark(withShot(withKenya2(s))));
  const words = "เคนยา (+20) ×2 · หวานปกติ · ไซรัป · เพิ่มช็อต คั่วเข้ม (+15)";
  assert.equal(cartLineParts(line, null).map((p) => p.text).join(" · "), words);
  assert.equal(billOf(line), words);
  assert.equal(unitPrice(65, line.selectedModifiers, line.choices), 120);
  assert.deepEqual(serverOf(line).stock.filter((l) => ["med", "dark", "kenya"].includes(l.materialId)),
    [{ materialId: "dark", qty: 18 }, { materialId: "kenya", qty: 36 }]);
});

test("words: ×2 is always marked; a free special ×2 says ×2; a bill without option ids keeps the plain option word", () => {
  const d = defaultChoices("kenya_default", catalog);
  const own = buildLine({
    product: { id: "kenya_default", name: "เคนยาดริป", price: 80 }, modifiers: [], catalog,
    state: tapSpecial(initialWindowState("kenya_default", catalog, []), "g_bean", "m_kenya"), note: "", quantity: 1, key: "k",
  });
  // the menu's own default member, doubled, is not the default cup
  assert.deepEqual(cartLineParts(own, d)[0], { text: "เคนยา (+20) ×2", changed: true });
  assert.deepEqual(cartLineParts(buildLine({ product: { id: "kenya_default", name: "เคนยาดริป", price: 80 }, modifiers: [], catalog,
    state: initialWindowState("kenya_default", catalog, []), note: "", quantity: 1, key: "k" }), d)[0], { text: "เคนยา (+20)", changed: false });
  const free = { ...own.choices!, slots: own.choices!.slots.map((s) => ({ ...s, priceDelta: 0 })) };
  assert.equal(choiceParts(free, null)[0]!.text, "เคนยา ×2");
  // a snapshot shot only names the option it lists, matched by option id
  const line = fixture((s) => withShot(withKenya(s)));
  const snapshot = serverOf(line).snapshot;
  assert.equal(billLineDetail(snapshot, [{ option: "เพิ่มช็อต", priceDelta: 15 }]), "เคนยา (+20) · หวานปกติ · ไซรัป · เพิ่มช็อต (+15)");
  assert.equal(billLineDetail(snapshot, [{ option: "นมโอ๊ต", priceDelta: 10, optionId: "o_oat" }]), "เคนยา (+20) · หวานปกติ · ไซรัป · นมโอ๊ต (+10)");
  assert.equal(billLineDetail(snapshot, ["เพิ่มช็อต"]), "เคนยา (+20) · หวานปกติ · ไซรัป · เพิ่มช็อต");
  assert.equal(billLineDetail(null, [{ option: "ร้อน", priceDelta: 0 }, { option: "เย็น", priceDelta: 5 }]), "ร้อน, เย็น (+5)");
});

test("a pre-D1 line without choices is unchanged apart from option prices", () => {
  const legacy: CartItem = { ...kenyaLine };
  delete legacy.choices;
  assert.deepEqual(cartLineParts(legacy, null), [{ text: "เพิ่มช็อต (+15)", changed: true }]);
  assert.equal(billLineDetail(null, [{ option: "เพิ่มช็อต", priceDelta: 15, optionId: "o_shot" }, { option: "ร้อน", priceDelta: 0 }]), "เพิ่มช็อต (+15), ร้อน");
});

test("editing a line keeps its houseGlass", () => {
  const args = { product: latte, modifiers: [], catalog, state: initialWindowState("latte", catalog, []), note: "", quantity: 2, key: "k" };
  assert.ok(!("houseGlass" in buildLine(args)), "a new line never gets houseGlass");
  assert.ok(!("houseGlass" in buildLine({ ...args, editing: {} })), "absent stays absent");
  assert.equal(buildLine({ ...args, editing: { houseGlass: true } }).houseGlass, true);
  assert.equal(buildLine({ ...args, editing: { houseGlass: false } }).houseGlass, false);
});

// ---- D2a task 7: house glass words and the cart toggle ----

function packagingCatalog(houseGlassDefault: boolean): StockCatalog {
  const c = emptyStockCatalog();
  c.packaging.set("p1", { setId: "set1", houseGlassDefault });
  return c;
}

function plainLine(houseGlass?: boolean): CartItem {
  const line: CartItem = {
    cartItemKey: "k", productId: "p1", name: "ลาเต้", basePrice: 80, quantity: 2,
    selectedModifiers: [], note: null, totalPrice: 160,
  };
  if (houseGlass !== undefined) line.houseGlass = houseGlass;
  return line;
}

test("cart words add แก้วร้าน only when house glass is used", () => {
  assert.deepEqual(cartLineParts(plainLine(), null, false), []);
  assert.deepEqual(cartLineParts(plainLine(false), null, false), []);
  assert.deepEqual(cartLineParts(plainLine(true), null, false), [{ text: "แก้วร้าน", changed: true }]);
  // the word sits after the bean/sweetness words and before the options (as the bill reads)
  const withOption: CartItem = { ...plainLine(true), selectedModifiers: [{ modifierId: "m", modifierName: "เพิ่ม", optionId: "o", optionName: "เพิ่มช็อต", priceDelta: 15 }] };
  assert.deepEqual(cartLineParts(withOption, null, false).map((p) => p.text), ["แก้วร้าน", "เพิ่มช็อต (+15)"]);
});

test("a menu served in house glass by default shows แก้วร้าน unbolded", () => {
  assert.deepEqual(cartLineParts(plainLine(), null, true), [{ text: "แก้วร้าน", changed: false }]);
  assert.deepEqual(cartLineParts(plainLine(true), null, true), [{ text: "แก้วร้าน", changed: false }]);
  // the cashier took it off: no word
  assert.deepEqual(cartLineParts(plainLine(false), null, true), []);
});

test("bill words read the snapshot's houseGlass", () => {
  const snap = (packaging?: ChoiceSnapshot["packaging"]): ChoiceSnapshot => ({ slots: [], slotAddGroupIds: [], sweetness: null, ...(packaging ? { packaging } : {}) });
  assert.equal(billLineDetail(snap({ houseGlass: true }), []), "แก้วร้าน");
  assert.equal(billLineDetail(snap({ houseGlass: true }), [{ option: "เพิ่มช็อต", priceDelta: 15 }]), "แก้วร้าน · เพิ่มช็อต (+15)");
  assert.equal(billLineDetail(snap({ setId: "s", name: "แก้วพลาสติก" }), []), null);
  assert.equal(billLineDetail(snap(), []), null);
});

test("toggleHouseGlass stores the key only when it differs from the menu default", () => {
  const off = packagingCatalog(false);
  const on = toggleHouseGlass(plainLine(), off);
  assert.equal(on.houseGlass, true);
  const back = toggleHouseGlass(on, off);
  assert.ok(!("houseGlass" in back), "back to the default deletes the key");
  const dflt = packagingCatalog(true);
  const taken = toggleHouseGlass(plainLine(), dflt);
  assert.equal(taken.houseGlass, false);
  assert.ok(!("houseGlass" in toggleHouseGlass(taken, dflt)));
  assert.equal(on.totalPrice, 160);
  assert.equal(on.cartItemKey, "k");
});

test("houseGlassToggle shows only for a menu with packaging or a house-glass default", () => {
  assert.deepEqual(houseGlassToggle(plainLine(), emptyStockCatalog()), { shown: false, on: false });
  assert.deepEqual(houseGlassToggle(plainLine(), packagingCatalog(false)), { shown: true, on: false });
  assert.deepEqual(houseGlassToggle(plainLine(true), packagingCatalog(false)), { shown: true, on: true });
  assert.deepEqual(houseGlassToggle(plainLine(), packagingCatalog(true)), { shown: true, on: true });
  assert.deepEqual(houseGlassToggle(plainLine(false), packagingCatalog(true)), { shown: true, on: false });
});

// ── stock states on the chips (round D2a) ─────────────────────────────────

const beanLevels = (o: Record<string, number> = {}) =>
  new Map(Object.entries({ light: 5000, med: 5000, dark: 5000, kenya: 5000, ethiopia: 5000, ...o }));

test("window starts on the next house member when the default is out", () => {
  const view = { levels: beanLevels({ med: 0 }), suppressed: new Set<string>() };
  const s = initialWindowState("latte", catalog, [extras], undefined, view);
  assert.equal(s.slots.g_bean, "m_light");
  // the cart shows the starting member like any choice, bold because it is not the menu default
  const line = buildLine({ product: latte, modifiers: [extras], catalog, state: s, note: "", quantity: 1, key: "k" });
  assert.equal(line.choices?.slots[0]?.memberId, "m_light");
  assert.deepEqual(cartLineParts(line, defaultChoices("latte", catalog))[0], { text: "คั่วอ่อน", changed: true });
  // the default chip itself shows "หมด?"
  const rows = optionRows("latte", catalog, view);
  assert.deepEqual(rows.slots[0]!.house.find((c) => c.id === "m_med")!.stock, { kind: "out", materialId: "med" });
  // no stock data, a suppressed default, or a cart line being edited: the window starts as before
  assert.equal(initialWindowState("latte", catalog, [extras]).slots.g_bean, "m_med");
  assert.equal(initialWindowState("latte", catalog, [extras], undefined, { ...view, suppressed: new Set(["med"]) }).slots.g_bean, "m_med");
  const editing = { selectedModifiers: [], choices: defaultChoices("latte", catalog) };
  assert.equal(initialWindowState("latte", catalog, [extras], editing, view).slots.g_bean, "m_med");
  // a menu sold on a special bean keeps it (its chip says "หมด?"): never a cheaper cup by itself
  const noKenya = { levels: beanLevels({ kenya: 0 }), suppressed: new Set<string>() };
  assert.equal(initialWindowState("kenya_default", catalog, [], undefined, noKenya).slots.g_bean, "m_kenya");
});

test("special chip out keeps the menu ok", () => {
  const levels = beanLevels({ kenya: 0, ethiopia: 100 });
  const view = { levels, suppressed: new Set<string>() };
  const bean = optionRows("latte", catalog, view).slots[0]!;
  assert.deepEqual(bean.special.find((c) => c.id === "m_kenya")!.stock, { kind: "out", materialId: "kenya" });
  // 100 g at 18 g a cup
  assert.deepEqual(bean.special.find((c) => c.id === "m_eth")!.stock, { kind: "low", cupsLeft: 5 });
  assert.ok(bean.house.every((c) => c.stock === undefined));
  assert.deepEqual(tileState("latte", catalog, { levels, paused: new Set(), at: 1 }, new Set()), { kind: "ok" });
  // the window still starts on the menu default
  assert.equal(initialWindowState("latte", catalog, [], undefined, view).slots.g_bean, "m_med");
});

test("out chip becomes selectable after the cashier confirms", () => {
  const today = "2026-11-21";
  const levels = beanLevels({ kenya: 0 });
  const before = optionRows("latte", catalog, { levels, suppressed: new Set() }).slots[0]!.special.find((c) => c.id === "m_kenya")!;
  assert.equal(asksFirst(before.stock), true);
  // "ยังมีของ ขายต่อ": this iPad stops asking about kenya, then the chip is picked
  const store = suppressMaterial({}, "kenya", levels.get("kenya")!, today);
  const view = { levels, suppressed: suppressedMaterials(store, levels, today) };
  const after = optionRows("latte", catalog, view).slots[0]!.special.find((c) => c.id === "m_kenya")!;
  assert.equal(after.stock, undefined);
  assert.equal(asksFirst(after.stock), false);
  const picked = tapSpecial(initialWindowState("latte", catalog, [], undefined, view), "g_bean", "m_kenya");
  assert.equal(picked.slots.g_bean, "m_kenya");
});

test("sweetener and option chips show their own stock", () => {
  const c = buildStockCatalog({
    ...rows(),
    amounts: [
      { product_id: null, member_id: "s_syrup", level_id: "lv_normal", amount: 20 },
      { product_id: null, member_id: "s_condensed", level_id: "lv_normal", amount: 30 },
      { product_id: null, member_id: "s_condensed", level_id: "lv_less", amount: 10 },
    ],
    optionEffects: [...rows().optionEffects, { option_id: "o_oat", kind: "material_add", group_id: null, raw_material_id: "mix", amount: 180 }],
  });
  const levels = new Map([["syrup", 5000], ["condensed", 25], ["mix", 100]]);
  const view = { levels, suppressed: new Set<string>() };
  // 25 ml of condensed milk: out at หวานปกติ (30), enough for 2 cups at หวานน้อย (10)
  assert.deepEqual(sweetenerStock("latte", c, "s_condensed", "lv_normal", view), { kind: "out", materialId: "condensed" });
  assert.deepEqual(sweetenerStock("latte", c, "s_condensed", "lv_less", view), { kind: "low", cupsLeft: 2 });
  assert.equal(sweetenerStock("latte", c, "s_syrup", "lv_normal", view), undefined);
  assert.equal(sweetenerStock("latte", c, "s_condensed", "lv_none", view), undefined);
  assert.equal(sweetenerStock("latte", c, "s_condensed", "lv_normal", null), undefined);
  // an option that adds a material: out under one cup; a slot_add option has no stock word of its own
  assert.deepEqual(optionStock("o_oat", c, view), { kind: "out", materialId: "mix" });
  assert.equal(optionStock("o_shot", c, view), undefined);
  assert.equal(optionStock("o_oat", c, { levels, suppressed: new Set(["mix"]) }), undefined);
});
