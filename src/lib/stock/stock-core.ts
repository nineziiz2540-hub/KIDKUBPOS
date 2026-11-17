// Pure stock rules for one cart line (round D1): which materials to deduct, how much, and the
// specialty price per cup. No I/O, no Next.js/Supabase/React imports — shared by server pricing,
// the order RPC payload and the POS cart.
import { toSatang } from "../cash.ts";

export type RecipeLine =
  | { kind: "fixed"; materialId: string; qty: number }
  | { kind: "slot"; groupId: string; qty: number; defaultMemberId: string | null; allowSpecial: boolean };

export type GroupMember = {
  id: string; groupId: string; materialId: string; label: string;
  tier: "house" | "special"; priceDelta: number; isDefault: boolean; sortOrder: number;
};
export type ChoiceGroup = { id: string; kind: "bean" | "matcha" | "sweetener" | "other"; name: string; members: GroupMember[] };

export type SweetnessLevel = { id: string; name: string; isNone: boolean; isDefault: boolean; sortOrder: number };
/** key `${memberId}:${levelId}` → amount in the member material's base unit */
export type AmountTable = Map<string, number>;
export type ProductSweetness = {
  groupId: string; defaultMemberId: string; allowedMemberIds: string[];
  defaultLevelId: string | null; custom: AmountTable | null;
};

export type OptionEffect =
  | { kind: "slot_add"; groupId: string; qty: number }
  | { kind: "material_add"; materialId: string; qty: number };

export type StockCatalog = {
  recipes: Map<string, RecipeLine[]>;
  groups: Map<string, ChoiceGroup>;
  levels: SweetnessLevel[];
  standardSweetness: AmountTable;
  productSweetness: Map<string, ProductSweetness>;
  optionEffects: Map<string, OptionEffect[]>;
};

/** What the POS sends per line (all optional: a pre-D1 cart has none). */
export type LineChoices = {
  slots?: { groupId: string; memberId: string }[];
  sweetness?: { levelId: string; memberId: string | null } | null;
};

export type StockLine = { materialId: string; qty: number };
export type ChoiceSnapshot = {
  slots: { groupId: string; memberId: string; materialId: string; label: string; tier: "house" | "special" }[];
  sweetness: { levelId: string; levelName: string; memberId: string | null; label: string | null } | null;
};
export type ResolvedLine = {
  stock: StockLine[];
  priceDeltaSatang: number;
  snapshot: ChoiceSnapshot;
};

export const STOCK_STALE = "รายการเมนูมีการเปลี่ยนแปลง กรุณาเลือกใหม่";

/** Slot default: the line's own default (if still a member) → member flagged default → first house member → none. */
export function defaultSlotMember(
  group: ChoiceGroup,
  line: { defaultMemberId: string | null }
): GroupMember | null {
  const own = line.defaultMemberId && group.members.find((m) => m.id === line.defaultMemberId);
  if (own) return own;
  const flagged = group.members.find((m) => m.isDefault);
  if (flagged) return flagged;
  const houses = group.members.filter((m) => m.tier === "house").sort((a, b) => a.sortOrder - b.sortOrder);
  return houses[0] ?? null;
}

/** Default sweetness level: the product's own default (if it exists) → the shop's default level → none. */
export function defaultLevel(
  levels: SweetnessLevel[],
  sweetness: ProductSweetness | undefined
): SweetnessLevel | null {
  const own = sweetness?.defaultLevelId ? levels.find((l) => l.id === sweetness.defaultLevelId) : undefined;
  return own ?? levels.find((l) => l.isDefault) ?? null;
}

/** Per-cup specialty price: each special slot member once, plus once more per slot_add option on that group. */
export function cupPriceDeltaSatang(
  slotMembers: { groupId: string; tier: "house" | "special"; priceDelta: number }[],
  slotAddGroupIds: string[]
): number {
  let total = 0;
  for (const m of slotMembers) {
    if (m.tier !== "special") continue;
    const unit = toSatang(m.priceDelta);
    const adds = slotAddGroupIds.filter((g) => g === m.groupId).length;
    total += unit * (1 + adds);
  }
  return total;
}

