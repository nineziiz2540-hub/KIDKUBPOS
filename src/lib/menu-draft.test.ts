import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DUPLICATE_SLOT_GROUP,
  comparableDraft,
  fillSweetnessGrid,
  menuDraftFromRows,
  menuSavePayload,
  parseMenuDraft,
  type MenuDraft,
  type MenuRows,
  type MenuValue,
} from "./menu-draft.ts";

// ── fixtures: ลาเต้ = beans 18 g (house default, no specials), milk 180, ice 150, syrup by default,
// condensed milk + milk mix allowed, its own table ─────────────────────────────────────────────────
const ids = {
  bean: "g-bean", matcha: "g-matcha", sweet: "g-sweet",
  house: "m-house", syrup: "s-syrup", cond: "s-cond", mix: "s-mix",
  milk: "mat-milk", ice: "mat-ice", oldSyrup: "mat-archived",
  none: "l-none", low: "l-low", normal: "l-normal", high: "l-high",
};

function latteRows(): MenuRows {
  return {
    product: { name: "ลาเต้", price: "55", description: null, category_id: "cat-1", drink_type: "iced", is_active: true },
    recipes: [
      { line_kind: "fixed", raw_material_id: ids.ice, group_id: null, quantity_used: "150", default_member_id: null, allow_special: true },
      { line_kind: "slot", raw_material_id: null, group_id: ids.bean, quantity_used: "18.000", default_member_id: ids.house, allow_special: false },
      { line_kind: "fixed", raw_material_id: ids.milk, group_id: null, quantity_used: 180, default_member_id: null, allow_special: true },
    ],
    modifierIds: ["mod-extra"],
    sweetness: {
      group_id: ids.sweet, default_member_id: ids.syrup, allowed_member_ids: [ids.mix, ids.cond],
      default_level_id: ids.low, use_custom: true,
    },
    customAmounts: [
      { member_id: ids.syrup, level_id: ids.none, amount: 0 },
      { member_id: ids.syrup, level_id: ids.low, amount: "12.000" },
      { member_id: ids.cond, level_id: ids.none, amount: 0 },
      { member_id: ids.cond, level_id: ids.low, amount: 15 },
      { member_id: ids.mix, level_id: ids.none, amount: 0 },
      { member_id: ids.mix, level_id: ids.low, amount: 15 },
    ],
    materialOrder: [ids.oldSyrup, ids.ice, ids.milk], // by name; archived ones included
    groupOrder: [ids.bean, ids.matcha, ids.sweet],
  };
}

const LEVELS = [
  { id: ids.none, isNone: true },
  { id: ids.low, isNone: false },
];

/** What save_menu + replace_product_recipes store for a payload (migration 20261118170000). */
function storeLikeDb(prev: MenuRows, payload: ReturnType<typeof menuSavePayload>): MenuRows {
  const fixedByMaterial = new Map<string, MenuRows["recipes"][number]>();
  const slots: MenuRows["recipes"] = [];
  for (const r of payload.p_recipes) {
    const kind = (r.line_kind as string | undefined) ?? "fixed";
    if (kind === "fixed") {
      // duplicates collapse to the last occurrence
      fixedByMaterial.set(r.raw_material_id as string, {
        line_kind: "fixed", raw_material_id: r.raw_material_id as string, group_id: null,
        quantity_used: r.quantity_used as number, default_member_id: null, allow_special: true,
      });
    } else {
      slots.push({
        line_kind: "slot", raw_material_id: null, group_id: r.group_id as string, quantity_used: r.quantity_used as number,
        default_member_id: (r.default_member_id as string | null) ?? null, allow_special: (r.allow_special as boolean | undefined) ?? true,
      });
    }
  }
  const m = payload.p_menu;
  let sweetness = prev.sweetness;
  let customAmounts = prev.customAmounts;
  if ("sweetness" in m) {
    const s = m.sweetness as null | {
      group_id: string; default_member_id: string; allowed_member_ids: string[]; default_level_id: string | null;
      use_custom: boolean; custom: { member_id: string; level_id: string; amount: number }[];
    };
    sweetness = s && {
      group_id: s.group_id, default_member_id: s.default_member_id,
      allowed_member_ids: [...new Set(s.allowed_member_ids)].sort(), // array_agg(distinct …)
      default_level_id: s.default_level_id, use_custom: s.use_custom,
    };
    customAmounts = s
      ? s.custom.map((c) => ({ ...c, amount: LEVELS.find((l) => l.id === c.level_id)?.isNone ? 0 : c.amount }))
      : [];
  }
  return {
    ...prev,
    product: {
      name: m.name as string, price: m.price as number, description: m.description as string | null,
      category_id: m.category_id as string | null, drink_type: m.drink_type as string | null, is_active: m.is_active as boolean,
    },
    recipes: [...[...fixedByMaterial.values()].reverse(), ...slots], // row order from the DB is not meaningful
    modifierIds: payload.p_modifier_ids,
    sweetness,
    customAmounts,
  };
}

