// "รับของเข้า" on the POS (round D2a, Task 12): the amount the staff typed -> the use unit the server stores.
import { entryToBaseQty } from "./material-view.ts";

/**
 * 6 ขวด x 2,000 ml = 12,000 ml; the use unit passes through; no purchase size = already the use unit.
 * `amount` is the whole entry (number pad + ¼ ½ ¾). null = nothing to save (0 or less).
 * The D1 unit maths (units.ts toBaseQty) does the multiplying.
 */
export function receiveAmountToUseUnits(
  amount: number,
  unit: "purchase" | "use",
  material: { purchaseSize: number | null }
): number | null {
  return entryToBaseQty(amount, unit === "purchase" ? material.purchaseSize : null);
}

/** The most one receive takes, in the use unit: stock_receive accepts qty < 10,000,000 (3 decimals at most). */
export const RECEIVE_MAX_QTY = 9_999_999.999;

export const AMOUNT_PROBLEM = "ใส่จำนวนให้ถูกต้อง";

/**
 * Why an amount cannot be saved, in the use unit: null = fine (or nothing typed yet, the button just stays off).
 * `qty` is null when the entry is 0 or less; `typed` = something was pressed on the pad or a ¼ ½ ¾ chip.
 */
export function amountProblem(qty: number | null, max: number, typed: boolean): string | null {
  if (qty === null) return typed ? AMOUNT_PROBLEM : null;
  if (qty > max || Math.round(qty * 1000) / 1000 !== qty) return AMOUNT_PROBLEM;
  return null;
}
