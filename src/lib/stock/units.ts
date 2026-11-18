// Pure unit maths for stock receiving (round D1). No I/O; callers validate input first and the
// SQL function owns the real write, so bad arguments here are programmer errors (RangeError).

function assertFinite(...values: number[]): void {
  for (const v of values) if (!Number.isFinite(v)) throw new RangeError(`not a finite number: ${v}`);
}

/** Purchase units → base units (e.g. 6 ขวด × 2,000 ml = 12,000 ml). No size = already base units. */
export function toBaseQty(purchaseQty: number, purchaseSize: number | null): number {
  assertFinite(purchaseQty);
  if (purchaseQty <= 0) throw new RangeError("purchaseQty must be > 0");
  if (purchaseSize === null) return Math.round(purchaseQty * 1000) / 1000;
  assertFinite(purchaseSize);
  if (purchaseSize <= 0) throw new RangeError("purchaseSize must be > 0");
  return Math.round(purchaseQty * purchaseSize * 1000) / 1000;
}

/** Moving-average cost per base unit after receiving `qty` at `unitCost`. Balance ≤ 0 → unitCost (spec §6.1: "ถ้ายอดคงเหลือ ≤ 0 ใช้ราคาล่าสุด"). */
export function movingAverage(balance: number, avgCost: number, qty: number, unitCost: number): number {
  assertFinite(balance, avgCost, qty, unitCost);
  if (qty <= 0) throw new RangeError("qty must be > 0");
  if (unitCost < 0) throw new RangeError("unitCost must be >= 0");
  if (avgCost < 0) throw new RangeError("avgCost must be >= 0");
  if (balance <= 0) return unitCost;
  return (balance * avgCost + qty * unitCost) / (balance + qty);
}
