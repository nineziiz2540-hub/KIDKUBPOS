import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getProfile,
  getModifiers,
  getActiveShift,
  getOpenHeldBills,
  getCancelledHeldBillsToday,
  getTenantPromptPayId,
} from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { bangkokToday } from "@/lib/bangkok-time";
import { loadPosStockRows } from "@/lib/stock/pos-catalog";
import { readLiveStock } from "@/lib/stock/live-stock";
import type { WasteMaterial } from "@/lib/stock/waste-input";
import { PosScreen } from "@/components/pos/pos-screen";
import type { ModifierWithOptions, PosCategory, PosProduct } from "@/types/app";

export default async function PosPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  // Products with image + drink_type + category
  type ProductRow = {
    id: string;
    name: string;
    price: number;
    image_url: string | null;
    drink_type: string | null;
    category_id: string | null;
    sort_order: number;
    categories: { id: string; name: string; sort_order: number } | null;
  };

  const { data: productRows } = (await supabase
    .from("products")
    .select("id, name, price, image_url, drink_type, category_id, sort_order, categories(id, name, sort_order)")
    .eq("tenant_id", profile.tenant_id)
    .eq("is_active", true)
    .is("archived_at", null)) as { data: ProductRow[] | null };

  // The owner's order: categories first, then menus within each; uncategorized menus last.
  const categoryRank = (p: ProductRow) => p.categories?.sort_order ?? Number.MAX_SAFE_INTEGER;
  const orderedRows = [...(productRows ?? [])].sort(
    (a, b) =>
      categoryRank(a) - categoryRank(b) ||
      a.sort_order - b.sort_order ||
      a.name.localeCompare(b.name, "th")
  );

  const products: PosProduct[] = orderedRows.map((p) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    image_url: p.image_url,
    drink_type: (p.drink_type as PosProduct["drink_type"]) ?? null,
    category_id: p.category_id,
    categoryName: p.categories?.name ?? null,
  }));

  // Categories that have at least one sellable menu, in the owner's order (products are
  // already sorted by category order, so first appearance is the right order).
  const categoryMap = new Map<string, string>();
  for (const p of products) {
    if (p.category_id && p.categoryName && !categoryMap.has(p.category_id)) {
      categoryMap.set(p.category_id, p.categoryName);
    }
  }
  const categories: PosCategory[] = [...categoryMap.entries()].map(
    ([id, name]) => ({ id, name })
  );

  // Product → modifier IDs mapping (serializable Record, not Map)
  const { data: pmRows } = (await supabase
    .from("product_modifiers")
    .select("product_id, modifier_id")
    .eq("tenant_id", profile.tenant_id)) as {
    data: { product_id: string; modifier_id: string }[] | null;
  };

  const productModifierRecord: Record<string, string[]> = {};
  for (const r of pmRows ?? []) {
    if (!productModifierRecord[r.product_id]) {
      productModifierRecord[r.product_id] = [];
    }
    productModifierRecord[r.product_id]!.push(r.modifier_id);
  }

  // All tenant modifiers (for the option window to render options)
  const allModifiers: ModifierWithOptions[] = await getModifiers(
    profile.tenant_id
  );

  // Bean/matcha and sweetness rows for the option window (round D1): the menus on sale and the
  // options linked to them. Cost-free, read as the signed-in user; null = not loaded (sell without).
  const onSaleIds = new Set(products.map((p) => p.id));
  const linkedModifierIds = new Set(
    Object.entries(productModifierRecord)
      .filter(([productId]) => onSaleIds.has(productId))
      .flatMap(([, modifierIds]) => modifierIds)
  );
  const linkedOptionIds = allModifiers
    .filter((m) => linkedModifierIds.has(m.id))
    .flatMap((m) => m.options.map((o) => o.id));

  // Today's order count (Bangkok UTC+7)
  const offsetMs = 7 * 60 * 60 * 1000;
  const nowMs = new Date().getTime();
  const bangkokNow = new Date(nowMs + offsetMs);
  const bangkokMidnightUTC = Date.UTC(
    bangkokNow.getUTCFullYear(),
    bangkokNow.getUTCMonth(),
    bangkokNow.getUTCDate()
  );
  const todayStart = new Date(bangkokMidnightUTC - offsetMs);

  const { count: todayOrderCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", profile.tenant_id)
    .eq("status", "completed")
    .gte("created_at", todayStart.toISOString());

  // Today's queue counter, for the device snapshot. tenant_queue_counters has no member RLS policy,
  // so it is read with the admin client, scoped to this shop. No row yet means 0.
  const todayQueueDate = bangkokToday(new Date());
  const [counter, activeShift, heldBills, cancelledHeldToday, promptpayId, stockRows, liveStockRows, bagRule, materialRows] = await Promise.all([
    createAdminClient()
      .from("tenant_queue_counters")
      .select("last_number")
      .eq("tenant_id", profile.tenant_id)
      .eq("business_date", todayQueueDate)
      .maybeSingle(),
    getActiveShift(profile.tenant_id),
    getOpenHeldBills(profile.tenant_id),
    getCancelledHeldBillsToday(profile.tenant_id),
    getTenantPromptPayId(profile.tenant_id),
    loadPosStockRows(supabase, profile.tenant_id, [...onSaleIds], linkedOptionIds),
    // Levels and paused menus for the tiles (round D2a); null = a read failed, the heartbeat fills it in.
    readLiveStock(supabase, profile.tenant_id),
    // The bag counter: only whether the shop counts bags and its one-per-N rule. No cost column.
    supabase.from("tenants").select("bag_material_id, bags_per_cups").eq("id", profile.tenant_id).single(),
    // Names for "ระบบคิดว่า…หมด" (round D2a): only materials that can be out. A staff-readable column, no cost.
    supabase
      .from("raw_materials")
      .select("id, name, unit, category, purchase_unit, purchase_size")
      .eq("tenant_id", profile.tenant_id)
      .eq("track_stock", true)
      .is("archived_at", null),
  ]);
  // A failed read only loses the words: the dialog then says "วัตถุดิบ".
  const materialNames: Record<string, string> = Object.fromEntries(
    (materialRows.data ?? []).map((m) => [m.id, m.name])
  );

  const wasteMaterials: WasteMaterial[] = (materialRows.data ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    unit: m.unit,
    category: m.category,
    purchaseUnit: m.purchase_unit,
    purchaseSize: m.purchase_size === null ? null : Number(m.purchase_size),
  }));

  return (
    <PosScreen
      products={products}
      categories={categories}
      productModifierRecord={productModifierRecord}
      allModifiers={allModifiers}
      stockRows={stockRows}
      liveStockRows={liveStockRows}
      materialNames={materialNames}
      wasteMaterials={wasteMaterials}
      canSeeReceivePrice={profile.role === "owner" || profile.role === "manager"}
      bagsEnabled={bagRule.data?.bag_material_id != null}
      bagsPerCups={bagRule.data?.bags_per_cups ?? null}
      userName={profile.full_name ?? "ผู้ใช้"}
      todayOrderCount={todayOrderCount ?? 0}
      activeShiftId={activeShift?.id ?? null}
      heldBills={heldBills}
      cancelledHeldToday={cancelledHeldToday}
      promptpayId={promptpayId}
      tenantId={profile.tenant_id}
      sellerId={profile.id}
      renderedAt={nowMs}
      todayQueueLast={counter.data?.last_number ?? 0}
      todayQueueDate={todayQueueDate}
    />
  );
}
