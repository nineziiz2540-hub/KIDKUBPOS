// Carry-out bags (round D2a). Pure. Bags are a bill-level stock deduction (one count per bill, not per
// cup); they never change the price.

export const MAX_BAGS = 99;

/** The bag count suggested for a bill: one bag per `bagsPerCups` cups, rounded up, capped at MAX_BAGS (a bigger count would be refused); 0 when the shop has no rule. */
export function defaultBags(cups: number, bagsPerCups: number | null): number {
  return bagsPerCups ? Math.min(MAX_BAGS, Math.ceil(cups / bagsPerCups)) : 0;
}

/** The bill-level stock lines for a bag count: none without a bag material or without bags. */
export function billStockLines(bags: number, bagMaterialId: string | null): { materialId: string; qty: number }[] {
  if (!bagMaterialId || bags <= 0) return [];
  return [{ materialId: bagMaterialId, qty: bags }];
}

/** Client input → a bag count 0..99, absent = 0; anything else (fraction, negative, string, > 99) → null. */
export function validBags(x: unknown): number | null {
  if (x === undefined) return 0;
  return typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= MAX_BAGS ? x : null;
}

/** The bags/stock part of order_record's p_order (snake_case keys, like the D1 item lines). */
export function billStockPayload(bags: number, bagMaterialId: string | null) {
  return {
    bags,
    stock: billStockLines(bags, bagMaterialId).map((s) => ({ material_id: s.materialId, qty: s.qty })),
  };
}

/** The count the counter shows: the cashier's own value once they tapped − or +, else the automatic one. */
export function shownBags(manual: number | null, cups: number, bagsPerCups: number | null): number {
  return manual ?? defaultBags(cups, bagsPerCups);
}

/** One tap on − or +: stops at 0 and at MAX_BAGS. */
export function stepBags(current: number, delta: 1 | -1): number {
  return Math.max(0, Math.min(MAX_BAGS, current + delta));
}

/** A restored draft's count: above 0 it was the cashier's; 0 goes back to automatic. */
export function manualFromDraft(bags: number): number | null {
  return bags > 0 ? bags : null;
}