export function resolveLine(
  productId: string,
  quantity: number,
  choices: LineChoices | undefined,
  optionIds: string[],
  catalog: StockCatalog
): ResolvedLine | { error: typeof STOCK_STALE } {
  const stale = { error: STOCK_STALE } as const;
  const perCup = new Map<string, number>(); // materialId → qty for one cup
  const add = (materialId: string, qty: number) => {
    if (qty > 0) perCup.set(materialId, (perCup.get(materialId) ?? 0) + qty);
  };

  const resolvedSlots: { member: GroupMember }[] = [];
  const memberByGroup = new Map<string, GroupMember>();
  const snapshot: ChoiceSnapshot = { slots: [], sweetness: null };

  for (const line of catalog.recipes.get(productId) ?? []) {
    if (line.kind === "fixed") {
      add(line.materialId, line.qty);
      continue;
    }
    const group = catalog.groups.get(line.groupId);
    if (!group || group.members.length === 0) continue;
    const chosenId = choices?.slots?.find((s) => s.groupId === line.groupId)?.memberId;
    let member: GroupMember | null;
    if (chosenId !== undefined) {
      member = group.members.find((m) => m.id === chosenId) ?? null;
      if (!member) return stale;
      if (member.tier === "special" && !line.allowSpecial) return stale;
    } else {
      member = defaultSlotMember(group, line);
    }
    if (!member) continue;
    add(member.materialId, line.qty);
    resolvedSlots.push({ member });
    memberByGroup.set(line.groupId, member);
    snapshot.slots.push({
      groupId: line.groupId, memberId: member.id, materialId: member.materialId,
      label: member.label, tier: member.tier,
    });
  }

  const slotAddGroupIds: string[] = [];
  for (const optionId of optionIds) {
    for (const effect of catalog.optionEffects.get(optionId) ?? []) {
      if (effect.kind === "material_add") {
        add(effect.materialId, effect.qty);
      } else {
        const member = memberByGroup.get(effect.groupId);
        if (!member) continue;
        add(member.materialId, effect.qty);
        slotAddGroupIds.push(effect.groupId);
      }
    }
  }

  const sweetness = catalog.productSweetness.get(productId);
  if (sweetness) {
    const chosen = choices?.sweetness ?? null;
    let level: SweetnessLevel | null;
    if (chosen) {
      level = catalog.levels.find((l) => l.id === chosen.levelId) ?? null;
      if (!level) return stale;
    } else {
      level = defaultLevel(catalog.levels, sweetness);
    }
    if (level) {
      if (level.isNone) {
        snapshot.sweetness = { levelId: level.id, levelName: level.name, memberId: null, label: null };
      } else {
        const memberId = chosen?.memberId ?? sweetness.defaultMemberId;
        if (memberId !== sweetness.defaultMemberId && !sweetness.allowedMemberIds.includes(memberId)) return stale;
        const member = catalog.groups.get(sweetness.groupId)?.members.find((m) => m.id === memberId);
        if (!member) return stale;
        const table = sweetness.custom ?? catalog.standardSweetness;
        add(member.materialId, table.get(`${member.id}:${level.id}`) ?? 0);
        snapshot.sweetness = { levelId: level.id, levelName: level.name, memberId: member.id, label: member.label };
      }
    }
  }

  const stock: StockLine[] = [...perCup.entries()]
    .map(([materialId, qty]) => ({ materialId, qty: qty * quantity }))
    .filter((l) => l.qty > 0)
    .sort((a, b) => (a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0));

  return {
    stock,
    priceDeltaSatang: cupPriceDeltaSatang(resolvedSlots.map((s) => s.member), slotAddGroupIds),
    snapshot,
  };
}
