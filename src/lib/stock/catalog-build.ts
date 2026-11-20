// Pure mapping from plain database rows to the stock catalog (round D1, ruling R14). No I/O, no
// Next.js/Supabase/React imports, and no cost columns: the same function builds the catalog on the
// server and in the POS (from page props), and Staff must never receive costs.
import {
  emptyStockCatalog,
  type AmountTable, type ChoiceGroup, type GroupMember, type OptionEffect, type ProductSweetness,
  type RecipeLine, type StockCatalog, type SweetnessLevel,
} from "./stock-core.ts";

type Num = number | string; // PostgREST may return numeric as a string

export type StockCatalogRows = {
  /** every material of the tenant (archived ones included, so references to them can be dropped) */
  materials: { id: string; archived_at: string | null }[];
  /** product_recipes */
  recipes: {
    product_id: string; line_kind: "fixed" | "slot"; raw_material_id: string | null; group_id: string | null;
    quantity_used: Num; default_member_id: string | null; allow_special: boolean;
  }[];
  /** choice_groups */
  groups: { id: string; kind: "bean" | "matcha" | "sweetener" | "other"; name: string; sort_order: number }[];
  /** choice_group_members */
  members: {
    id: string; group_id: string; raw_material_id: string; label: string; tier: "house" | "special";
    price_delta: Num; is_default: boolean; sort_order: number;
  }[];
  /** sweetness_levels */
  levels: { id: string; name: string; is_none: boolean; is_default: boolean; sort_order: number }[];
  /** sweetness_amounts — product_id null = the shop's standard table */
  amounts: { product_id: string | null; member_id: string; level_id: string; amount: Num }[];
  /** product_sweetness */
  productSweetness: {
    product_id: string; group_id: string; default_member_id: string; allowed_member_ids: string[];
    default_level_id: string | null; use_custom: boolean;
  }[];
  /** modifier_option_effects */
  optionEffects: { option_id: string; kind: "slot_add" | "material_add"; group_id: string | null; raw_material_id: string | null; amount: Num }[];
  /** products (packaging_set_id, house_glass_default) */
  productPackaging: { product_id: string; packaging_set_id: string | null; house_glass_default: boolean }[];
  /** packaging_sets, non-archived */
  packagingSets: { id: string; name: string }[];
  /** packaging_set_items */
  packagingItems: { set_id: string; raw_material_id: string; qty: Num }[];
};

/** A finite number >= min, else null. */
function num(value: Num, min: { atLeast: number } | { above: number }): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if ("atLeast" in min ? n < min.atLeast : n <= min.above) return null;
  return n;
}

function push<T>(map: Map<string, T[]>, key: string, item: T) {
  const list = map.get(key);
  if (list) list.push(item);
  else map.set(key, [item]);
}

export function buildStockCatalog(rows: StockCatalogRows): StockCatalog {
  const catalog = emptyStockCatalog();
  const usable = new Set(rows.materials.filter((m) => m.archived_at === null).map((m) => m.id));

  for (const g of rows.groups) {
    catalog.groups.set(g.id, { id: g.id, kind: g.kind, name: g.name, members: [] } satisfies ChoiceGroup);
  }
  const members = [...rows.members].sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const m of members) {
    const group = catalog.groups.get(m.group_id);
    const priceDelta = num(m.price_delta, { atLeast: 0 });
    if (!group || priceDelta === null || !usable.has(m.raw_material_id)) continue;
    group.members.push({
      id: m.id, groupId: m.group_id, materialId: m.raw_material_id, label: m.label, tier: m.tier,
      priceDelta, isDefault: m.is_default, sortOrder: m.sort_order,
    } satisfies GroupMember);
  }

  for (const r of rows.recipes) {
    const qty = num(r.quantity_used, { above: 0 });
    if (qty === null) continue;
    let line: RecipeLine;
    if (r.line_kind === "fixed") {
      if (r.raw_material_id === null || !usable.has(r.raw_material_id)) continue;
      line = { kind: "fixed", materialId: r.raw_material_id, qty };
    } else {
      if (r.group_id === null) continue;
      line = { kind: "slot", groupId: r.group_id, qty, defaultMemberId: r.default_member_id, allowSpecial: r.allow_special };
    }
    push(catalog.recipes, r.product_id, line);
  }

  catalog.levels = [...rows.levels]
    .sort((a, b) => a.sort_order - b.sort_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((l): SweetnessLevel => ({ id: l.id, name: l.name, isNone: l.is_none, isDefault: l.is_default, sortOrder: l.sort_order }));

  const productTables = new Map<string, AmountTable>();
  for (const a of rows.amounts) {
    const amount = num(a.amount, { atLeast: 0 });
    if (amount === null) continue;
    let table: AmountTable;
    if (a.product_id === null) {
      table = catalog.standardSweetness;
    } else {
      table = productTables.get(a.product_id) ?? new Map();
      productTables.set(a.product_id, table);
    }
    table.set(`${a.member_id}:${a.level_id}`, amount);
  }

  for (const p of rows.productSweetness) {
    catalog.productSweetness.set(p.product_id, {
      groupId: p.group_id, defaultMemberId: p.default_member_id, allowedMemberIds: [...p.allowed_member_ids],
      defaultLevelId: p.default_level_id,
      custom: p.use_custom ? (productTables.get(p.product_id) ?? new Map()) : null,
    } satisfies ProductSweetness);
  }

  for (const e of rows.optionEffects) {
    const qty = num(e.amount, { above: 0 });
    if (qty === null) continue;
    let effect: OptionEffect;
    if (e.kind === "slot_add") {
      if (e.group_id === null) continue;
      effect = { kind: "slot_add", groupId: e.group_id, qty };
    } else {
      if (e.raw_material_id === null || !usable.has(e.raw_material_id)) continue;
      effect = { kind: "material_add", materialId: e.raw_material_id, qty };
    }
    push(catalog.optionEffects, e.option_id, effect);
  }

  for (const s of rows.packagingSets) catalog.packagingSets.set(s.id, { name: s.name, items: [] });
  for (const i of rows.packagingItems) {
    const set = catalog.packagingSets.get(i.set_id);
    const qty = num(i.qty, { above: 0 });
    if (!set || qty === null || !usable.has(i.raw_material_id)) continue;
    set.items.push({ materialId: i.raw_material_id, qty });
  }
  for (const p of rows.productPackaging) {
    if (p.packaging_set_id === null && !p.house_glass_default) continue;
    catalog.packaging.set(p.product_id, { setId: p.packaging_set_id, houseGlassDefault: p.house_glass_default });
  }

  return catalog;
}
