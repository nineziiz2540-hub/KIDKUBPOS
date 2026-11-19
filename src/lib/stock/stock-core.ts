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

/**
 * What the POS sends per line (all optional: a pre-D1 cart has none). Per slot, `count` 2 doubles a
 * special member (ignored on a house member) and `shotMemberId` is the house member the cashier
 * picked for the extra shot on a special cup (anything else falls back to the menu's house default).
 */
export type LineChoices = {
  slots?: { groupId: string; memberId: string; count?: number; shotMemberId?: string }[];
  sweetness?: { levelId: string; memberId: string | null } | null;
};

export type StockLine = { materialId: string; qty: number };
export type ChoiceSnapshot = {
  slots: {
    groupId: string; memberId: string; materialId: string; label: string; tier: "house" | "special"; priceDelta: number;
    /** present (= 2) only when a special member is doubled */
    count?: 2;
    /** present only when the slot member is special AND ≥1 chosen option has a slot_add effect on this group */
    shot?: { memberId: string; materialId: string; label: string; optionIds: string[] };
  }[];
  /** groups the line's options add to (slot_add effects); a record only, no longer used for price */
  slotAddGroupIds: string[];
  sweetness: { levelId: string; levelName: string; memberId: string | null; label: string | null } | null;
};
export type ResolvedLine = {
  stock: StockLine[];
  priceDeltaSatang: number;
  snapshot: ChoiceSnapshot;
};

export function emptyStockCatalog(): StockCatalog {
  return {
    recipes: new Map(), groups: new Map(), levels: [], standardSweetness: new Map(),
    productSweetness: new Map(), optionEffects: new Map(),
  };
}

export const STOCK_STALE = "รายการเมนูมีการเปลี่ยนแปลง กรุณาเลือกใหม่";

/**
 * Slot default: the line's own default (if still a member) → member flagged default → first house
 * member → none. When the line forbids specials (allowSpecial === false) a special default is skipped.
 */
