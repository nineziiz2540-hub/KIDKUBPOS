// Cart line maths for the POS, in whole satang like src/lib/cash.ts: the server re-prices every
// line in satang (src/lib/order-pricing-core.ts) and rejects a client total that differs, so a
// float sum like 0.30000000000000004 here would turn into a refused sale there.
import { toSatang } from "./cash.ts";

function unitSatang(basePrice: number, modifiers: { priceDelta: number }[]): number {
  return modifiers.reduce((sum, m) => sum + toSatang(m.priceDelta), toSatang(basePrice));
}

/** Price of one unit: the menu price plus every chosen option's delta. */
export function unitPrice(basePrice: number, modifiers: { priceDelta: number }[]): number {
  return unitSatang(basePrice, modifiers) / 100;
}

/** A cart line's total: unit price × quantity. */
export function lineTotal(
  basePrice: number,
  modifiers: { priceDelta: number }[],
  quantity: number
): number {
  return (unitSatang(basePrice, modifiers) * quantity) / 100;
}

/** Sum of the cart's line totals. */
export function cartSubtotal(items: { totalPrice: number }[]): number {
  return items.reduce((sum, item) => sum + toSatang(item.totalPrice), 0) / 100;
}
