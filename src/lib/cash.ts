// Cash-tender math shared by the POS cash modal and createOrder. Everything is compared in whole
// satang (integer) rather than baht floats: a percent discount can leave a total like 85.5 stored
// as 85.49999999999999 in JS, and a float `>=` against that would wrongly reject exact payment.

/** Mirrors the orders_cash_tendered_check upper bound in the database. */
export const MAX_CASH_RECEIVED = 1_000_000;

/** Thai banknotes, used to suggest one-tap amounts the customer is likely to hand over. */
const BANKNOTES = [20, 50, 100, 500, 1000] as const;

export function toSatang(baht: number): number {
  return Math.round(baht * 100);
}

/**
 * Display a baht amount without hiding satang: whole amounts stay short ("85"), anything with
 * satang shows both decimals ("45.50"). Replaces toFixed(0), which rounded ฿45.50 up to "46"
 * in the cart while the cash modal (correctly) asked for ฿45.50.
 */
export function formatPrice(baht: number): string {
  const satang = toSatang(baht);
  return (satang / 100).toFixed(satang % 100 === 0 ? 0 : 2);
}

/**
 * Change owed for `cashReceived` against `total`, in baht rounded to satang — or null when the
 * amount is missing, not a number, less than the total, or over MAX_CASH_RECEIVED.
 */
export function computeChange(total: number, cashReceived: number): number | null {
  if (!Number.isFinite(total) || !Number.isFinite(cashReceived)) return null;
  const totalSatang = toSatang(total);
  const receivedSatang = toSatang(cashReceived);
  if (receivedSatang < totalSatang) return null;
  if (receivedSatang > toSatang(MAX_CASH_RECEIVED)) return null;
  return (receivedSatang - totalSatang) / 100;
}

/**
 * Up to 4 distinct amounts above `total` that a customer would plausibly pay with: the total
 * rounded up to each banknote size (e.g. ฿85 → ฿100, ฿500, ฿1000; ฿135 → ฿140, ฿150, ฿200, ฿500).
 * The exact amount itself is offered separately by the modal as "พอดี".
 */
export function suggestCashAmounts(total: number): number[] {
  const totalSatang = toSatang(total);
  const amounts = new Set<number>();
  for (const note of BANKNOTES) {
    const noteSatang = note * 100;
    const rounded = Math.ceil(totalSatang / noteSatang) * noteSatang;
    if (rounded > totalSatang && rounded <= toSatang(MAX_CASH_RECEIVED)) {
      amounts.add(rounded / 100);
    }
  }
  return [...amounts].sort((a, b) => a - b).slice(0, 4);
}
