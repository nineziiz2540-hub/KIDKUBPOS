// Live cost per cup for the menu editor (round D1, owner/manager pages only). Pure; no I/O. The draft is
// turned into the same rows the till's catalog is built from (buildStockCatalog), the cup is resolved
// with the till's own rules (defaultChoices + resolveLine) at each sweetness level, and priced at the
// current material costs (buildProductCost) — so the number shown is what a sale would freeze today.
import { formatPrice, toSatang } from "../cash.ts";
import type { MenuDraft } from "../menu-draft.ts";
import { buildStockCatalog, type StockCatalogRows } from "./catalog-build.ts";
import { defaultChoices } from "./pos-choices.ts";
import { buildProductCost, type MaterialCost } from "./product-cost.ts";
import { resolveLine } from "./stock-core.ts";

export type PreviewGroup = {
  id: string;
  kind: "bean" | "matcha" | "sweetener" | "other";
  name: string;
  /** in their order */
  members: { id: string; materialId: string; label: string; tier: "house" | "special"; priceDelta: number; isDefault: boolean }[];
};
export type PreviewMaterial = { id: string; name: string; unit: string; costPerUnit: number; archived: boolean };

export type CostPreviewInput = {
  draft: Pick<MenuDraft, "recipes" | "sweetness">;
  groups: PreviewGroup[];
  /** the shop's levels in their order */
  levels: { id: string; name: string; isNone: boolean; isDefault: boolean }[];
  /** the shop's standard sweetness table */
  standardAmounts: { member_id: string; level_id: string; amount: number }[];
  materials: PreviewMaterial[];
};

export type CostPreview = {
  /** one entry per sweetness level (in order) when the menu has sweetness; otherwise one entry with no level */
  cups: { levelId: string | null; levelName: string | null; costSatang: number }[];
  /** materials in the cup with no usable cost: the numbers above are then too low */
  missingMaterials: string[];
};

const DRAFT_ID = "__draft__";

/** The draft as catalog rows. Unparseable quantities simply drop out (the builder skips them). */
export function draftCatalogRows(input: CostPreviewInput): StockCatalogRows {
  const { draft } = input;
  const rows: StockCatalogRows = {
    materials: input.materials.map((m) => ({ id: m.id, archived_at: m.archived ? "archived" : null })),
    recipes: draft.recipes.map((r) =>
      r.kind === "fixed"
        ? {
            product_id: DRAFT_ID, line_kind: "fixed" as const, raw_material_id: r.rawMaterialId || null, group_id: null,
            quantity_used: Number(r.quantityUsed.trim() || NaN), default_member_id: null, allow_special: true,
          }
        : {
            product_id: DRAFT_ID, line_kind: "slot" as const, raw_material_id: null, group_id: r.groupId || null,
            quantity_used: Number(r.quantityUsed.trim() || NaN), default_member_id: r.defaultMemberId,
            allow_special: r.allowSpecial,
          }
    ),
    groups: input.groups.map((g, i) => ({ id: g.id, kind: g.kind, name: g.name, sort_order: i })),
    members: input.groups.flatMap((g) =>
      g.members.map((m, i) => ({
        id: m.id, group_id: g.id, raw_material_id: m.materialId, label: m.label, tier: m.tier,
        price_delta: m.priceDelta, is_default: m.isDefault, sort_order: i,
      }))
    ),
    levels: input.levels.map((l, i) => ({ id: l.id, name: l.name, is_none: l.isNone, is_default: l.isDefault, sort_order: i })),
    amounts: input.standardAmounts.map((a) => ({ product_id: null, member_id: a.member_id, level_id: a.level_id, amount: a.amount })),
    productSweetness: [],
    optionEffects: [],
  };

  const s = draft.sweetness;
  if (s) {
    rows.productSweetness.push({
      product_id: DRAFT_ID, group_id: s.groupId, default_member_id: s.defaultMemberId,
      allowed_member_ids: s.allowedMemberIds, default_level_id: s.defaultLevelId, use_custom: s.useCustom,
    });
    if (s.useCustom) {
      for (const [key, text] of Object.entries(s.custom)) {
        const [member, level] = key.split(":");
        const t = text.trim();
        if (!member || !level || !/^\d+(\.\d{1,3})?$/.test(t)) continue;
        rows.amounts.push({ product_id: DRAFT_ID, member_id: member, level_id: level, amount: Number(t) });
      }
    }
  }
  return rows;
}

export function menuCostPreview(input: CostPreviewInput): CostPreview {
  const catalog = buildStockCatalog(draftCatalogRows(input));
  const materials = new Map<string, MaterialCost>(
    input.materials.map((m) => [m.id, { name: m.name, unit: m.unit, costPerUnit: m.costPerUnit }])
  );
  const defaults = defaultChoices(DRAFT_ID, catalog);
  const slots = defaults.slots.map((s) => ({ groupId: s.groupId, memberId: s.memberId }));
  const missing = new Set<string>();

  const priceCup = (sweetness: { levelId: string; memberId: string | null } | null): number | null => {
    const resolved = resolveLine(DRAFT_ID, 1, { slots, sweetness }, [], catalog);
    if ("error" in resolved) return null;
    const cost = buildProductCost(DRAFT_ID, resolved.stock, materials);
    for (const name of cost.missingMaterials ?? []) missing.add(name);
    return toSatang(cost.ingredientCost);
  };

  const cups: CostPreview["cups"] = [];
  const ps = catalog.productSweetness.get(DRAFT_ID);
  if (ps && catalog.levels.length > 0) {
    for (const level of catalog.levels) {
      const satang = priceCup({ levelId: level.id, memberId: level.isNone ? null : ps.defaultMemberId });
      if (satang !== null) cups.push({ levelId: level.id, levelName: level.name, costSatang: satang });
    }
  } else {
    const satang = priceCup(null);
    if (satang !== null) cups.push({ levelId: null, levelName: null, costSatang: satang });
  }
  return { cups, missingMaterials: [...missing] };
}

/** "ต้นทุนต่อแก้ว: ไม่หวาน ฿21.30 · หวานน้อย ฿22.30 · …" (or "ต้นทุนต่อแก้ว: ฿21.30" without sweetness). */
export function costPreviewText(preview: CostPreview): string | null {
  if (preview.cups.length === 0) return null;
  const parts = preview.cups.map((c) => {
    const money = `฿${formatPrice(c.costSatang / 100)}`;
    return c.levelName === null ? money : `${c.levelName} ${money}`;
  });
  return `ต้นทุนต่อแก้ว: ${parts.join(" · ")}`;
}

