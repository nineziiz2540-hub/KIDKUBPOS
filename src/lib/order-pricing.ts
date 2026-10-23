import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CartItem } from "@/types/app";
import {
  MAX_LINES,
  MAX_OPTIONS_PER_LINE,
  MAX_QTY,
  priceLines,
  type CatalogModifier,
  type CatalogOption,
  type PricedLine,
} from "@/lib/order-pricing-core";

export type { PricedLine };

/**
 * Re-prices a cart entirely from the database. createOrder used to trust each CartItem's
 * totalPrice from the client, so anyone signed in could call the server action directly and
 * record a ฿1 latte. Here every product/option is looked up (tenant-scoped) and handed to
 * priceLines (src/lib/order-pricing-core.ts), which enforces option links and required/
 * single-select rules, recomputes totals in integer satang and rejects a client total that
 * differs.
 */
export async function priceCartItems(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  items: CartItem[]
): Promise<{ lines: PricedLine[]; subtotal: number } | { error: string }> {
  if (!Array.isArray(items) || items.length === 0) return { error: "ไม่มีสินค้าในตะกร้า" };
  if (items.length > MAX_LINES) return { error: "รายการในตะกร้ามากเกินไป" };

  for (const item of items) {
    if (
      typeof item?.productId !== "string" ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > MAX_QTY ||
      typeof item.totalPrice !== "number" ||
      !Array.isArray(item.selectedModifiers) ||
      item.selectedModifiers.length > MAX_OPTIONS_PER_LINE ||
      item.selectedModifiers.some((m) => typeof m?.optionId !== "string")
    ) {
      return { error: "ข้อมูลสินค้าในตะกร้าไม่ถูกต้อง" };
    }
  }

  const productIds = [...new Set(items.map((i) => i.productId))];
  const optionIds = [...new Set(items.flatMap((i) => i.selectedModifiers.map((m) => m.optionId)))];

  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, name, price, is_active, archived_at, categories(name)")
    .eq("tenant_id", tenantId)
    .in("id", productIds);
  if (productsError) return { error: "โหลดข้อมูลสินค้าไม่สำเร็จ" };
  const productMap = new Map((products ?? []).map((p) => [p.id, p]));

  const { data: links, error: linksError } = await supabase
    .from("product_modifiers")
    .select("product_id, modifier_id")
    .eq("tenant_id", tenantId)
    .in("product_id", productIds);
  if (linksError) return { error: "โหลดข้อมูลตัวเลือกไม่สำเร็จ" };
  const linkedModifiers = new Map<string, Set<string>>();
  for (const l of links ?? []) {
    if (!linkedModifiers.has(l.product_id)) linkedModifiers.set(l.product_id, new Set());
    linkedModifiers.get(l.product_id)!.add(l.modifier_id);
  }

  const allModifierIds = [...new Set((links ?? []).map((l) => l.modifier_id))];
  const modifierMap = new Map<string, CatalogModifier>();
  if (allModifierIds.length > 0) {
    const { data: modifiers, error: modifiersError } = await supabase
      .from("modifiers")
      .select("id, name, is_required, is_multi_select")
      .eq("tenant_id", tenantId)
      .in("id", allModifierIds);
    if (modifiersError) return { error: "โหลดข้อมูลตัวเลือกไม่สำเร็จ" };
    for (const m of modifiers ?? []) modifierMap.set(m.id, m);
  }

  const optionMap = new Map<string, CatalogOption>();
  if (optionIds.length > 0) {
    const { data: options, error: optionsError } = await supabase
      .from("modifier_options")
      .select("id, name, price_delta, modifier_id")
      .in("id", optionIds);
    if (optionsError) return { error: "โหลดข้อมูลตัวเลือกไม่สำเร็จ" };
    for (const o of options ?? []) optionMap.set(o.id, o);
  }

  return priceLines(items, {
    products: productMap,
    linkedModifiers,
    modifiers: modifierMap,
    options: optionMap,
  });
}
