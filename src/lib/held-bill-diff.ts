import type { CartItem } from "@/types/app";
import { choiceKey } from "./choice-key.ts";

export type Reduction = {
  name: string;
  options: string[];
  note: string | null;
  fromQty: number;
  toQty: number;
};

/**
 * What a cup *is*, independent of cart line keys (which change when lines merge/split or a note
 * is added): same product + same options + same note = same thing.
 */
export function lineIdentity(
  item: Pick<CartItem, "productId" | "selectedModifiers" | "note" | "choices">,
): string {
  const options = item.selectedModifiers.map((m) => m.optionId).sort().join(",");
  const base = `${item.productId}|${options}|${item.note ?? ""}`;
  // Only when present: an item without choices keeps exactly its pre-D1 identity. With choices the
  // identity is a JSON array, so free text in the note can never imitate the choice segment.
  return item.choices
    ? JSON.stringify([item.productId, options, item.note ?? "", choiceKey(item.choices)])
    : base;
}

/** The names the owner reads for a line: option names, then (if any) bean/matcha and sweetness. */
function optionNames(item: CartItem): string[] {
  const names = item.selectedModifiers.map((m) => m.optionName);
  const c = item.choices;
  if (!c) return names;
  for (const s of c.slots) names.push(s.label);
  if (c.sweetness) {
    names.push(c.sweetness.levelName);
    if (c.sweetness.memberLabel !== null) names.push(c.sweetness.memberLabel);
  }
  return names;
}

/**
 * Every identity whose total quantity went down between `before` and `after` (toQty 0 when it's
 * gone). Used server-side to audit held-bill edits — a cashier removing cups from a parked,
 * unpaid bill is the move that could hide pocketed cash, so it's recorded, never trusted from the
 * client. Changing a note counts as reducing the old identity (and adding a new one).
 */
export function diffReductions(before: CartItem[], after: CartItem[]): Reduction[] {
  const afterQty = new Map<string, number>();
  for (const item of after) {
    const key = lineIdentity(item);
    afterQty.set(key, (afterQty.get(key) ?? 0) + item.quantity);
  }

  const beforeAgg = new Map<string, { item: CartItem; qty: number }>();
  for (const item of before) {
    const key = lineIdentity(item);
    const prev = beforeAgg.get(key);
    beforeAgg.set(key, { item: prev?.item ?? item, qty: (prev?.qty ?? 0) + item.quantity });
  }

  const reductions: Reduction[] = [];
  for (const [key, { item, qty }] of beforeAgg) {
    const toQty = afterQty.get(key) ?? 0;
    if (toQty < qty) {
      reductions.push({
        name: item.name,
        options: optionNames(item),
        note: item.note ?? null,
        fromQty: qty,
        toQty,
      });
    }
  }
  return reductions;
}
