// The one-page menu editor's draft (round D1): menu fields, recipe lines (fixed lines and bean/matcha
// lines the customer chooses from), option links and the menu's sweetness. Pure; no I/O. Three steps,
// each tested on its own and as a round trip:
//   saved rows  → draft          menuDraftFromRows  (the edit page)
//   draft       → checked value  parseMenuDraft     (the server action; never trusts the client)
//   value       → RPC payload    menuSavePayload    (save_menu's JSON contract, migration 20261118170000)
// Nothing the owner configured may be lost on the way: a line or sweetness setting is only removed when
// the owner removed it in the editor.
import {
  MAX_RECIPE_QTY,
  MAX_RECIPE_ROWS,
  validateMenuFields,
  type DrinkType,
  type ProductInput,
} from "./product-input.ts";
import { gridKey, parseAmountText } from "./stock/config-plan.ts";

export type FixedLineDraft = { kind: "fixed"; rawMaterialId: string; quantityUsed: string };
export type SlotLineDraft = {
  kind: "slot";
  groupId: string;
  quantityUsed: string;
  /** null = the group's own default */
  defaultMemberId: string | null;
  allowSpecial: boolean;
};
export type RecipeLineDraft = FixedLineDraft | SlotLineDraft;

export type SweetnessDraft = {
  groupId: string;
  defaultMemberId: string;
  /** other sweeteners the customer may switch to (the default itself is never listed) */
  allowedMemberIds: string[];
  /** null = the shop's default level */
  defaultLevelId: string | null;
  /** "ใช้ปริมาณเฉพาะเมนูนี้" */
  useCustom: boolean;
  /** the menu's own table as typed, keyed `${memberId}:${levelId}`; kept while useCustom is off but not saved */
  custom: Record<string, string>;
};

/** Everything the one-page menu editor sends in a single save. */
export type MenuDraft = {
  name: string;
  price: string;
  description: string;
  categoryId: string | null;
  drinkType: DrinkType | null;
  isActive: boolean;
  recipes: RecipeLineDraft[];
  modifierIds: string[];
  /** undefined = leave the menu's sweetness as it is; null = the menu has no sweetness */
  sweetness?: SweetnessDraft | null;
  /** "ภาชนะ" (D2a): undefined = leave the menu's set as it is; null = "ไม่หักภาชนะ" */
  packagingSetId?: string | null;
  /** "ปกติเสิร์ฟแก้วร้าน" (D2a): undefined = leave as it is */
  houseGlassDefault?: boolean;
};

export type RecipeLine =
  | { kind: "fixed"; rawMaterialId: string; quantityUsed: number }
  | { kind: "slot"; groupId: string; quantityUsed: number; defaultMemberId: string | null; allowSpecial: boolean };

export type SweetnessValue = {
  groupId: string;
  defaultMemberId: string;
  allowedMemberIds: string[];
  defaultLevelId: string | null;
  useCustom: boolean;
  custom: { memberId: string; levelId: string; amount: number }[];
};

export type MenuValue = {
  menu: ProductInput;
  recipes: RecipeLine[];
  modifierIds: string[];
  /** undefined = not sent (the menu's sweetness is left as it is) */
  sweetness?: SweetnessValue | null;
  /** undefined = not sent (left as it is); null = no set */
  packagingSetId?: string | null;
  /** undefined = not sent (left as it is) */
  houseGlassDefault?: boolean;
};

export const RECIPE_QTY_ERROR = "ปริมาณวัตถุดิบไม่ถูกต้อง";
export const DUPLICATE_SLOT_GROUP = "เมนูนี้มีช่องเมล็ด/มัทฉะกลุ่มนี้แล้ว";
const DUPLICATE_MATERIAL = "วัตถุดิบเดียวกันใส่ซ้ำไม่ได้ — รวมเป็นบรรทัดเดียว";
const HALF_LINE = "กรอกสูตรให้ครบทุกบรรทัด หรือลบบรรทัดที่ไม่ใช้";
const TOO_MANY_LINES = `สูตรมีได้ไม่เกิน ${MAX_RECIPE_ROWS} บรรทัด`;
const BAD_INPUT = "ข้อมูลไม่ถูกต้อง กรุณารีเฟรชหน้า";
const NO_SWEETENER = "เลือกชนิดความหวานเริ่มต้นของเมนูนี้";
const CUSTOM_PREFIX = "ปริมาณเฉพาะเมนูนี้: ";
const CUSTOM_INCOMPLETE = "ใส่ปริมาณให้ครบทุกช่อง";

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const isText = (v: unknown): v is string => typeof v === "string";

