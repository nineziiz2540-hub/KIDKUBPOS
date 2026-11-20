// The POS page's stock rows (round D1): what the option window needs to show bean/matcha and
// sweetness rows and to price specialty picks. Read with the signed-in user's client — Staff runs the
// POS — so every column here is one `authenticated` may still select after the stock lockdown
// (20261118160000: raw_materials only id/archived_at/…; the config tables keep tenant select).
// Explicit columns, never `*`, never a cost column. The client builds its catalog from these rows with
// buildStockCatalog, the same mapping the server prices with.
//
// A display subset of catalog.ts: slot lines only (no fixed lines), slot_add effects only, no
// sweetness amounts. Nothing on the POS deducts stock; the server re-resolves every line from its own
// full catalog. Filtered to the menus on sale / their options by posStockRows (pure, tested against
// the server's full catalog) rather than with long `in` lists.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { StockCatalogRows } from "@/lib/stock/catalog-build";
import { posStockRows } from "@/lib/stock/pos-stock";

/**
 * null = a query failed (logged): the POS then sells with no bean/sweetness rows and the server
 * applies each menu's defaults — selling never waits on stock data.
 */
export async function loadPosStockRows(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  productIds: string[],
  optionIds: string[]
): Promise<StockCatalogRows | null> {
  try {
    const [materials, recipes, groups, members, levels, productSweetness, effects, products, packagingSets, packagingItems] = await Promise.all([
      supabase.from("raw_materials").select("id, archived_at").eq("tenant_id", tenantId).is("archived_at", null).order("id"),
      supabase
        .from("product_recipes")
        .select("product_id, line_kind, raw_material_id, group_id, quantity_used, default_member_id, allow_special")
        .eq("tenant_id", tenantId)
        .eq("line_kind", "slot")
        .order("id"),
      supabase.from("choice_groups").select("id, kind, name, sort_order").eq("tenant_id", tenantId).order("sort_order").order("id"),
      supabase
        .from("choice_group_members")
        .select("id, group_id, raw_material_id, label, tier, price_delta, is_default, sort_order")
        .eq("tenant_id", tenantId)
        .order("sort_order")
        .order("id"),
      supabase
        .from("sweetness_levels")
        .select("id, name, is_none, is_default, sort_order")
        .eq("tenant_id", tenantId)
        .order("sort_order")
        .order("id"),
      supabase
        .from("product_sweetness")
        .select("product_id, group_id, default_member_id, allowed_member_ids, default_level_id, use_custom")
        .eq("tenant_id", tenantId)
        .order("product_id"),
      supabase
        .from("modifier_option_effects")
        .select("option_id, kind, group_id, raw_material_id, amount")
        .eq("tenant_id", tenantId)
        .eq("kind", "slot_add")
        .order("id"),
      // packaging: no cost anywhere here; Staff may read these columns
      supabase.from("products").select("id, packaging_set_id, house_glass_default").eq("tenant_id", tenantId),
      supabase.from("packaging_sets").select("id, name").eq("tenant_id", tenantId).is("archived_at", null).order("id"),
      supabase.from("packaging_set_items").select("set_id, raw_material_id, qty").eq("tenant_id", tenantId).order("set_id"),
    ]);

    const failed = [materials, recipes, groups, members, levels, productSweetness, effects, products, packagingSets, packagingItems].find((r) => r.error);
    if (failed?.error) {
      console.error("[loadPosStockRows] query failed:", failed.error.message);
      return null;
    }

    const rows = {
      materials: materials.data ?? [],
      recipes: recipes.data ?? [],
      groups: groups.data ?? [],
      members: members.data ?? [],
      levels: levels.data ?? [],
      amounts: [],
      productSweetness: productSweetness.data ?? [],
      optionEffects: effects.data ?? [],
      productPackaging: (products.data ?? []).map((p) => ({
        product_id: p.id, packaging_set_id: p.packaging_set_id, house_glass_default: p.house_glass_default,
      })),
      packagingSets: packagingSets.data ?? [],
      packagingItems: packagingItems.data ?? [],
    } as StockCatalogRows; // line_kind / kind / tier are text columns whose check constraints narrow them
    return posStockRows(rows, productIds, optionIds);
  } catch (e) {
    console.error("[loadPosStockRows] failed:", e instanceof Error ? e.message : e);
    return null;
  }
}
