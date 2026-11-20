// Server-side loader for the stock catalog (round D1). The pure row -> catalog mapping lives in
// catalog-build.ts; this file only reads rows. Explicit column lists, never `*`, and never a cost
// column: nothing read here may carry a price of stock.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { buildStockCatalog, type StockCatalogRows } from "@/lib/stock/catalog-build";
import type { StockCatalog } from "@/lib/stock/stock-core";

const FAIL = { error: "โหลดข้อมูลวัตถุดิบไม่สำเร็จ", retry: true } as const;

export async function loadStockCatalog(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  productIds: string[],
  optionIds: string[]
): Promise<{ catalog: StockCatalog } | { error: string; retry: true }> {
  const none = (ids: string[]) => ids.length === 0;

  const [materials, recipes, groups, members, levels, standard, custom, productSweetness, effects, productPackaging, packagingSets, packagingItems] =
    await Promise.all([
      // archived and unknown materials are treated the same by the builder, so skip reading archived ones
      supabase.from("raw_materials").select("id, archived_at").eq("tenant_id", tenantId).is("archived_at", null),
      none(productIds)
        ? null
        : supabase
            .from("product_recipes")
            .select("product_id, line_kind, raw_material_id, group_id, quantity_used, default_member_id, allow_special")
            .eq("tenant_id", tenantId)
            .in("product_id", productIds)
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
        .from("sweetness_amounts")
        .select("product_id, member_id, level_id, amount")
        .eq("tenant_id", tenantId)
        .is("product_id", null),
      none(productIds)
        ? null
        : supabase
            .from("sweetness_amounts")
            .select("product_id, member_id, level_id, amount")
            .eq("tenant_id", tenantId)
            .in("product_id", productIds),
      none(productIds)
        ? null
        : supabase
            .from("product_sweetness")
            .select("product_id, group_id, default_member_id, allowed_member_ids, default_level_id, use_custom")
            .eq("tenant_id", tenantId)
            .in("product_id", productIds),
      none(optionIds)
        ? null
        : supabase
            .from("modifier_option_effects")
            .select("option_id, kind, group_id, raw_material_id, amount")
            .eq("tenant_id", tenantId)
            .in("option_id", optionIds)
            .order("id"),
      none(productIds)
        ? null
        : supabase
            .from("products")
            .select("id, packaging_set_id, house_glass_default")
            .eq("tenant_id", tenantId)
            .in("id", productIds),
      supabase.from("packaging_sets").select("id, name").eq("tenant_id", tenantId).is("archived_at", null).order("id"),
      supabase.from("packaging_set_items").select("set_id, raw_material_id, qty").eq("tenant_id", tenantId).order("set_id"),
    ]);

  const all = [materials, recipes, groups, members, levels, standard, custom, productSweetness, effects, productPackaging, packagingSets, packagingItems];
  const failed = all.find((r) => r?.error);
  if (failed?.error) {
    console.error("[loadStockCatalog] query failed:", failed.error.message);
    return { ...FAIL };
  }

  const rows = {
    materials: materials.data ?? [],
    recipes: recipes?.data ?? [],
    groups: groups.data ?? [],
    members: members.data ?? [],
    levels: levels.data ?? [],
    amounts: [...(standard.data ?? []), ...(custom?.data ?? [])],
    productSweetness: productSweetness?.data ?? [],
    optionEffects: effects?.data ?? [],
    productPackaging: (productPackaging?.data ?? []).map((p) => ({
      product_id: p.id, packaging_set_id: p.packaging_set_id, house_glass_default: p.house_glass_default,
    })),
    packagingSets: packagingSets.data ?? [],
    packagingItems: packagingItems.data ?? [],
  } as StockCatalogRows; // line_kind / kind / tier are text columns whose check constraints narrow them
  return { catalog: buildStockCatalog(rows) };
}
