// The pure half of server-side re-pricing: given a cart and the catalog rows already fetched for
// it (tenant-scoped, see src/lib/order-pricing.ts), recompute every line in integer satang and
// enforce option links and required/single-select rules. No database access here, so the rules
// can be unit-tested.
import type { CartItem } from "../types/app.ts";
import { toSatang } from "./cash.ts";
import { normalizeNote } from "./notes.ts";

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
    const product = catalog.products.get(item.productId);
    if (!product || !product.is_active || product.archived_at !== null) return { error: STALE };

    const linked = catalog.linkedModifiers.get(product.id) ?? new Set<string>();
    const chosenPerModifier = new Map<string, number>();
    const snapshot: PricedLine["modifiersSnapshot"] = [];
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
    const lineSatang = unitSatang * item.quantity;
    if (toSatang(item.totalPrice) !== lineSatang) return { error: STALE };

    subtotalSatang += lineSatang;
    const category = product.categories as { name: string } | null;
    lines.push({
      productId: product.id,
      productName: product.name,
      categoryName: category?.name ?? null,
      quantity: item.quantity,
      unitPrice: unitSatang / 100,
      lineTotal: lineSatang / 100,
      modifiersSnapshot: snapshot.length > 0 ? snapshot : null,
      note: normalizedNote.note,
    });
  }

  return { lines, subtotal: subtotalSatang / 100 };
}
