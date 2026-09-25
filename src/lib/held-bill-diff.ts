import type { CartItem } from "@/types/app";

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
export function lineIdentity(item: Pick<CartItem, "productId" | "selectedModifiers" | "note">): string {
  const options = item.selectedModifiers.map((m) => m.optionId).sort().join(",");
  return `${item.productId}|${options}|${item.note ?? ""}`;
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
        options: item.selectedModifiers.map((m) => m.optionName),
        note: item.note ?? null,
        fromQty: qty,
        toQty,
      });
    }
  }
  return reductions;
}
