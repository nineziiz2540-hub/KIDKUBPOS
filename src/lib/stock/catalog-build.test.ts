import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStockCatalog, type StockCatalogRows } from "./catalog-build.ts";
import { emptyStockCatalog, resolveLine } from "./stock-core.ts";

type MemberRow = StockCatalogRows["members"][number];

const empty = (): StockCatalogRows => ({
  materials: [], recipes: [], groups: [], members: [], levels: [], amounts: [], productSweetness: [], optionEffects: [],
});
const mem = (id: string, mat: string, o: Partial<MemberRow> = {}): MemberRow => ({
  id, group_id: "g", raw_material_id: mat, label: id, tier: "house", price_delta: 0, is_default: false, sort_order: 0, ...o,
});
const group = { id: "g", kind: "bean" as const, name: "G", sort_order: 0 };
const fixed = (product: string, mat: string | null, qty: number | string = 1): StockCatalogRows["recipes"][number] => ({
  product_id: product, line_kind: "fixed", raw_material_id: mat, group_id: null, quantity_used: qty, default_member_id: null, allow_special: false,
});

function dropsFor(materials: StockCatalogRows["materials"]) {
  const c = buildStockCatalog({
    ...empty(), materials, groups: [group],
    members: [mem("m_bad", "bad"), mem("m_ok", "ok")],
    recipes: [fixed("p", "bad"), fixed("p", "ok")],
    optionEffects: [
      { option_id: "o", kind: "material_add", group_id: null, raw_material_id: "bad", amount: 5 },
      { option_id: "o", kind: "material_add", group_id: null, raw_material_id: "ok", amount: 5 },
    ],
  });
  assert.deepEqual(c.groups.get("g")!.members.map((m) => m.id), ["m_ok"]);
  assert.deepEqual(c.recipes.get("p"), [{ kind: "fixed", materialId: "ok", qty: 1 }]);
  assert.deepEqual(c.optionEffects.get("o"), [{ kind: "material_add", materialId: "ok", qty: 5 }]);
}

test("archived material: member, fixed line and material_add effect are dropped", () => {
  dropsFor([{ id: "bad", archived_at: "2026-01-01T00:00:00Z" }, { id: "ok", archived_at: null }]);
});

test("unknown material: member, fixed line and material_add effect are dropped", () => {
  dropsFor([{ id: "ok", archived_at: null }]);
});

test("members sorted by sort_order, ties by id", () => {
  const c = buildStockCatalog({
    ...empty(), materials: [{ id: "x", archived_at: null }], groups: [group],
    members: [mem("c", "x", { sort_order: 2 }), mem("b", "x", { sort_order: 1 }), mem("a", "x", { sort_order: 1 }), mem("z", "x", { sort_order: 0 })],
  });
  assert.deepEqual(c.groups.get("g")!.members.map((m) => m.id), ["z", "a", "b", "c"]);
});

test("member of an unknown group is ignored; empty group is kept", () => {
  const c = buildStockCatalog({
    ...empty(), materials: [{ id: "x", archived_at: null }], groups: [group],
    members: [mem("m", "x", { group_id: "nope" })],
  });
  assert.equal(c.groups.size, 1);
  assert.deepEqual(c.groups.get("g")!.members, []);
});

test("standard and product amount tables are separate; use_custom controls custom", () => {
  const ps = (product_id: string, use_custom: boolean) => ({
    product_id, group_id: "g", default_member_id: "m", allowed_member_ids: ["m"], default_level_id: null, use_custom,
  });
  const c = buildStockCatalog({
    ...empty(),
    amounts: [
      { product_id: null, member_id: "m", level_id: "l", amount: 10 },
      { product_id: "p1", member_id: "m", level_id: "l", amount: 99 },
    ],
    productSweetness: [ps("p1", true), ps("p2", false), ps("p3", true)],
  });
  assert.deepEqual([...c.standardSweetness], [["m:l", 10]]);
  assert.deepEqual([...c.productSweetness.get("p1")!.custom!], [["m:l", 99]]);
  assert.equal(c.productSweetness.get("p2")!.custom, null);
  assert.equal(c.productSweetness.get("p3")!.custom!.size, 0);
});

test("numeric strings become numbers", () => {
  const c = buildStockCatalog({
    ...empty(), materials: [{ id: "x", archived_at: null }], groups: [group],
    members: [mem("m", "x", { price_delta: "20.00" })],
    recipes: [fixed("p", "x", "18.000")],
    amounts: [{ product_id: null, member_id: "m", level_id: "l", amount: "10" }],
  });
  assert.equal(c.groups.get("g")!.members[0]?.priceDelta, 20);
  assert.deepEqual(c.recipes.get("p"), [{ kind: "fixed", materialId: "x", qty: 18 }]);
  assert.equal(c.standardSweetness.get("m:l"), 10);
});

test("bad numbers are dropped, zero amount kept", () => {
  const c = buildStockCatalog({
    ...empty(), materials: [{ id: "x", archived_at: null }], groups: [group],
    members: [mem("neg", "x", { price_delta: -1 }), mem("nan", "x", { price_delta: "abc" }), mem("ok", "x")],
    recipes: [fixed("p", "x", 0), fixed("p", "x", "abc"), fixed("p", "x", 2)],
    amounts: [
      { product_id: null, member_id: "m", level_id: "a", amount: -1 },
      { product_id: null, member_id: "m", level_id: "b", amount: 0 },
    ],
    optionEffects: [{ option_id: "o", kind: "material_add", group_id: null, raw_material_id: "x", amount: 0 }],
  });
  assert.deepEqual(c.groups.get("g")!.members.map((m) => m.id), ["ok"]);
  assert.deepEqual(c.recipes.get("p"), [{ kind: "fixed", materialId: "x", qty: 2 }]);
  assert.deepEqual([...c.standardSweetness], [["m:b", 0]]);
  assert.equal(c.optionEffects.has("o"), false);
});

