import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PREVIEW_INCOMPLETE,
  costPreviewText,
  draftCatalogRows,
  menuCostPreview,
  type CostPreviewInput,
} from "./menu-cost-preview.ts";
import { buildStockCatalog } from "./catalog-build.ts";
import { resolveLine } from "./stock-core.ts";
import { effectPayload, parseEffectDrafts } from "./option-effects.ts";
import type { MenuDraft } from "../menu-draft.ts";

// The brief's ลาเต้: beans 18 g (bean group, house default), milk 180 ml, ice 150 g, sweetness syrup by
// default with condensed milk + milk mix allowed. Costs: คั่วกลาง 0.6 ฿/g, เคนยา 1.5 ฿/g, milk 0.05 ฿/ml,
// ice 0.01 ฿/g, syrup 0.1 ฿/ml. Shop table for syrup: 0 / 10 / 20 / 35 ml.
const levels = [
  { id: "l0", name: "ไม่หวาน", isNone: true, isDefault: false },
  { id: "l1", name: "หวานน้อย", isNone: false, isDefault: false },
  { id: "l2", name: "หวานปกติ", isNone: false, isDefault: true },
  { id: "l3", name: "หวานมาก", isNone: false, isDefault: false },
];
const groups: CostPreviewInput["groups"] = [
  {
    id: "g-bean", kind: "bean", name: "เมล็ด",
    members: [
      { id: "m-house", materialId: "bean-house", label: "คั่วกลาง", tier: "house", priceDelta: 0, isDefault: true },
      { id: "m-kenya", materialId: "bean-kenya", label: "เคนยา", tier: "special", priceDelta: 20, isDefault: false },
    ],
  },
  {
    id: "g-sweet", kind: "sweetener", name: "ความหวาน",
    members: [
      { id: "s-syrup", materialId: "syrup", label: "ไซรัป", tier: "house", priceDelta: 0, isDefault: true },
      { id: "s-cond", materialId: "cond", label: "นมข้น", tier: "house", priceDelta: 0, isDefault: false },
      { id: "s-mix", materialId: "mix", label: "นมมิกซ์", tier: "house", priceDelta: 0, isDefault: false },
    ],
  },
];
const materials: CostPreviewInput["materials"] = [
  { id: "bean-house", name: "คั่วกลาง", unit: "g", costPerUnit: 0.6, archived: false },
  { id: "bean-kenya", name: "เคนยา", unit: "g", costPerUnit: 1.5, archived: false },
  { id: "milk", name: "นมสด", unit: "ml", costPerUnit: 0.05, archived: false },
  { id: "ice", name: "น้ำแข็ง", unit: "g", costPerUnit: 0.01, archived: false },
  { id: "syrup", name: "ไซรัป", unit: "ml", costPerUnit: 0.1, archived: false },
  { id: "cond", name: "นมข้น", unit: "ml", costPerUnit: 0.08, archived: false },
  { id: "mix", name: "นมมิกซ์", unit: "ml", costPerUnit: 0.07, archived: false },
  { id: "old", name: "ไซรัปเก่า", unit: "ml", costPerUnit: 0.2, archived: true },
];
const standardAmounts = [
  { member_id: "s-syrup", level_id: "l0", amount: 0 },
  { member_id: "s-syrup", level_id: "l1", amount: 10 },
  { member_id: "s-syrup", level_id: "l2", amount: 20 },
  { member_id: "s-syrup", level_id: "l3", amount: 35 },
  // condensed milk and milk mix (allowed on the latte) have their own standard amounts
  ...["s-cond", "s-mix"].flatMap((m) => [
    { member_id: m, level_id: "l0", amount: 0 },
    { member_id: m, level_id: "l1", amount: 15 },
    { member_id: m, level_id: "l2", amount: 25 },
    { member_id: m, level_id: "l3", amount: 40 },
  ]),
];
const latte = (): Pick<MenuDraft, "recipes" | "sweetness"> => ({
  recipes: [
    { kind: "slot", groupId: "g-bean", quantityUsed: "18", defaultMemberId: null, allowSpecial: true },
    { kind: "fixed", rawMaterialId: "milk", quantityUsed: "180" },
    { kind: "fixed", rawMaterialId: "ice", quantityUsed: "150" },
  ],
  sweetness: {
    groupId: "g-sweet", defaultMemberId: "s-syrup", allowedMemberIds: ["s-cond", "s-mix"],
    defaultLevelId: null, useCustom: false, custom: {},
  },
});
const input = (draft = latte()): CostPreviewInput => ({ draft, groups, levels, standardAmounts, materials });