function parsed(d: MenuDraft): MenuValue {
  const r = parseMenuDraft(d);
  assert.ok("value" in r, "error" in r ? r.error : "");
  return r.value;
}

// ── rows → draft ─────────────────────────────────────────────────────────────────────────────────

test("menuDraftFromRows loads slot lines first (group order), then fixed lines by material name", () => {
  const d = menuDraftFromRows(latteRows());
  assert.deepEqual(d.recipes, [
    { kind: "slot", groupId: ids.bean, quantityUsed: "18", defaultMemberId: ids.house, allowSpecial: false },
    { kind: "fixed", rawMaterialId: ids.ice, quantityUsed: "150" },
    { kind: "fixed", rawMaterialId: ids.milk, quantityUsed: "180" },
  ]);
  assert.equal(d.price, "55");
  assert.equal(d.description, "");
  assert.deepEqual(d.modifierIds, ["mod-extra"]);
});

test("menuDraftFromRows loads the sweetness and the menu's own table", () => {
  const d = menuDraftFromRows(latteRows());
  assert.deepEqual(d.sweetness, {
    groupId: ids.sweet, defaultMemberId: ids.syrup, allowedMemberIds: [ids.cond, ids.mix],
    defaultLevelId: ids.low, useCustom: true,
    custom: {
      [`${ids.syrup}:${ids.none}`]: "0", [`${ids.syrup}:${ids.low}`]: "12",
      [`${ids.cond}:${ids.none}`]: "0", [`${ids.cond}:${ids.low}`]: "15",
      [`${ids.mix}:${ids.none}`]: "0", [`${ids.mix}:${ids.low}`]: "15",
    },
  });
  assert.equal(menuDraftFromRows({ ...latteRows(), sweetness: null }).sweetness, null);
});

test("a line whose material was archived is still loaded (and saved again)", () => {
  const rows = latteRows();
  rows.recipes.push({ line_kind: "fixed", raw_material_id: ids.oldSyrup, group_id: null, quantity_used: 5, default_member_id: null, allow_special: true });
  const d = menuDraftFromRows(rows);
  assert.deepEqual(d.recipes[1], { kind: "fixed", rawMaterialId: ids.oldSyrup, quantityUsed: "5" });
  const p = menuSavePayload(parsed(d));
  assert.ok(p.p_recipes.some((r) => r.raw_material_id === ids.oldSyrup && r.quantity_used === 5));
});

// ── draft → payload ──────────────────────────────────────────────────────────────────────────────

