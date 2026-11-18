// Cost frozen at sale (round D1). Pure; no I/O.

/**
 * Cost frozen at sale: sums order_items.cost_total. `missingLines` = lines with no cost (not zero cost).
 * cost_total is already the whole line's cost (all cups), so no quantity is taken or multiplied.
 */
export function sumCost(rows: { cost_total: number | string | null }[]): { cost: number; missingLines: number } {
  let cost = 0;
  let missingLines = 0;
  for (const row of rows) {
    const raw = row.cost_total;
    // "" and whitespace would otherwise coerce to 0 and pass as a real zero cost
    const blank = raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");
    const n = blank ? NaN : Number(raw);
    if (!Number.isFinite(n)) missingLines += 1;
    else cost += n;
  }
  return { cost, missingLines };
}
