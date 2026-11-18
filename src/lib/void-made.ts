// "Was the drink made?" on a void: the dialog's state becomes the p_made object order_void expects
// ({ "<order_item_id>": "all" | "none" | <cups made> } for every item). Pure so it can be tested
// without the UI. The database re-validates everything; this only shapes the answer.

export type MadeMode = "none" | "all" | "some";
export type VoidItem = { id: string; quantity: number };
export type MadeValue = "all" | "none" | number;

/** Cups made for a line in "some" mode, kept to a whole number from 0 to the line's quantity. */
export function clampMade(count: number | undefined, quantity: number): number {
  if (typeof count !== "number" || !Number.isFinite(count)) return 0;
  return Math.min(Math.max(Math.trunc(count), 0), quantity);
}

export function buildMade(
  mode: MadeMode,
  counts: Record<string, number>,
  items: VoidItem[]
): Record<string, MadeValue> {
  const out: Record<string, MadeValue> = {};
  for (const item of items) {
    if (mode === "all") out[item.id] = "all";
    else if (mode === "none") out[item.id] = "none";
    else out[item.id] = clampMade(counts[item.id], item.quantity);
  }
  return out;
}

/** Total cups on the bill: the "some" choice is only offered when this is above 1. */
export function totalCups(items: VoidItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}

/** Is the answer a real one? Nothing chosen is not an answer, and "some" with every counter at 0
 *  would silently restock everything, so it needs at least one cup made. */
export function isMadeComplete(
  mode: MadeMode | null,
  counts: Record<string, number>,
  items: VoidItem[]
): boolean {
  if (mode === null) return false;
  if (mode !== "some") return true;
  return items.some((i) => clampMade(counts[i.id], i.quantity) > 0);
}