test("menuSavePayload follows the save_menu JSON contract", () => {
  const p = menuSavePayload(parsed(menuDraftFromRows(latteRows())));
  assert.deepEqual(p.p_recipes, [
    { line_kind: "slot", group_id: ids.bean, quantity_used: 18, default_member_id: ids.house, allow_special: false },
    { line_kind: "fixed", raw_material_id: ids.ice, quantity_used: 150 },
    { line_kind: "fixed", raw_material_id: ids.milk, quantity_used: 180 },
  ]);
  assert.deepEqual(p.p_menu, {
    name: "ลาเต้", price: 55, description: null, category_id: "cat-1", drink_type: "iced", is_active: true,
    sweetness: {
      group_id: ids.sweet, default_member_id: ids.syrup, allowed_member_ids: [ids.cond, ids.mix],
      default_level_id: ids.low, use_custom: true,
      custom: [
        { member_id: ids.syrup, level_id: ids.low, amount: 12 }, { member_id: ids.syrup, level_id: ids.none, amount: 0 },
        { member_id: ids.cond, level_id: ids.low, amount: 15 }, { member_id: ids.cond, level_id: ids.none, amount: 0 },
        { member_id: ids.mix, level_id: ids.low, amount: 15 }, { member_id: ids.mix, level_id: ids.none, amount: 0 },
      ],
    },
  });
  assert.deepEqual(p.p_modifier_ids, ["mod-extra"]);
});

test("editing an unrelated field keeps every slot line and the sweetness", () => {
  const d = menuDraftFromRows(latteRows());
  const renamed: MenuDraft = { ...d, name: "ลาเต้เย็น", price: "60", isActive: false };
  const before = menuSavePayload(parsed(d));
  const after = menuSavePayload(parsed(renamed));
  assert.deepEqual(after.p_recipes, before.p_recipes);
  assert.deepEqual(after.p_menu.sweetness, before.p_menu.sweetness);
  assert.equal(after.p_menu.name, "ลาเต้เย็น");
});

test("round trip: saved rows → draft → payload → stored rows → the same draft", () => {
  const rows = latteRows();
  const d1 = menuDraftFromRows(rows);
  const stored = storeLikeDb(rows, menuSavePayload(parsed(d1)));
  const d2 = menuDraftFromRows(stored);
  assert.deepEqual(d2, d1);
  // and once more after an unrelated edit
  const stored2 = storeLikeDb(stored, menuSavePayload(parsed({ ...d2, description: "นมสดแท้" })));
  assert.deepEqual(menuDraftFromRows(stored2), { ...d1, description: "นมสดแท้" });
});

test("sweetness: absent = no key (left as it is), null = removed", () => {
  const d = menuDraftFromRows(latteRows());
  const absent: MenuDraft = { ...d };
  delete absent.sweetness;
  const pAbsent = menuSavePayload(parsed(absent));
  assert.equal("sweetness" in pAbsent.p_menu, false);
  const pNull = menuSavePayload(parsed({ ...d, sweetness: null }));
  assert.equal(pNull.p_menu.sweetness, null);
  // the DB simulation: absent keeps the stored sweetness, null clears it and its own amounts
  assert.deepEqual(storeLikeDb(latteRows(), pAbsent).sweetness, latteRows().sweetness);
  const cleared = storeLikeDb(latteRows(), pNull);
  assert.equal(cleared.sweetness, null);
  assert.deepEqual(cleared.customAmounts, []);
});

test("a pre-D1 line without a kind is a fixed line", () => {
  const d = { ...menuDraftFromRows(latteRows()), recipes: [{ rawMaterialId: ids.milk, quantityUsed: "200" }] } as unknown as MenuDraft;
  assert.deepEqual(menuSavePayload(parsed(d)).p_recipes, [{ line_kind: "fixed", raw_material_id: ids.milk, quantity_used: 200 }]);
});

test("the own table is only sent while ใช้ปริมาณเฉพาะเมนูนี้ is on", () => {
  const d = menuDraftFromRows(latteRows());
  const off = parsed({ ...d, sweetness: { ...d.sweetness!, useCustom: false } });
  assert.deepEqual(off.sweetness?.custom, []);
  assert.equal(off.sweetness?.useCustom, false);
});

// ── validation ───────────────────────────────────────────────────────────────────────────────────

const base = (): MenuDraft => ({ ...menuDraftFromRows(latteRows()), sweetness: null });
const err = (d: MenuDraft) => {
  const r = parseMenuDraft(d);
  return "error" in r ? r.error : null;
};

