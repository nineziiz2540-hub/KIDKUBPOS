// The pure half of server-side re-pricing: given a cart and the catalog rows already fetched for
// it (tenant-scoped, see src/lib/order-pricing.ts), recompute every line in integer satang and
// enforce option links and required/single-select rules. No database access here, so the rules
// can be unit-tested.
import type { CartItem } from "../types/app.ts";
import { toSatang } from "./cash.ts";
import { MAX_NOTE_LENGTH, normalizeNote } from "./notes.ts";

export const MAX_LINES = 100;
export const MAX_QTY = 999;
export const MAX_OPTIONS_PER_LINE = 20;

export const STALE = "ราคาหรือเมนูมีการเปลี่ยนแปลง กรุณารีเฟรชหน้า POS แล้วลองใหม่";

export type PricedLine = {
  productId: string;
  productName: string;
  categoryName: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  modifiersSnapshot: { group: string; option: string; priceDelta: number }[] | null;
  note: string | null;
};

export type CatalogProduct = {
  id: string;
  name: string;
  price: number;
  is_active: boolean;
  archived_at: string | null;
  categories: unknown;
};
export type CatalogModifier = {
  id: string;
  name: string;
  is_required: boolean;
  is_multi_select: boolean;
};
export type CatalogOption = {
  id: string;
  name: string;
  price_delta: number | null;
  modifier_id: string;
};

export type PricingCatalog = {
  products: Map<string, CatalogProduct>;
  /** product id → ids of the modifiers linked to it */
  linkedModifiers: Map<string, Set<string>>;
  /** only this tenant's modifiers linked to the cart's products */
  modifiers: Map<string, CatalogModifier>;
  options: Map<string, CatalogOption>;
};

/**
 * One cart line priced from the catalog alone (its unit price in satang and the option snapshot),
 * enforcing that the product is on sale and the option links and required/single-select rules.
 */
function catalogLine(
  item: CartItem,
  catalog: PricingCatalog
):
  | { product: CatalogProduct; unitSatang: number; snapshot: NonNullable<PricedLine["modifiersSnapshot"]> }
  | { error: string } {
  const product = catalog.products.get(item.productId);
  if (!product || !product.is_active || product.archived_at !== null) return { error: STALE };

  const linked = catalog.linkedModifiers.get(product.id) ?? new Set<string>();
  const chosenPerModifier = new Map<string, number>();
  const snapshot: NonNullable<PricedLine["modifiersSnapshot"]> = [];
  let unitSatang = toSatang(Number(product.price));

  const seen = new Set<string>();
  for (const sel of item.selectedModifiers) {
    if (seen.has(sel.optionId)) return { error: "ข้อมูลสินค้าในตะกร้าไม่ถูกต้อง" };
    seen.add(sel.optionId);
    const option = catalog.options.get(sel.optionId);
    // catalog.modifiers only holds this tenant's modifiers linked to cart products, so an option
    // from another tenant or an unlinked modifier fails here too.
    const modifier = option ? catalog.modifiers.get(option.modifier_id) : undefined;
    if (!option || !modifier || !linked.has(modifier.id)) return { error: STALE };
    chosenPerModifier.set(modifier.id, (chosenPerModifier.get(modifier.id) ?? 0) + 1);
    const delta = Number(option.price_delta ?? 0);
    unitSatang += toSatang(delta);
    snapshot.push({ group: modifier.name, option: option.name, priceDelta: delta });
  }

  for (const modifierId of linked) {
    const modifier = catalog.modifiers.get(modifierId);
    if (!modifier) continue;
    const count = chosenPerModifier.get(modifierId) ?? 0;
    if (modifier.is_required && count === 0) return { error: STALE };
    if (!modifier.is_multi_select && count > 1) return { error: "ข้อมูลสินค้าในตะกร้าไม่ถูกต้อง" };
  }

  if (unitSatang < 0) return { error: STALE };
  return { product, unitSatang, snapshot };
}

