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

/** A receive the server may save: the use-unit amount, the price (owner/manager only) and an optional note. */
export type ReceiveFields = { materialId: string; quantity: number; totalPrice: number | null; note: string | null };

function toNumber(v: unknown): number {
  return typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
}

/**
 * The receive's fields with the checks and the Thai of D1's `receiveStock` action, in its order. `get`
 * reads the inventory form (FormData: strings) or the POS's JSON body (numbers): both end up here, so
 * both are checked alike. The price only counts when `canPrice` (owner or manager); a staff price is
 * ignored, never refused.
 */
export function parseReceiveFields(get: (key: string) => unknown, canPrice: boolean): { value: ReceiveFields } | { error: string } {
  const noteRaw = get("note");
  const note = typeof noteRaw === "string" && noteRaw.trim() !== "" ? noteRaw.trim() : null;
  if (note !== null && note.length > 500) return { error: "หมายเหตุยาวเกินไป (ไม่เกิน 500 ตัวอักษร)" };

  const materialId = get("raw_material_id");
  if (typeof materialId !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  const quantity = toNumber(get("quantity"));
  if (!Number.isFinite(quantity) || quantity <= 0) return { error: "กรุณากรอกจำนวนที่ถูกต้อง (> 0)" };

  let totalPrice: number | null = null;
  const priceRaw = get("total_price");
  if (canPrice && ((typeof priceRaw === "string" && priceRaw.trim() !== "") || typeof priceRaw === "number")) {
    totalPrice = toNumber(priceRaw);
    if (!Number.isFinite(totalPrice) || totalPrice < 0) return { error: "กรุณากรอกราคาที่ถูกต้อง" };
  }
  return { value: { materialId, quantity, totalPrice, note } };
}

/**
 * Why an amount cannot be saved, in the use unit: null = fine (or nothing typed yet, the button just stays off).
 * `qty` is null when the entry is 0 or less; `typed` = something was pressed on the pad or a ¼ ½ ¾ chip.
 */
export function amountProblem(qty: number | null, max: number, typed: boolean): string | null {
  if (qty === null) return typed ? AMOUNT_PROBLEM : null;
  if (qty > max || Math.round(qty * 1000) / 1000 !== qty) return AMOUNT_PROBLEM;
  return null;
}