test("a second slot line for the same group is refused", () => {
  const d = base();
  d.recipes = [...d.recipes, { kind: "slot", groupId: ids.bean, quantityUsed: "9", defaultMemberId: null, allowSpecial: true }];
  assert.equal(err(d), DUPLICATE_SLOT_GROUP);
  assert.equal(DUPLICATE_SLOT_GROUP, "เมนูนี้มีช่องเมล็ด/มัทฉะกลุ่มนี้แล้ว");
});

test("two slot lines for different groups (dirty matcha) are both kept", () => {
  const d = base();
  d.recipes = [...d.recipes, { kind: "slot", groupId: ids.matcha, quantityUsed: "3", defaultMemberId: null, allowSpecial: true }];
  const p = menuSavePayload(parsed(d));
  assert.equal(p.p_recipes.filter((r) => r.line_kind === "slot").length, 2);
});

test("the same material twice is refused instead of silently merged", () => {
  const d = base();
  d.recipes = [...d.recipes, { kind: "fixed", rawMaterialId: ids.milk, quantityUsed: "20" }];
  assert.match(err(d) ?? "", /ใส่ซ้ำไม่ได้/);
});

test("blank rows are dropped; half-filled rows are refused", () => {
  const d = base();
  d.recipes = [
    ...d.recipes,
    { kind: "fixed", rawMaterialId: "", quantityUsed: "" },
    { kind: "slot", groupId: "", quantityUsed: "  ", defaultMemberId: null, allowSpecial: true },
  ];
  assert.equal(menuSavePayload(parsed(d)).p_recipes.length, 3);
  assert.equal(err({ ...d, recipes: [{ kind: "fixed", rawMaterialId: ids.milk, quantityUsed: "" }] }), "กรอกสูตรให้ครบทุกบรรทัด หรือลบบรรทัดที่ไม่ใช้");
  assert.equal(err({ ...d, recipes: [{ kind: "slot", groupId: "", quantityUsed: "18", defaultMemberId: null, allowSpecial: true }] }), "กรอกสูตรให้ครบทุกบรรทัด หรือลบบรรทัดที่ไม่ใช้");
});

test("slot quantities follow the fixed-line rules (> 0, ≤ 100,000, 3 decimals)", () => {
  for (const q of ["0", "100001", "1.2345", "abc", "-1"]) {
    const d = base();
    d.recipes = [{ kind: "slot", groupId: ids.bean, quantityUsed: q, defaultMemberId: null, allowSpecial: true }];
    assert.equal(err(d), "ปริมาณวัตถุดิบไม่ถูกต้อง", q);
  }
  const ok = base();
  ok.recipes = [{ kind: "slot", groupId: ids.bean, quantityUsed: "18.125", defaultMemberId: null, allowSpecial: true }];
  assert.equal(err(ok), null);
});

test("an unknown line kind or a non-boolean allowSpecial is refused", () => {
  const d = base();
  d.recipes = [{ kind: "sweet", groupId: ids.bean, quantityUsed: "1" } as unknown as MenuDraft["recipes"][number]];
  assert.equal(err(d), "ข้อมูลไม่ถูกต้อง กรุณารีเฟรชหน้า");
  d.recipes = [{ kind: "slot", groupId: ids.bean, quantityUsed: "1", defaultMemberId: null, allowSpecial: "yes" } as unknown as MenuDraft["recipes"][number]];
  assert.equal(err(d), "ข้อมูลไม่ถูกต้อง กรุณารีเฟรชหน้า");
});

test("sweetness needs a default sweetener; the default is never in the allowed list", () => {
  const d = menuDraftFromRows(latteRows());
  assert.equal(err({ ...d, sweetness: { ...d.sweetness!, defaultMemberId: "" } }), "เลือกชนิดความหวานเริ่มต้นของเมนูนี้");
  const v = parsed({ ...d, sweetness: { ...d.sweetness!, allowedMemberIds: [ids.syrup, ids.cond, ids.cond], useCustom: false } });
  assert.deepEqual(v.sweetness?.allowedMemberIds, [ids.cond]);
});

