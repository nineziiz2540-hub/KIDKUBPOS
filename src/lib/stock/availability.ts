// Pure availability rules (round D2a): how many cups are left, "หมด?" (out), the option window's
// starting member, and the local decrement for queued bills. These are hints only — the cashier can
// always pass them with one tap, and nothing here ever throws on odd data. No I/O, no React.
import {
  defaultSlotMember, resolveLine,
  type RecipeLine, type StockCatalog,
} from "./stock-core.ts";

/** At or below this many cups a menu or chip shows "เหลือ ~N แก้ว". */
export const NEAR_OUT_CUPS = 10;

/** materialId → current level; only tracked, non-archived materials appear. */
export type Levels = Map<string, number>;

export type Availability = { state: "ok" | "low" | "out"; cupsLeft: number | null; limitingMaterialId: string | null };

function toAvailability(cupsLeft: number | null, limitingMaterialId: string | null): Availability {
  if (cupsLeft === null) return { state: "ok", cupsLeft: null, limitingMaterialId: null };
  const state = cupsLeft < 1 ? "out" : cupsLeft <= NEAR_OUT_CUPS ? "low" : "ok";
  return { state, cupsLeft, limitingMaterialId };
}

/** Cups left for one need: floor(level / qty), a level at or below zero is 0; null when untracked or qty ≤ 0. */
function cupsFor(need: { materialId: string; qty: number }, levels: Levels): number | null {
  const level = levels.get(need.materialId);
  if (level === undefined || !(need.qty > 0)) return null;
  return level <= 0 ? 0 : Math.floor(level / need.qty);
}

/**
 * The one rule behind every chip: the scarcest of the needs. Materials missing from `levels` and needs
 * with qty ≤ 0 are ignored; nothing tracked applies → cupsLeft null, state "ok".
 */
export function needsAvailability(needs: { materialId: string; qty: number }[], levels: Levels): Availability {
  let best: number | null = null;
  let limiting: string | null = null;
  for (const need of needs) {
    const cups = cupsFor(need, levels);
    if (cups === null) continue;
    if (best === null || cups < best) {
      best = cups;
      limiting = need.materialId;
    }
  }
  return toAvailability(best, limiting);
}

/** The slot lines of a menu's recipe. */
function slotLines(productId: string, catalog: StockCatalog): Extract<RecipeLine, { kind: "slot" }>[] {
  return (catalog.recipes.get(productId) ?? []).filter((l): l is Extract<RecipeLine, { kind: "slot" }> => l.kind === "slot");
}

/** The members of a slot group that count towards the menu: its house members, else the menu default. */
function menuMembers(line: Extract<RecipeLine, { kind: "slot" }>, catalog: StockCatalog) {
  const group = catalog.groups.get(line.groupId);
  if (!group || group.members.length === 0) return [];
  const houses = group.members.filter((m) => m.tier === "house");
  if (houses.length > 0) return houses;
  const fallback = defaultSlotMember(group, line);
  return fallback ? [fallback] : [];
}

/**
 * Availability of a whole menu tile. The menu only goes "out" from its fixed recipe lines, its packaging
 * set (both read through resolveLine so the rules match the sale path), or every house member of a slot
 * group being out. Sweeteners, specials and add-ons never count: they only mark their own chip.
 */
export function menuAvailability(productId: string, catalog: StockCatalog, levels: Levels): Availability {
  // Resolve the cup without its slots and its sweetener: what is left is fixed lines + packaging.
  const recipes = new Map(catalog.recipes);
  recipes.set(productId, (catalog.recipes.get(productId) ?? []).filter((l) => l.kind === "fixed"));
  const productSweetness = new Map(catalog.productSweetness);
  productSweetness.delete(productId);
  const base = resolveLine(productId, 1, undefined, [], { ...catalog, recipes, productSweetness });
  // A stale/odd menu has no tracked needs: never refuse a sale over stock.
  if ("error" in base) return toAvailability(null, null);

  const fixed = needsAvailability(base.stock, levels);
  let best = fixed.cupsLeft;
  let limiting = fixed.limitingMaterialId;

  for (const line of slotLines(productId, catalog)) {
    if (!(line.qty > 0)) continue;
    // The group's cupsLeft is its best member; an untracked member never limits, so the group doesn't.
    let groupCups: number | null = null;
    let groupMaterial: string | null = null;
    let untracked = false;
    const members = menuMembers(line, catalog);
    for (const m of members) {
      const cups = cupsFor({ materialId: m.materialId, qty: line.qty }, levels);
      if (cups === null) { untracked = true; break; }
      if (groupCups === null || cups > groupCups) { groupCups = cups; groupMaterial = m.materialId; }
    }
    if (untracked || groupCups === null) continue;
    if (best === null || groupCups < best) { best = groupCups; limiting = groupMaterial; }
  }
  return toAvailability(best, limiting);
}

/**
 * For each slot group of the menu, the house member the option window should start on: the menu default,
 * unless it is out and not suppressed — then the next house member by sortOrder that is not out. If all
 * are out, it stays the menu default.
 */
export function fallbackDefaults(
  productId: string, catalog: StockCatalog, levels: Levels, isSuppressed: (materialId: string) => boolean
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of slotLines(productId, catalog)) {
    const group = catalog.groups.get(line.groupId);
    if (!group) continue;
    const def = defaultSlotMember(group, line);
    if (!def) continue;
    result[line.groupId] = def.id;
    const isOut = (materialId: string) => needsAvailability([{ materialId, qty: line.qty }], levels).state === "out";
    if (isSuppressed(def.materialId) || !isOut(def.materialId)) continue;
    const next = group.members
      .filter((m) => m.tier === "house" && m.id !== def.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .find((m) => !isOut(m.materialId));
    if (next) result[line.groupId] = next.id;
  }
  return result;
}

/** Levels minus this device's queued, unsynced bills' stock lines (untracked materials stay untracked). */
export function levelsAfter(levels: Levels, pending: { materialId: string; qty: number }[][]): Levels {
  const out: Levels = new Map(levels);
  for (const bill of pending) {
    for (const line of bill) {
      const level = out.get(line.materialId);
      if (level !== undefined) out.set(line.materialId, level - line.qty);
    }
  }
  return out;
}

/** A suppressed "หมด?" stops being suppressed when the material's level changes. */
export function suppressionKey(materialId: string, level: number): string {
  return `${materialId}:${level}`;
}
