// The POS's stock data (round D1), pure: which rows the POS page sends to the device, and the catalog
// the device builds from them. No I/O, no Next.js/Supabase/React imports.
import { buildStockCatalog, type StockCatalogRows } from "./catalog-build.ts";
import { emptyStockCatalog, type StockCatalog } from "./stock-core.ts";

/**
 * The server's rows narrowed to what the POS sells: every recipe line (fixed and slot), product
 * sweetness and per-menu sweetness amounts of the menus on sale (the shop's standard amounts too),
 * and every effect (slot_add and material_add) of the options offered with them. Round D2a: the device
 * computes availability ("หมด?/เหลือ ~N แก้ว") and the offline stock decrement from per-cup needs, so
 * it needs the full per-cup stock rows; the server still resolves the authoritative stock for every
 * sale, and prices do not depend on the extra rows. The page reads with explicit columns and a tenant
 * filter (pos-catalog.ts) — never a cost column — and this is the rule it ends with.
 */
export function posStockRows(rows: StockCatalogRows, productIds: string[], optionIds: string[]): StockCatalogRows {
  const onSale = new Set(productIds);
  const offered = new Set(optionIds);
  return {
    materials: rows.materials,
    recipes: rows.recipes.filter((r) => onSale.has(r.product_id)),
    groups: rows.groups,
    members: rows.members,
    levels: rows.levels,
    amounts: rows.amounts.filter((a) => a.product_id === null || onSale.has(a.product_id)),
    productSweetness: rows.productSweetness.filter((p) => onSale.has(p.product_id)),
    optionEffects: rows.optionEffects.filter((e) => offered.has(e.option_id)),
    productPackaging: rows.productPackaging.filter((p) => onSale.has(p.product_id)),
    packagingSets: rows.packagingSets,
    packagingItems: rows.packagingItems,
  };
}

/** The device's catalog; `loaded` false = the rows did not arrive or could not be built. */
export type PosStock = { catalog: StockCatalog; loaded: boolean };

/**
 * Rows → catalog with the server's own builder. null rows (a query failed on the server) or a builder
 * throw → not loaded, with an empty catalog: menus sell with no bean/sweetness rows and the server
 * applies each menu's defaults.
 */
export function posStock(rows: StockCatalogRows | null, onError?: (error: unknown) => void): PosStock {
  if (rows === null) return { catalog: emptyStockCatalog(), loaded: false };
  try {
    return { catalog: buildStockCatalog(rows), loaded: true };
  } catch (error) {
    onError?.(error);
    return { catalog: emptyStockCatalog(), loaded: false };
  }
}

/**
 * The catalog saved lines are refreshed against, or null when it did not load: their choices are then
 * kept exactly as stored (repriceItems), never wiped to an empty catalog's "nothing to choose".
 */
export function refreshCatalogOf(stock: PosStock): StockCatalog | null {
  return stock.loaded ? stock.catalog : null;
}