export function defaultSlotMember(
  group: ChoiceGroup,
  line: { defaultMemberId: string | null; allowSpecial?: boolean }
): GroupMember | null {
  const usable = (m: GroupMember | undefined) =>
    m && (line.allowSpecial !== false || m.tier !== "special") ? m : null;
  const own = usable(group.members.find((m) => m.id === line.defaultMemberId));
  if (own) return own;
  const flagged = usable(group.members.find((m) => m.isDefault));
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

/**
 * Per-cup specialty price: each special slot member once, twice when doubled (count 2). House members
 * and extra shots add nothing (an extra shot always uses a house member; its price is the option's).
 */
export function cupPriceDeltaSatang(
  slotMembers: { tier: "house" | "special"; priceDelta: number; count?: number }[]
): number {
  let total = 0;
  for (const m of slotMembers) {
    if (m.tier !== "special") continue;
    total += toSatang(m.priceDelta) * (m.count === 2 ? 2 : 1);
  }
  return total;
}

/**
 * How many recipe doses of a slot's member one cup takes: 2 only when the member is special AND it is
 * the member that was chosen AND that pick asked for ×2. A house member never doubles, and a fallback
 * that replaced the chosen member (gone, unknown, not allowed) is a different chip, so ×1.
 * Shared by resolveLine and the POS option window (settle).
 */
export function slotCount(member: GroupMember, chosenMemberId: string | undefined, chosenCount: number | undefined): 1 | 2 {
  return member.tier === "special" && member.id === chosenMemberId && chosenCount === 2 ? 2 : 1;
}

/**
 * The member an extra shot on group `group` uses when the cup's member is special: the cashier's pick
 * when it is a house member of the group → the menu's house default → (no house member at all) the
 * cup's own member. Shared by resolveLine and the POS option window so both pick the same.
 */
export function shotMember(
  group: ChoiceGroup,
  line: { defaultMemberId: string | null },
  cupMember: GroupMember,
  pickedId: string | undefined
): GroupMember {
  const picked = group.members.find((m) => m.id === pickedId && m.tier === "house");
  return picked ?? defaultSlotMember(group, { defaultMemberId: line.defaultMemberId, allowSpecial: false }) ?? cupMember;
}

/** One resolved slot as the slot_add pass sees it; `shotPick` is the cashier's house pick for the shot. */
export type SlotForAdds = {
  group: ChoiceGroup;
  line: { defaultMemberId: string | null };
  member: GroupMember;
  shotPick: string | undefined;
};

/** The extra shot on a special slot: its member and the chosen options that added to it (once each, option order). */
export type SlotShot = { member: GroupMember; optionIds: string[] };

/**
 * The slot_add pass, shared by resolveLine and the POS option window. For each slot_add effect, in
 * option order, whose group has a slot: the group goes into slotAddGroupIds (a record only), and
 * `add(member, qty)` is told which member the extra goes to. On a house cup that is the cup's own
 * member and no shot is recorded. On a special cup it is the shot member, chosen once per group
 * (shotMember), and the shot lists every option that added to it, once each.
 */
export function slotAdds(
  optionIds: string[],
  effects: Map<string, OptionEffect[]>,
  slots: Map<string, SlotForAdds>,
  add: (member: GroupMember, qty: number) => void = () => {}
): { slotAddGroupIds: string[]; shots: Map<string, SlotShot> } {
  const slotAddGroupIds: string[] = [];
  const shots = new Map<string, SlotShot>();
  for (const optionId of optionIds) {
    for (const effect of effects.get(optionId) ?? []) {
      if (effect.kind !== "slot_add") continue;
      const slot = slots.get(effect.groupId);
      if (!slot) continue;
      slotAddGroupIds.push(effect.groupId);
      if (slot.member.tier === "house") {
        add(slot.member, effect.qty);
        continue;
      }
      let shot = shots.get(effect.groupId);
      if (!shot) {
        shot = { member: shotMember(slot.group, slot.line, slot.member, slot.shotPick), optionIds: [] };
        shots.set(effect.groupId, shot);
      }
      if (!shot.optionIds.includes(optionId)) shot.optionIds.push(optionId);
      add(shot.member, effect.qty);
    }
  }
  return { slotAddGroupIds, shots };
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

  const resolvedSlots: { tier: "house" | "special"; priceDelta: number; count: number }[] = [];
  type SnapSlot = ChoiceSnapshot["slots"][number];
  const slotByGroup = new Map<string, SlotForAdds & { snap: SnapSlot }>();
  const snapshot: ChoiceSnapshot = { slots: [], slotAddGroupIds: [], sweetness: null };

  for (const line of catalog.recipes.get(productId) ?? []) {
    if (line.kind === "fixed") {
      add(line.materialId, line.qty);
      continue;
    }
    const group = catalog.groups.get(line.groupId);
    if (!group || group.members.length === 0) continue;
    const chosen = choices?.slots?.find((s) => s.groupId === line.groupId);
    // An unknown chosen member falls back to the default chain: never block a sale over stock data.
    let member: GroupMember | null = group.members.find((m) => m.id === chosen?.memberId) ?? null;
    if (member && member.tier === "special" && !line.allowSpecial) return stale;
    member ??= defaultSlotMember(group, line);
    if (!member) continue;
    // ×2 only on the chosen special itself (a house member or a fallback is one dose).
    const count = slotCount(member, chosen?.memberId, chosen?.count);
    add(member.materialId, line.qty * count);
    resolvedSlots.push({ tier: member.tier, priceDelta: member.priceDelta, count });
    const snap: SnapSlot = {
      groupId: line.groupId, memberId: member.id, materialId: member.materialId,
      label: member.label, tier: member.tier, priceDelta: member.priceDelta,
    };
    if (count === 2) snap.count = 2;
    snapshot.slots.push(snap);
    slotByGroup.set(line.groupId, { group, line, member, shotPick: chosen?.shotMemberId, snap });
  }

  for (const optionId of optionIds) {
    for (const effect of catalog.optionEffects.get(optionId) ?? []) {
      if (effect.kind === "material_add") add(effect.materialId, effect.qty);
    }
  }
  // Extra shots: a house cup's is the same member; a special cup's uses a house member and is recorded
  // on the slot (no specialty price: cupPriceDeltaSatang never counts shots).
  const { slotAddGroupIds, shots } = slotAdds(optionIds, catalog.optionEffects, slotByGroup, (m, qty) => add(m.materialId, qty));
  for (const [groupId, shot] of shots) {
    const snap = slotByGroup.get(groupId)!.snap;
    snap.shot = { memberId: shot.member.id, materialId: shot.member.materialId, label: shot.member.label, optionIds: shot.optionIds };
  }

  snapshot.slotAddGroupIds = slotAddGroupIds;

  const sweetness = catalog.productSweetness.get(productId);
  if (sweetness) {
    const chosen = choices?.sweetness ?? null;

    const level: SweetnessLevel | null = (chosen && catalog.levels.find((l) => l.id === chosen.levelId)) || defaultLevel(catalog.levels, sweetness);
    if (level) {
      if (level.isNone) {
        snapshot.sweetness = { levelId: level.id, levelName: level.name, memberId: null, label: null };
      } else {
        const memberId = chosen?.memberId ?? sweetness.defaultMemberId;
        const group = catalog.groups.get(sweetness.groupId);
        // Sweeteners carry no price, so an unknown or not-allowed choice falls back to the menu's
        // default instead of refusing the sale.
        const chosenOk =
          memberId === sweetness.defaultMemberId ||
          (sweetness.allowedMemberIds.includes(memberId) && group?.members.some((m) => m.id === memberId));
        const finalId = chosenOk ? memberId : sweetness.defaultMemberId;
        // A config gap (member or group gone) skips the sweetener stock instead of refusing the sale.
        const member = group?.members.find((m) => m.id === finalId);
        if (member) {
          const table = sweetness.custom ?? catalog.standardSweetness;
          add(member.materialId, table.get(`${member.id}:${level.id}`) ?? 0);
        }
        snapshot.sweetness = { levelId: level.id, levelName: level.name, memberId: finalId, label: member?.label ?? null };
      }
    }
  }

  const stock: StockLine[] = [...perCup.entries()]
    .map(([materialId, qty]) => ({ materialId, qty: qty * quantity }))
    .filter((l) => l.qty > 0)
    .sort((a, b) => (a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0));

  return {
    stock,
    priceDeltaSatang: cupPriceDeltaSatang(resolvedSlots),
    snapshot,
  };
}
