import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getProfile,
  getModifiers,
  getActiveShift,
  getOpenHeldBills,
  getCancelledHeldBillsToday,
} from "@/lib/dal";
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

  // All tenant modifiers (for ModifierModal to render options)
  const allModifiers: ModifierWithOptions[] = await getModifiers(
    profile.tenant_id
  );

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

  const [activeShift, heldBills, cancelledHeldToday] = await Promise.all([
    getActiveShift(profile.tenant_id),
    getOpenHeldBills(profile.tenant_id),
    getCancelledHeldBillsToday(profile.tenant_id),
  ]);

  return (
    <PosScreen
      products={products}
      categories={categories}
      productModifierRecord={productModifierRecord}
      allModifiers={allModifiers}
      userName={profile.full_name ?? "ผู้ใช้"}
      todayOrderCount={todayOrderCount ?? 0}
      activeShiftId={activeShift?.id ?? null}
      heldBills={heldBills}
      cancelledHeldToday={cancelledHeldToday}
    />
  );
}
