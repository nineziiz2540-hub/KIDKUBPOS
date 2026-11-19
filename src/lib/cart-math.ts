// Cart line maths for the POS, in whole satang like src/lib/cash.ts: the server re-prices every
// line in satang (src/lib/order-pricing-core.ts) and rejects a client total that differs, so a
// float sum like 0.30000000000000004 here would turn into a refused sale there.
import type { CartChoices } from "../types/app.ts";
import { toSatang } from "./cash.ts";
import { cupPriceDeltaSatang } from "./stock/stock-core.ts";

function unitSatang(
  basePrice: number,
  modifiers: { priceDelta: number }[],
  choices?: CartChoices
): number {
  const specialty = choices ? cupPriceDeltaSatang(choices.slots) : 0;
  return modifiers.reduce((sum, m) => sum + toSatang(m.priceDelta), toSatang(basePrice)) + specialty;
}

/** Price of one unit: the menu price plus every chosen option's delta plus any specialty bean price (twice when doubled). */
export function unitPrice(
  basePrice: number,
  modifiers: { priceDelta: number }[],
  choices?: CartChoices
): number {
  return unitSatang(basePrice, modifiers, choices) / 100;
}

/** A cart line's total: unit price × quantity. */
export function lineTotal(
  basePrice: number,
  modifiers: { priceDelta: number }[],
  quantity: number,
  choices?: CartChoices
): number {
  return (unitSatang(basePrice, modifiers, choices) * quantity) / 100;
}

/** Sum of the cart's line totals. */
export function cartSubtotal(items: { totalPrice: number }[]): number {
  return items.reduce((sum, item) => sum + toSatang(item.totalPrice), 0) / 100;
}