test("wrong-shaped rows are dropped; slot line kept even if group is missing", () => {
  const c = buildStockCatalog({
    ...empty(), materials: [{ id: "x", archived_at: null }],
    recipes: [
      fixed("p", null),
      { product_id: "p", line_kind: "slot", raw_material_id: null, group_id: null, quantity_used: 1, default_member_id: null, allow_special: false },
      { product_id: "p", line_kind: "slot", raw_material_id: null, group_id: "gone", quantity_used: 3, default_member_id: "d", allow_special: true },
    ],
    optionEffects: [
      { option_id: "o", kind: "slot_add", group_id: null, raw_material_id: null, amount: 1 },
      { option_id: "o", kind: "material_add", group_id: "g", raw_material_id: null, amount: 1 },
      { option_id: "o", kind: "slot_add", group_id: "g", raw_material_id: null, amount: 9 },
    ],
  });
  assert.deepEqual(c.recipes.get("p"), [{ kind: "slot", groupId: "gone", qty: 3, defaultMemberId: "d", allowSpecial: true }]);
  assert.deepEqual(c.optionEffects.get("o"), [{ kind: "slot_add", groupId: "g", qty: 9 }]);
});

test("untracked-style usable material is kept (no track_stock filtering)", () => {
  const c = buildStockCatalog({ ...empty(), materials: [{ id: "ice", archived_at: null }], recipes: [fixed("p", "ice", 150)] });
  assert.deepEqual(c.recipes.get("p"), [{ kind: "fixed", materialId: "ice", qty: 150 }]);
});

test("end-to-end with resolveLine: latte", () => {
  const materials = ["light", "med", "dark", "kenya", "milk", "ice", "syrup", "condensed", "mix"].map((n) => ({ id: `mat_${n}`, archived_at: null }));
  const bm = (n: string, o: Partial<MemberRow>) => mem(`m_${n}`, `mat_${n}`, { group_id: "beans", ...o });
  const sm = (n: string, o: Partial<MemberRow>) => mem(`m_${n}`, `mat_${n}`, { group_id: "sweet", ...o });
  const lv = (id: string, o: object) => ({ id, name: id, is_none: false, is_default: false, sort_order: 0, ...o });
  const amt = (l: string, a: number) => ({ product_id: null, member_id: "m_syrup", level_id: l, amount: a });
  const c = buildStockCatalog({
    materials,
    groups: [
      { id: "beans", kind: "bean", name: "เมล็ด", sort_order: 1 },
      { id: "sweet", kind: "sweetener", name: "ความหวาน", sort_order: 2 },
    ],
    members: [
      bm("light", { label: "คั่วอ่อน", sort_order: 1 }),
      bm("med", { label: "คั่วกลาง", sort_order: 2, is_default: true }),
      bm("dark", { label: "คั่วเข้ม", sort_order: 3 }),
      bm("kenya", { label: "Kenya", tier: "special", price_delta: "20.00", sort_order: 4 }),
      sm("syrup", { label: "ไซรัป", is_default: true, sort_order: 1 }),
      sm("condensed", { label: "นมข้น", sort_order: 2 }),
      sm("mix", { label: "นมมิกซ์", sort_order: 3 }),
    ],
    recipes: [
      { product_id: "latte", line_kind: "slot", raw_material_id: null, group_id: "beans", quantity_used: "18.000", default_member_id: "m_med", allow_special: true },
      fixed("latte", "mat_milk", 180),
      fixed("latte", "mat_ice", 150),
    ],
    levels: [
      lv("l_none", { name: "ไม่หวาน", is_none: true, sort_order: 1 }),
      lv("l_less", { name: "หวานน้อย", sort_order: 2 }),
      lv("l_norm", { name: "หวานปกติ", is_default: true, sort_order: 3 }),
      lv("l_more", { name: "หวานมาก", sort_order: 4 }),
    ],
    amounts: [amt("l_none", 0), amt("l_less", 10), amt("l_norm", 20), amt("l_more", 35)],
    productSweetness: [{
      product_id: "latte", group_id: "sweet", default_member_id: "m_syrup",
      allowed_member_ids: ["m_condensed", "m_mix"], default_level_id: null, use_custom: false,
    }],
    optionEffects: [{ option_id: "shot", kind: "slot_add", group_id: "beans", raw_material_id: null, amount: 9 }],
  });

  const base = resolveLine("latte", 1, undefined, [], c);
  assert.ok(!("error" in base));
  assert.deepEqual(Object.fromEntries(base.stock.map((s) => [s.materialId, s.qty])),
    { mat_med: 18, mat_milk: 180, mat_ice: 150, mat_syrup: 20 });

  const kenya = resolveLine("latte", 1, { slots: [{ groupId: "beans", memberId: "m_kenya" }] }, ["shot"], c);
  assert.ok(!("error" in kenya));
  // the extra shot on a special cup uses the menu's house bean and adds no specialty price
  assert.equal(kenya.stock.find((s) => s.materialId === "mat_kenya")?.qty, 18);
  assert.equal(kenya.stock.find((s) => s.materialId === "mat_med")?.qty, 9);
  assert.equal(kenya.priceDeltaSatang, 2000);
});

test("empty input equals emptyStockCatalog()", () => {
  assert.deepEqual(buildStockCatalog(empty()), emptyStockCatalog());
});
