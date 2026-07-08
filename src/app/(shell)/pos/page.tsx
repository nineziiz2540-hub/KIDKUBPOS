import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getModifiers, getActiveShift } from "@/lib/dal";
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
    categories: { id: string; name: string } | null;
  };

  const { data: productRows } = (await supabase
    .from("products")
    .select("id, name, price, image_url, drink_type, category_id, categories(id, name)")
    .eq("tenant_id", profile.tenant_id)
    .eq("is_active", true)
    .order("name")) as { data: ProductRow[] | null };

  const products: PosProduct[] = (productRows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    image_url: p.image_url,
    drink_type: (p.drink_type as PosProduct["drink_type"]) ?? null,
    category_id: p.category_id,
    categoryName: p.categories?.name ?? null,
  }));

  // Unique categories derived from products (ordered by first appearance)
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
    .neq("status", "cancelled")
    .gte("created_at", todayStart.toISOString());

  const activeShift = await getActiveShift(profile.tenant_id);

  return (
    <PosScreen
      products={products}
      categories={categories}
      productModifierRecord={productModifierRecord}
      allModifiers={allModifiers}
      userName={profile.full_name ?? "ผู้ใช้"}
      todayOrderCount={todayOrderCount ?? 0}
      activeShiftId={activeShift?.id ?? null}
    />
  );
}