function parseQty(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return null;
  const qty = Number(t);
  return qty > 0 && qty <= MAX_RECIPE_QTY ? qty : null;
}

/** The menu's sweeteners: the default first, then the allowed ones, no repeats. */
export function menuSweeteners(s: { defaultMemberId: string; allowedMemberIds: string[] }): string[] {
  return [...new Set([s.defaultMemberId, ...s.allowedMemberIds])];
}

function parseRecipeLines(lines: unknown): { value: RecipeLine[] } | { error: string } {
  if (!Array.isArray(lines)) return { error: BAD_INPUT };
  const value: RecipeLine[] = [];
  const materials = new Set<string>();
  const groups = new Set<string>();
  for (const raw of lines as unknown[]) {
    if (!raw || typeof raw !== "object") return { error: BAD_INPUT };
    const line = raw as Record<string, unknown>;
    // A line without a kind is a fixed line (the shape the pre-D1 editor sent).
    const kind = line.kind ?? "fixed";
    const qtyText = isText(line.quantityUsed) ? line.quantityUsed : "";
    if (kind === "fixed") {
      const material = isText(line.rawMaterialId) ? line.rawMaterialId : "";
      if (material === "" && qtyText.trim() === "") continue; // a blank row the owner added but never filled
      if (material === "" || qtyText.trim() === "") return { error: HALF_LINE };
      if (!isId(material)) return { error: BAD_INPUT };
      const qty = parseQty(qtyText);
      if (qty === null) return { error: RECIPE_QTY_ERROR };
      if (materials.has(material)) return { error: DUPLICATE_MATERIAL };
      materials.add(material);
      value.push({ kind: "fixed", rawMaterialId: material, quantityUsed: qty });
    } else if (kind === "slot") {
      const group = isText(line.groupId) ? line.groupId : "";
      if (group === "" && qtyText.trim() === "") continue;
      if (group === "" || qtyText.trim() === "") return { error: HALF_LINE };
      if (!isId(group)) return { error: BAD_INPUT };
      const qty = parseQty(qtyText);
      if (qty === null) return { error: RECIPE_QTY_ERROR };
      if (groups.has(group)) return { error: DUPLICATE_SLOT_GROUP };
      groups.add(group);
      const member = line.defaultMemberId ?? null;
      if (member !== null && !isId(member)) return { error: BAD_INPUT };
      if (typeof line.allowSpecial !== "boolean") return { error: BAD_INPUT };
      value.push({
        kind: "slot",
        groupId: group,
        quantityUsed: qty,
        defaultMemberId: member,
        allowSpecial: line.allowSpecial,
      });
    } else {
      return { error: BAD_INPUT };
    }
    if (value.length > MAX_RECIPE_ROWS) return { error: TOO_MANY_LINES };
  }
  return { value };
}

function parseSweetness(raw: unknown): { value: SweetnessValue | null } | { error: string } {
  if (raw === null) return { value: null };
  if (typeof raw !== "object") return { error: BAD_INPUT };
  const s = raw as Record<string, unknown>;
  if (!isId(s.groupId)) return { error: BAD_INPUT };
  if (!isId(s.defaultMemberId)) return { error: NO_SWEETENER };
  if (!Array.isArray(s.allowedMemberIds) || !s.allowedMemberIds.every(isId)) return { error: BAD_INPUT };
  const level = s.defaultLevelId ?? null;
  if (level !== null && !isId(level)) return { error: BAD_INPUT };
  if (typeof s.useCustom !== "boolean") return { error: BAD_INPUT };
  if (!s.custom || typeof s.custom !== "object" || Array.isArray(s.custom)) return { error: BAD_INPUT };

  const defaultMemberId = s.defaultMemberId;
  const allowedMemberIds = [...new Set(s.allowedMemberIds as string[])].filter((id) => id !== defaultMemberId).sort();
  const custom: SweetnessValue["custom"] = [];

  if (s.useCustom) {
    // Every sweetener of the menu needs an amount at every level the table shows; the levels are
    // whatever the editor's grid has columns for (the database also checks against the shop's levels).
    const members = menuSweeteners({ defaultMemberId, allowedMemberIds });
    const grid = s.custom as Record<string, unknown>;
    const levels = new Set<string>();
    for (const key of Object.keys(grid)) {
      const [member, levelId] = key.split(":");
      if (member && levelId && members.includes(member)) levels.add(levelId);
    }
    if (levels.size === 0) return { error: CUSTOM_PREFIX + CUSTOM_INCOMPLETE };
    for (const member of members) {
      for (const levelId of [...levels].sort()) {
        const text = grid[gridKey(member, levelId)];
        if (!isText(text)) return { error: CUSTOM_PREFIX + CUSTOM_INCOMPLETE };
        const cell = parseAmountText(text);
        if ("error" in cell) return { error: CUSTOM_PREFIX + cell.error };
        if (!isId(levelId)) return { error: BAD_INPUT };
        custom.push({ memberId: member, levelId, amount: cell.value });
      }
    }
  }

  return {
    value: {
      groupId: s.groupId,
      defaultMemberId,
      allowedMemberIds,
      defaultLevelId: level,
      useCustom: s.useCustom,
      custom,
    },
  };
}

