// The choices the POS option window starts with (round D1). Pure: it reuses the server's own default
// rules from stock-core so the cup shown and the stock/price recorded can never disagree.
import type { CartChoices } from "../../types/app.ts";
import { defaultLevel, defaultSlotMember, type StockCatalog } from "./stock-core.ts";

/** The choices the option window starts with for this menu (same rules the server uses). */
export function defaultChoices(productId: string, catalog: StockCatalog): CartChoices {
  const slots: CartChoices["slots"] = [];
  const seen = new Set<string>();
  for (const line of catalog.recipes.get(productId) ?? []) {
    if (line.kind !== "slot" || seen.has(line.groupId)) continue;
    const group = catalog.groups.get(line.groupId);
    if (!group || group.members.length === 0) continue;
    const member = defaultSlotMember(group, line);
    if (!member) continue;
    seen.add(line.groupId);
    slots.push({
      groupId: line.groupId, memberId: member.id, label: member.label, tier: member.tier, priceDelta: member.priceDelta,
    });
  }

  let sweetness: CartChoices["sweetness"] = null;
  const ps = catalog.productSweetness.get(productId);
  const level = ps ? defaultLevel(catalog.levels, ps) : null;
  if (ps && level) {
    if (level.isNone) {
      sweetness = { levelId: level.id, levelName: level.name, memberId: null, memberLabel: null };
    } else {
      const label = catalog.groups.get(ps.groupId)?.members.find((m) => m.id === ps.defaultMemberId)?.label ?? null;
      sweetness = { levelId: level.id, levelName: level.name, memberId: ps.defaultMemberId, memberLabel: label };
    }
  }
  return { slots, slotAddGroupIds: [], sweetness };
}

export type ChoicePart =
  /** count 2 = a doubled special, never a menu default */
  | { kind: "slot"; groupId: string; memberId: string; count?: number }
  | { kind: "level"; levelId: string }
  | { kind: "sweetener"; memberId: string | null };

/** True when `part` is what `defaults` (from defaultChoices) already has — the cart shows non-defaults bold. */
export function isDefaultChoice(defaults: CartChoices, part: ChoicePart): boolean {
  switch (part.kind) {
    case "slot":
      return part.count !== 2 && defaults.slots.some((s) => s.groupId === part.groupId && s.memberId === part.memberId);
    case "level":
      return defaults.sweetness?.levelId === part.levelId;
    case "sweetener":
      return defaults.sweetness !== null && defaults.sweetness.memberId === part.memberId;
  }
}
