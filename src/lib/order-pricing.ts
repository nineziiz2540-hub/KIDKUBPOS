import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CartItem } from "@/types/app";
import { toSatang } from "@/lib/cash";

const MAX_LINES = 100;
const MAX_QTY = 999;
const MAX_OPTIONS_PER_LINE = 20;

export type PricedLine = {
  productId: string;
  productName: string;
  categoryName: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  modifiersSnapshot: { group: string; option: string; priceDelta: number }[] | null;
};

const STALE = "ราคาหรือเมนูมีการเปลี่ยนแปลง กรุณารีเฟรชหน้า POS แล้วลองใหม่";

/**
 * Re-prices a cart entirely from the database. createOrder used to trust each CartItem's
 * totalPrice from the client, so anyone signed in could call the server action directly and
 * record a ฿1 latte. Here every product/option is looked up (tenant-scoped), option links and
 * required/single-select rules are enforced, and totals are recomputed in integer satang. The
 * client's own totalPrice must match the recomputed one — a mismatch means either tampering or a
 * POS tab showing stale prices, and in both cases charging a different amount than the cashier saw
 * would be wrong, so the sale is rejected instead.
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
    .select("id, name, price, is_active, categories(name)")
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
  const modifierMap = new Map<
    string,
    { id: string; name: string; is_required: boolean; is_multi_select: boolean }
  >();
  if (allModifierIds.length > 0) {
    const { data: modifiers, error: modifiersError } = await supabase
      .from("modifiers")
      .select("id, name, is_required, is_multi_select")
      .eq("tenant_id", tenantId)
      .in("id", allModifierIds);
    if (modifiersError) return { error: "โหลดข้อมูลตัวเลือกไม่สำเร็จ" };
    for (const m of modifiers ?? []) modifierMap.set(m.id, m);
  }

  const optionMap = new Map<
    string,
    { id: string; name: string; price_delta: number | null; modifier_id: string }
  >();
  if (optionIds.length > 0) {
    const { data: options, error: optionsError } = await supabase
      .from("modifier_options")
      .select("id, name, price_delta, modifier_id")
      .in("id", optionIds);
    if (optionsError) return { error: "โหลดข้อมูลตัวเลือกไม่สำเร็จ" };
    for (const o of options ?? []) optionMap.set(o.id, o);
  }

  const lines: PricedLine[] = [];
  let subtotalSatang = 0;

  for (const item of items) {
    const product = productMap.get(item.productId);
    if (!product || !product.is_active) return { error: STALE };

    const linked = linkedModifiers.get(product.id) ?? new Set<string>();
    const chosenPerModifier = new Map<string, number>();
    const snapshot: PricedLine["modifiersSnapshot"] = [];
    let unitSatang = toSatang(Number(product.price));

    const seen = new Set<string>();
    for (const sel of item.selectedModifiers) {
      if (seen.has(sel.optionId)) return { error: "ข้อมูลสินค้าในตะกร้าไม่ถูกต้อง" };
      seen.add(sel.optionId);
      const option = optionMap.get(sel.optionId);
      // modifierMap only holds this tenant's modifiers linked to cart products, so an option from
      // another tenant or an unlinked modifier fails here too.
      const modifier = option ? modifierMap.get(option.modifier_id) : undefined;
      if (!option || !modifier || !linked.has(modifier.id)) return { error: STALE };
      chosenPerModifier.set(modifier.id, (chosenPerModifier.get(modifier.id) ?? 0) + 1);
      const delta = Number(option.price_delta ?? 0);
      unitSatang += toSatang(delta);
      snapshot.push({ group: modifier.name, option: option.name, priceDelta: delta });
    }

    for (const modifierId of linked) {
      const modifier = modifierMap.get(modifierId);
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
    });
  }

  return { lines, subtotal: subtotalSatang / 100 };
}