export function parseMenuDraft(d: MenuDraft): { value: MenuValue } | { error: string } {
  if (!d || typeof d !== "object") return { error: BAD_INPUT };
  const menu = validateMenuFields({
    name: isText(d.name) ? d.name : "",
    price: isText(d.price) ? d.price : "",
    description: isText(d.description) ? d.description : "",
    categoryId: d.categoryId ?? "",
    drinkType: d.drinkType ?? "",
    isActive: d.isActive === true,
  });
  if ("error" in menu) return menu;

  const recipes = parseRecipeLines(d.recipes);
  if ("error" in recipes) return recipes;

  if (!Array.isArray(d.modifierIds) || !d.modifierIds.every(isId)) return { error: BAD_INPUT };

  const value: MenuValue = { menu: menu.value, recipes: recipes.value, modifierIds: [...new Set(d.modifierIds)] };
  if (d.sweetness !== undefined) {
    const sweetness = parseSweetness(d.sweetness);
    if ("error" in sweetness) return sweetness;
    value.sweetness = sweetness.value;
  }
  // Packaging: the database checks the set is this shop's and not archived (packaging_set_not_found).
  if (d.packagingSetId !== undefined) {
    if (d.packagingSetId !== null && !isId(d.packagingSetId)) return { error: BAD_INPUT };
    value.packagingSetId = d.packagingSetId;
  }
  if (d.houseGlassDefault !== undefined) {
    if (typeof d.houseGlassDefault !== "boolean") return { error: BAD_INPUT };
    value.houseGlassDefault = d.houseGlassDefault;
  }
  return { value };
}

/**
 * save_menu's arguments for a checked draft. `sweetness`, `packaging_set_id` and `house_glass_default` are
 * only sent when the draft carried them (an absent key leaves the menu's value as it is).
 */
export function menuSavePayload(v: MenuValue): {
  p_menu: Record<string, unknown>;
  p_recipes: Record<string, unknown>[];
  p_modifier_ids: string[];
} {
  const p_menu: Record<string, unknown> = {
    name: v.menu.name,
    price: v.menu.price,
    description: v.menu.description,
    category_id: v.menu.categoryId,
    drink_type: v.menu.drinkType,
    is_active: v.menu.isActive,
  };
  if (v.sweetness !== undefined) {
    p_menu.sweetness =
      v.sweetness === null
        ? null
        : {
            group_id: v.sweetness.groupId,
            default_member_id: v.sweetness.defaultMemberId,
            allowed_member_ids: v.sweetness.allowedMemberIds,
            default_level_id: v.sweetness.defaultLevelId,
            use_custom: v.sweetness.useCustom,
            custom: v.sweetness.custom.map((c) => ({ member_id: c.memberId, level_id: c.levelId, amount: c.amount })),
          };
  }
  if (v.packagingSetId !== undefined) p_menu.packaging_set_id = v.packagingSetId;
  if (v.houseGlassDefault !== undefined) p_menu.house_glass_default = v.houseGlassDefault;
  const p_recipes = v.recipes.map((r) =>
    r.kind === "fixed"
      ? { line_kind: "fixed", raw_material_id: r.rawMaterialId, quantity_used: r.quantityUsed }
      : {
          line_kind: "slot",
          group_id: r.groupId,
          quantity_used: r.quantityUsed,
          default_member_id: r.defaultMemberId,
          allow_special: r.allowSpecial,
        }
  );
  return { p_menu, p_recipes, p_modifier_ids: v.modifierIds };
}

type Num = number | string; // PostgREST may return numeric as a string

/** What the edit page reads for one menu (plain rows). */
export type MenuRows = {
  product: {
    name: string;
    price: Num;
    description: string | null;
    category_id: string | null;
    drink_type: string | null;
    is_active: boolean;
    /** read by the D2a edit page; a row without them gives a draft without them (nothing is wiped on save) */
    packaging_set_id?: string | null;
    house_glass_default?: boolean;
  };
  /** product_recipes */
  recipes: {
    line_kind: string;
    raw_material_id: string | null;
    group_id: string | null;
    quantity_used: Num;
    default_member_id: string | null;
    allow_special: boolean;
  }[];
  modifierIds: string[];
  /** product_sweetness, or null when the menu has none */
  sweetness: {
    group_id: string;
    default_member_id: string;
    allowed_member_ids: string[];
    default_level_id: string | null;
    use_custom: boolean;
  } | null;
  /** sweetness_amounts rows of this menu (product_id = the menu) */
  customAmounts: { member_id: string; level_id: string; amount: Num }[];
  /** display order: material ids by name (archived ones included) and choice group ids in their order */
  materialOrder: string[];
  groupOrder: string[];
};

