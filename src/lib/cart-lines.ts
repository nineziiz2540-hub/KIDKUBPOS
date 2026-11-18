// Cart line bookkeeping for the POS (round D1). Pure. A line is "the same cup" when product, option
// ids, note and bean/sweetness ids all match (held-bill-diff's lineIdentity, the identity the
// held-bill audit already uses): only then does adding merge into it. Editing replaces a line.
import type { CartItem, ModifierWithOptions } from "../types/app.ts";
import { lineTotal } from "./cart-math.ts";
import { lineIdentity } from "./held-bill-diff.ts";
import { refreshChoices } from "./stock/option-window.ts";
import { defaultChoices } from "./stock/pos-choices.ts";
import type { StockCatalog } from "./stock/stock-core.ts";

/** The line at another quantity, its total re-priced (specialty price per cup included). */
export function withQuantity(line: CartItem, quantity: number): CartItem {
  return { ...line, quantity, totalPrice: lineTotal(line.basePrice, line.selectedModifiers, quantity, line.choices) };
}

/** Adds a line: an identical cup already in the cart gains the quantity, anything else is a new line. */
export function addLine(cart: CartItem[], item: CartItem): CartItem[] {
  const id = lineIdentity(item);
  const at = cart.findIndex((l) => lineIdentity(l) === id);
  if (at === -1) return [...cart, item];
  return cart.map((l, i) => (i === at ? withQuantity(l, l.quantity + item.quantity) : l));
}

/**
 * Save from the option window opened on a cart line: the edited cup takes that line's place, key and
 * quantity. It never merges into a neighbour, and a line that left the cart meanwhile (sale finished,
 * cart cleared) is not brought back.
 */
export function replaceLine(cart: CartItem[], key: string, edited: CartItem): CartItem[] {
  if (!cart.some((l) => l.cartItemKey === key)) return cart;
  return cart.map((l) => (l.cartItemKey === key ? withQuantity({ ...edited, cartItemKey: key }, l.quantity) : l));
}

/**
 * Saved lines (parked bill, restored draft) re-priced from the current menu, so paying is not refused
 * for a price the menu no longer has: menu price, option prices, and the bean/sweetness choices
 * refreshed from today's catalog (labels, tiers, specialty prices; a pick no longer offered → the menu
 * default). A menu no longer on sale is left untouched for the server to refuse with a clear message.
 * `catalog` null = this page could not load its stock data: the choices are kept as stored (the server
 * re-checks them). A line without choices (pre-D1) gets the menu defaults when the menu has option rows now, else stays without.
 */
export function repriceItems(
  items: CartItem[],
  products: { id: string; price: number }[],
  modifiers: ModifierWithOptions[],
  catalog: StockCatalog | null
): CartItem[] {
  return items.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    if (!product) return item;
    const selectedModifiers = item.selectedModifiers.map((m) => {
      const option = modifiers.find((mod) => mod.id === m.modifierId)?.options.find((o) => o.id === m.optionId);
      return option ? { ...m, priceDelta: option.priceDelta } : m;
    });
    let choices = item.choices;
    if (catalog) {
      // A line with no choices (pre-D1, or the menu had none then) gets today's menu defaults when the
      // menu has option rows now — what the server applies — so a later special default is not STALE.
      // A menu without option rows stays without choices.
      if (choices) choices = refreshChoices(item.productId, catalog, choices, selectedModifiers.map((m) => m.optionId));
      else {
        const d = defaultChoices(item.productId, catalog);
        if (d.slots.length > 0 || d.sweetness !== null) choices = d;
      }
    }
    const out: CartItem = {
      ...item,
      basePrice: product.price,
      selectedModifiers,
      totalPrice: lineTotal(product.price, selectedModifiers, item.quantity, choices),
    };
    if (choices) out.choices = choices;
    return out;
  });
}