test("ลาเต้: one cost per sweetness level, in level order, with the level names", () => {
  const p = menuCostPreview(input());
  // 18 g × 0.6 + 180 × 0.05 + 150 × 0.01 = 10.80 + 9.00 + 1.50 = 21.30; syrup 0 / 1.00 / 2.00 / 3.50
  assert.deepEqual(p.cups, [
    { levelId: "l0", levelName: "ไม่หวาน", costSatang: 2130 },
    { levelId: "l1", levelName: "หวานน้อย", costSatang: 2230 },
    { levelId: "l2", levelName: "หวานปกติ", costSatang: 2330 },
    { levelId: "l3", levelName: "หวานมาก", costSatang: 2480 },
  ]);
  assert.deepEqual(p.missingMaterials, []);
  assert.equal(p.incomplete, false);
  assert.equal(costPreviewText(p), "ต้นทุนต่อแก้ว: ไม่หวาน ฿21.30 · หวานน้อย ฿22.30 · หวานปกติ ฿23.30 · หวานมาก ฿24.80");
});

test("incomplete: a sweetener of the menu with no amount at a level", () => {
  assert.equal(PREVIEW_INCOMPLETE, "บางรายการยังไม่มีปริมาณ/ตัวเลือก — ต้นทุนอาจต่ำกว่าจริง");
  // the default sweetener misses หวานมาก in the shop table
  const noHigh = standardAmounts.filter((a) => !(a.member_id === "s-syrup" && a.level_id === "l3"));
  assert.equal(menuCostPreview({ ...input(), standardAmounts: noHigh }).incomplete, true);
  // an allowed sweetener (milk mix) has no amounts at all
  const noMix = standardAmounts.filter((a) => a.member_id !== "s-mix");
  assert.equal(menuCostPreview({ ...input(), standardAmounts: noMix }).incomplete, true);
  // a missing ไม่หวาน cell is not a gap (ไม่หวาน never deducts)
  const noNone = standardAmounts.filter((a) => a.level_id !== "l0");
  assert.equal(menuCostPreview({ ...input(), standardAmounts: noNone }).incomplete, false);
  // the menu's own table replaces the shop's: a blank / unreadable cell there is a gap
  const d = latte();
  d.sweetness = {
    ...d.sweetness!, allowedMemberIds: [], useCustom: true,
    custom: { "s-syrup:l0": "0", "s-syrup:l1": "12", "s-syrup:l2": "", "s-syrup:l3": "32.5" },
  };
  assert.equal(menuCostPreview(input(d)).incomplete, true);
  d.sweetness.custom["s-syrup:l2"] = "22";
  assert.equal(menuCostPreview(input(d)).incomplete, false);
  // an explicit 0 is the owner's choice, not a gap
  d.sweetness.custom["s-syrup:l2"] = "0";
  assert.equal(menuCostPreview(input(d)).incomplete, false);
});

test("incomplete: sweetness with no levels, or a default sweetener the till cannot use", () => {
  assert.equal(menuCostPreview({ ...input(), levels: [] }).incomplete, true);
  const syrupGone = materials.map((m) => (m.id === "syrup" ? { ...m, archived: true } : m));
  assert.equal(menuCostPreview({ ...input(), materials: syrupGone }).incomplete, true);
  // an allowed sweetener whose material is archived is never offered: not a gap
  const mixGone = materials.map((m) => (m.id === "mix" ? { ...m, archived: true } : m));
  const noMix = standardAmounts.filter((a) => a.member_id !== "s-mix");
  assert.equal(menuCostPreview({ ...input(), materials: mixGone, standardAmounts: noMix }).incomplete, false);
});

test("incomplete: a bean/matcha line whose group has no member it can use", () => {
  // every member of the bean group archived
  const beansGone = materials.map((m) => (m.id.startsWith("bean-") ? { ...m, archived: true } : m));
  assert.equal(menuCostPreview({ ...input(), materials: beansGone }).incomplete, true);
  // only specials left and the line does not allow them
  const houseGone = materials.map((m) => (m.id === "bean-house" ? { ...m, archived: true } : m));
  const d = latte();
  d.recipes[0] = { kind: "slot", groupId: "g-bean", quantityUsed: "18", defaultMemberId: null, allowSpecial: false };
  assert.equal(menuCostPreview({ ...input(d), materials: houseGone }).incomplete, true);
  // specials allowed but nothing to default to (no house member, no flagged default): the till skips it too
  d.recipes[0] = { ...d.recipes[0], allowSpecial: true };
  assert.equal(menuCostPreview({ ...input(d), materials: houseGone }).incomplete, true);
  // the menu's own default (a special, allowed) gives the till a member again
  d.recipes[0] = { kind: "slot", groupId: "g-bean", quantityUsed: "18", defaultMemberId: "m-kenya", allowSpecial: true };
  assert.equal(menuCostPreview({ ...input(d), materials: houseGone }).incomplete, false);
  // a group the editor does not know (e.g. it failed to load)
  d.recipes[0] = { kind: "slot", groupId: "g-unknown", quantityUsed: "18", defaultMemberId: null, allowSpecial: true };
  assert.equal(menuCostPreview(input(d)).incomplete, true);
  // an unfinished line (no group yet) is not counted at all
  d.recipes[0] = { kind: "slot", groupId: "", quantityUsed: "18", defaultMemberId: null, allowSpecial: true };
  assert.equal(menuCostPreview(input(d)).incomplete, false);
});

