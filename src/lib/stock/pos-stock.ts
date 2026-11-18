// The POS's stock data (round D1), pure: which rows the POS page sends to the device, and the catalog
// the device builds from them. No I/O, no Next.js/Supabase/React imports.
import { buildStockCatalog, type StockCatalogRows } from "./catalog-build.ts";
import { emptyStockCatalog, type StockCatalog } from "./stock-core.ts";

/**
 * The display subset of the server's rows for the POS: recipe slot lines and product sweetness of
 * the menus on sale, slot_add effects of the options offered with them, no sweetness amounts. That is
 * all the option window and the cart price need (fixed lines, material_add effects and amounts only
 * change stock, which the server resolves from its own full catalog). The page reads less still —
 * explicit columns, tenant filter (pos-catalog.ts) — and this is the rule it ends with.
 */
export function posStockRows(rows: StockCatalogRows, productIds: string[], optionIds: string[]): StockCatalogRows {
  const onSale = new Set(productIds);
  const offered = new Set(optionIds);
  return {
    materials: rows.materials,
    recipes: rows.recipes.filter((r) => r.line_kind === "slot" && onSale.has(r.product_id)),
    groups: rows.groups,
    members: rows.members,
    levels: rows.levels,
    amounts: [],
    productSweetness: rows.productSweetness.filter((p) => onSale.has(p.product_id)),
    optionEffects: rows.optionEffects.filter((e) => e.kind === "slot_add" && offered.has(e.option_id)),
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