const qtyText = (q: Num) => String(Number(q));

function byOrder(order: string[]) {
  const at = new Map(order.map((id, i) => [id, i]));
  return (a: string, b: string) =>
    (at.get(a) ?? Number.MAX_SAFE_INTEGER) - (at.get(b) ?? Number.MAX_SAFE_INTEGER) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * The editor's starting draft for a saved menu: every slot line (groups in their order) then every fixed
 * line (materials by name, archived ones included), the option links and the sweetness with its own table.
 */
export function menuDraftFromRows(rows: MenuRows): MenuDraft {
  const byGroup = byOrder(rows.groupOrder);
  const byMaterial = byOrder(rows.materialOrder);

  const slots: SlotLineDraft[] = rows.recipes
    .filter((r) => r.line_kind === "slot" && r.group_id !== null)
    .map((r) => ({
      kind: "slot" as const,
      groupId: r.group_id!,
      quantityUsed: qtyText(r.quantity_used),
      defaultMemberId: r.default_member_id,
      allowSpecial: r.allow_special,
    }))
    .sort((a, b) => byGroup(a.groupId, b.groupId));
  const fixed: FixedLineDraft[] = rows.recipes
    .filter((r) => r.line_kind !== "slot" && r.raw_material_id !== null)
    .map((r) => ({ kind: "fixed" as const, rawMaterialId: r.raw_material_id!, quantityUsed: qtyText(r.quantity_used) }))
    .sort((a, b) => byMaterial(a.rawMaterialId, b.rawMaterialId));

  let sweetness: SweetnessDraft | null = null;
  if (rows.sweetness) {
    const s = rows.sweetness;
    const custom: Record<string, string> = {};
    for (const a of rows.customAmounts) custom[gridKey(a.member_id, a.level_id)] = qtyText(a.amount);
    sweetness = {
      groupId: s.group_id,
      defaultMemberId: s.default_member_id,
      allowedMemberIds: [...new Set(s.allowed_member_ids)].filter((id) => id !== s.default_member_id).sort(),
      defaultLevelId: s.default_level_id,
      useCustom: s.use_custom,
      custom,
    };
  }

  const draft: MenuDraft = {
    name: rows.product.name,
    price: String(Number(rows.product.price)),
    description: rows.product.description ?? "",
    categoryId: rows.product.category_id,
    drinkType: (rows.product.drink_type as DrinkType | null) ?? null,
    isActive: rows.product.is_active,
    recipes: [...slots, ...fixed],
    modifierIds: rows.modifierIds,
    sweetness,
  };
  if (rows.product.packaging_set_id !== undefined) draft.packagingSetId = rows.product.packaging_set_id;
  if (rows.product.house_glass_default !== undefined) draft.houseGlassDefault = rows.product.house_glass_default;
  return draft;
}

/**
 * The menu's own table with a cell for every sweetener × level: a missing ไม่หวาน cell is "0", any other
 * missing cell starts from the shop's standard table (blank when the shop has none). Typed cells stay.
 */
export function fillSweetnessGrid(
  grid: Record<string, string>,
  memberIds: string[],
  levels: { id: string; isNone: boolean }[],
  standard: { member_id: string; level_id: string; amount: number }[]
): Record<string, string> {
  const shop = new Map(standard.map((a) => [gridKey(a.member_id, a.level_id), a.amount]));
  const out = { ...grid };
  for (const m of memberIds) {
    for (const l of levels) {
      const k = gridKey(m, l.id);
      if (out[k] !== undefined) continue;
      out[k] = l.isNone ? "0" : shop.has(k) ? String(shop.get(k)) : "";
    }
  }
  return out;
}

/** A stable form of the draft for "has anything changed?": sets are sorted, an unused own table is ignored. */
export function comparableDraft(d: MenuDraft): string {
  const s = d.sweetness;
  const sweetness =
    s === undefined || s === null
      ? s
      : {
          ...s,
          allowedMemberIds: [...s.allowedMemberIds].sort(),
          custom: s.useCustom ? Object.entries(s.custom).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : null,
        };
  return JSON.stringify({ ...d, modifierIds: [...d.modifierIds].sort(), sweetness });
}
