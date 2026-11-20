// A parked bill's items, rebuilt from the server's pricing. Lives outside held-bills.ts because a
// "use server" file may only export async actions.
import type { CartChoices, CartItem } from "../types/app.ts";
import type { PricedLine } from "./order-pricing-core.ts";

/**
 * Stored items are rebuilt from the server's pricing so the snapshot (and therefore the audit log
 * that diffs it) carries real product/option names, prices and bean/sweetness choices, not whatever
 * the client sent. basePrice is the menu price, so reopening the bill re-adds the specialty bean
 * price (from choices) exactly once.
 */
export function normalizeHeldItems(input: CartItem[], lines: PricedLine[]): CartItem[] {
  return input.map((item, i) => {
    const line = lines[i]!;
    const out: CartItem = {
      cartItemKey: item.cartItemKey,
      productId: line.productId,
      name: line.productName,
      basePrice: line.basePrice,
      quantity: line.quantity,
      selectedModifiers: item.selectedModifiers.map((m, j) => ({
        modifierId: m.modifierId,
        optionId: m.optionId,
        modifierName: line.modifiersSnapshot?.[j]?.group ?? m.modifierName,
        optionName: line.modifiersSnapshot?.[j]?.option ?? m.optionName,
        priceDelta: line.modifiersSnapshot?.[j]?.priceDelta ?? 0,
      })),
      totalPrice: line.lineTotal,
      note: line.note,
    };
    // No choices key at all for pre-D1 items, so their stored JSON is unchanged.
    if (item.choices) out.choices = choicesFromSnapshot(line);
    // House glass is the cashier's own toggle: a parked bill keeps it (absent = the menu default).
    if (typeof item.houseGlass === "boolean") out.houseGlass = item.houseGlass;
    return out;
  });
}

function choicesFromSnapshot(line: PricedLine): CartChoices {
  const snap = line.choicesSnapshot;
  return {
    slots: snap.slots.map((s) => ({
      groupId: s.groupId, memberId: s.memberId, label: s.label, tier: s.tier, priceDelta: s.priceDelta,
      ...(s.count === 2 ? { count: 2 as const } : {}),
      // the client copy never carries a material id
      ...(s.shot ? { shot: { memberId: s.shot.memberId, label: s.shot.label, optionIds: [...s.shot.optionIds] } } : {}),
    })),
    slotAddGroupIds: [...snap.slotAddGroupIds],
    sweetness: snap.sweetness
      ? {
          levelId: snap.sweetness.levelId,
          levelName: snap.sweetness.levelName,
          memberId: snap.sweetness.memberId,
          memberLabel: snap.sweetness.label,
        }
      : null,
  };
}
