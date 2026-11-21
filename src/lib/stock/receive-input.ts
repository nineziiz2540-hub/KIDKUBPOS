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