test("the own table must have every sweetener at every level, each a valid amount", () => {
  const d = menuDraftFromRows(latteRows());
  const custom = { ...d.sweetness!.custom };
  delete custom[`${ids.mix}:${ids.low}`];
  assert.equal(err({ ...d, sweetness: { ...d.sweetness!, custom } }), "ปริมาณเฉพาะเมนูนี้: ใส่ปริมาณให้ครบทุกช่อง");
  const bad = { ...d.sweetness!.custom, [`${ids.mix}:${ids.low}`]: "10001" };
  assert.equal(err({ ...d, sweetness: { ...d.sweetness!, custom: bad } }), "ปริมาณเฉพาะเมนูนี้: ปริมาณต้องอยู่ระหว่าง 0 ถึง 10,000");
  const blank = { ...d.sweetness!.custom, [`${ids.mix}:${ids.low}`]: " " };
  assert.equal(err({ ...d, sweetness: { ...d.sweetness!, custom: blank } }), "ปริมาณเฉพาะเมนูนี้: ใส่ปริมาณให้ครบทุกช่อง");
  assert.equal(err({ ...d, sweetness: { ...d.sweetness!, custom: {} } }), "ปริมาณเฉพาะเมนูนี้: ใส่ปริมาณให้ครบทุกช่อง");
  // cells of a sweetener the menu no longer uses are left out, not an error
  const extra = { ...d.sweetness!.custom, [`s-gone:${ids.low}`]: "9" };
  const v = parsed({ ...d, sweetness: { ...d.sweetness!, custom: extra } });
  assert.equal(v.sweetness?.custom.some((c) => c.memberId === "s-gone"), false);
});

test("menu fields still follow the old rules", () => {
  assert.equal(err({ ...base(), name: " " }), "ชื่อเมนูต้องมี 1–100 ตัวอักษร");
  assert.match(err({ ...base(), price: "12.345" }) ?? "", /ราคาต้องอยู่ระหว่าง/);
});

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

test("fillSweetnessGrid fills missing cells: ไม่หวาน 0, others from the shop table, typed cells stay", () => {
  const g = fillSweetnessGrid(
    { [`${ids.syrup}:${ids.low}`]: "12" },
    [ids.syrup, ids.cond],
    [{ id: ids.none, isNone: true }, { id: ids.low, isNone: false }, { id: ids.high, isNone: false }],
    [{ member_id: ids.cond, level_id: ids.low, amount: 15 }, { member_id: ids.syrup, level_id: ids.low, amount: 10 }]
  );
  assert.deepEqual(g, {
    [`${ids.syrup}:${ids.low}`]: "12",
    [`${ids.syrup}:${ids.none}`]: "0",
    [`${ids.syrup}:${ids.high}`]: "",
    [`${ids.cond}:${ids.none}`]: "0",
    [`${ids.cond}:${ids.low}`]: "15",
    [`${ids.cond}:${ids.high}`]: "",
  });
});

test("comparableDraft: set order and an unused own table are not changes; a real edit is", () => {
  const d = menuDraftFromRows(latteRows());
  const reordered: MenuDraft = {
    ...d,
    modifierIds: [...d.modifierIds].reverse(),
    sweetness: { ...d.sweetness!, allowedMemberIds: [...d.sweetness!.allowedMemberIds].reverse() },
  };
  assert.equal(comparableDraft(reordered), comparableDraft(d));
  const off = { ...d, sweetness: { ...d.sweetness!, useCustom: false } };
  assert.equal(comparableDraft({ ...off, sweetness: { ...off.sweetness, custom: {} } }), comparableDraft(off));
  assert.notEqual(comparableDraft(off), comparableDraft(d));
  assert.notEqual(comparableDraft({ ...d, recipes: d.recipes.slice(1) }), comparableDraft(d));
});