test("ใช้ปริมาณเฉพาะเมนูนี้ replaces the shop table for this menu", () => {
  const d = latte();
  d.sweetness = {
    ...d.sweetness!, useCustom: true,
    custom: { "s-syrup:l0": "0", "s-syrup:l1": "12", "s-syrup:l2": "22", "s-syrup:l3": "32.5" },
  };
  const p = menuCostPreview(input(d));
  // syrup 0 / 1.20 / 2.20 / 3.25
  assert.deepEqual(p.cups.map((c) => c.costSatang), [2130, 2250, 2350, 2455]);
});

test("the menu's own default bean is the one priced (unless specials are off)", () => {
  const d = latte();
  d.recipes[0] = { kind: "slot", groupId: "g-bean", quantityUsed: "18", defaultMemberId: "m-kenya", allowSpecial: true };
  // Kenya 18 × 1.5 = 27.00 → 27 + 9 + 1.5 = 37.50 at ไม่หวาน
  assert.equal(menuCostPreview(input(d)).cups[0]!.costSatang, 3750);
  // specials not allowed: the menu's special default is skipped → house bean again
  d.recipes[0] = { kind: "slot", groupId: "g-bean", quantityUsed: "18", defaultMemberId: "m-kenya", allowSpecial: false };
  assert.equal(menuCostPreview(input(d)).cups[0]!.costSatang, 2130);
});

test("without sweetness: a single number", () => {
  const d = latte();
  d.sweetness = null;
  const p = menuCostPreview(input(d));
  assert.deepEqual(p.cups, [{ levelId: null, levelName: null, costSatang: 2130 }]);
  assert.equal(costPreviewText(p), "ต้นทุนต่อแก้ว: ฿21.30");
});

test("unfinished lines and archived materials drop out; a material with no cost is named", () => {
  const d = latte();
  d.sweetness = null;
  d.recipes.push({ kind: "fixed", rawMaterialId: "", quantityUsed: "" });
  d.recipes.push({ kind: "fixed", rawMaterialId: "milk-x", quantityUsed: "abc" });
  d.recipes.push({ kind: "fixed", rawMaterialId: "old", quantityUsed: "10" }); // archived: the till skips it too
  d.recipes.push({ kind: "slot", groupId: "", quantityUsed: "3", defaultMemberId: null, allowSpecial: true });
  assert.equal(menuCostPreview(input(d)).cups[0]!.costSatang, 2130);

  const free = materials.map((m) => (m.id === "ice" ? { ...m, costPerUnit: 0 } : m));
  const p = menuCostPreview({ ...input(latte()), materials: free });
  assert.equal(p.cups[0]!.costSatang, 1980);
  assert.deepEqual(p.missingMaterials, ["น้ำแข็ง"]);
});

test("draft rows: the sweetness row and the own table follow the draft", () => {
  const d = latte();
  d.sweetness = { ...d.sweetness!, useCustom: true, custom: { "s-syrup:l1": "12", "s-syrup:l2": "x" } };
  const rows = draftCatalogRows(input(d));
  assert.equal(rows.productSweetness.length, 1);
  assert.equal(rows.productSweetness[0]!.use_custom, true);
  assert.deepEqual(rows.amounts.filter((a) => a.product_id !== null).map((a) => [a.member_id, a.level_id, a.amount]), [["s-syrup", "l1", 12]]);
});

test("เพิ่มช็อต (+9 g in the bean group) adds to whichever bean the cup uses", () => {
  const parsed = parseEffectDrafts([{ kind: "slot_add", targetId: "g-bean", amount: "9" }]);
  assert.ok("value" in parsed);
  const rows = draftCatalogRows(input());
  rows.optionEffects = effectPayload(parsed.value).map((e) => ({ option_id: "opt-shot", ...e }));
  const catalog = buildStockCatalog(rows);
  const house = resolveLine("__draft__", 1, undefined, ["opt-shot"], catalog);
  assert.ok(!("error" in house));
  assert.equal(house.stock.find((l) => l.materialId === "bean-house")!.qty, 27);
  const kenya = resolveLine("__draft__", 2, { slots: [{ groupId: "g-bean", memberId: "m-kenya" }] }, ["opt-shot"], catalog);
  assert.ok(!("error" in kenya));
  assert.equal(kenya.stock.find((l) => l.materialId === "bean-kenya")!.qty, 54); // (18 + 9) × 2 cups
  assert.equal(kenya.stock.some((l) => l.materialId === "bean-house"), false);
  assert.equal(kenya.priceDeltaSatang, 4000); // specialty +20 once for the cup and once for the extra shot
});