function categoryName(product: CatalogProduct): string | null {
  return (product.categories as { name: string } | null)?.name ?? null;
}

/**
 * Re-prices already-shape-checked cart lines against the catalog. The client's own totalPrice
 * must match the recomputed one — a mismatch means either tampering or a POS tab showing stale
 * prices, and in both cases charging a different amount than the cashier saw would be wrong.
 */
export function priceLines(
  items: CartItem[],
  catalog: PricingCatalog
): { lines: PricedLine[]; subtotal: number } | { error: string } {
  const lines: PricedLine[] = [];
  let subtotalSatang = 0;

  for (const item of items) {
    const normalizedNote = normalizeNote(item.note);
    if (!normalizedNote.ok) return { error: "หมายเหตุไม่ถูกต้อง (ไม่เกิน 200 ตัวอักษร)" };
    const priced = catalogLine(item, catalog);
    if ("error" in priced) return priced;
    const { product, unitSatang, snapshot } = priced;

    const lineSatang = unitSatang * item.quantity;
    if (toSatang(item.totalPrice) !== lineSatang) return { error: STALE };

    subtotalSatang += lineSatang;
    lines.push({
      productId: product.id,
      productName: product.name,
      categoryName: categoryName(product),
      quantity: item.quantity,
      unitPrice: unitSatang / 100,
      lineTotal: lineSatang / 100,
      modifiersSnapshot: snapshot.length > 0 ? snapshot : null,
      note: normalizedNote.note,
    });
  }

  return { lines, subtotal: subtotalSatang / 100 };
}

/**
 * "Record as charged" (round C2, spec call 9): an offline bill a manager approves as the customer
 * was charged. Each line keeps the device's totalPrice and option prices; product, category and
 * option names come from the catalog where it still has them. It never rejects a price mismatch.
 * serverSubtotal is what the catalog would charge today, or null when any line can't be priced
 * from it (archived, off sale, an option gone). Only a product missing from the catalog (deleted)
 * stops it: order_items.product_id must reference a real product.
 */
export function priceLinesAsCharged(
  items: CartItem[],
  catalog: PricingCatalog
): { lines: PricedLine[]; subtotal: number; serverSubtotal: number | null } | { error: "product_missing" } {
  const lines: PricedLine[] = [];
  let subtotalSatang = 0;
  let serverSatang: number | null = 0;

  for (const item of items) {
    const product = catalog.products.get(item.productId);
    if (!product) return { error: "product_missing" };

    const server = catalogLine(item, catalog);
    if ("error" in server || serverSatang === null) serverSatang = null;
    else serverSatang += server.unitSatang * item.quantity;

    const lineSatang = toSatang(item.totalPrice);
    subtotalSatang += lineSatang;
    const snapshot = item.selectedModifiers.map((sel) => {
      const option = catalog.options.get(sel.optionId);
      const modifier = option ? catalog.modifiers.get(option.modifier_id) : undefined;
      const delta = Number(sel.priceDelta);
      return {
        group: modifier?.name ?? String(sel.modifierName ?? ""),
        option: option?.name ?? String(sel.optionName ?? ""),
        priceDelta: Number.isFinite(delta) ? delta : 0,
      };
    });
    const note = typeof item.note === "string" ? item.note.trim().slice(0, MAX_NOTE_LENGTH) : "";

    lines.push({
      productId: product.id,
      productName: product.name,
      categoryName: categoryName(product),
      quantity: item.quantity,
      unitPrice: Math.round(lineSatang / item.quantity) / 100,
      lineTotal: lineSatang / 100,
      modifiersSnapshot: snapshot.length > 0 ? snapshot : null,
      note: note !== "" ? note : null,
    });
  }

  return {
    lines,
    subtotal: subtotalSatang / 100,
    serverSubtotal: serverSatang === null ? null : serverSatang / 100,
  };
}
