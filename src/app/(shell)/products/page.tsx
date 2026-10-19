import { redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { SavedToastTrigger } from "@/components/products/saved-toast-trigger";
import { ArchivedProductsSection } from "@/components/products/archived-products-section";
import { ProductList, type ProductGroup } from "@/components/products/product-list";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; category?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");

  const { saved, category } = await searchParams;

  const supabase = await createClient();
  const [{ data: categories }, { data: activeRows }, { data: archived }] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name")
      .eq("tenant_id", profile.tenant_id)
      .order("sort_order")
      .order("name"),
    supabase
      .from("products")
      .select("id, name, price, is_active, image_url, category_id")
      .eq("tenant_id", profile.tenant_id)
      .is("archived_at", null)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("products")
      .select("id, name, price, archived_at")
      .eq("tenant_id", profile.tenant_id)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false }),
  ]);

  // One group per category in the owner's order; uncategorized menus last, only if any.
  const toItem = (p: NonNullable<typeof activeRows>[number]) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    isActive: p.is_active,
    imageUrl: p.image_url,
  });
  const groups: ProductGroup[] = (categories ?? []).map((c) => ({
    key: c.id,
    categoryId: c.id,
    name: c.name,
    products: (activeRows ?? []).filter((p) => p.category_id === c.id).map(toItem),
  }));
  const uncategorized = (activeRows ?? []).filter((p) => p.category_id === null).map(toItem);
  if (uncategorized.length > 0) {
    groups.push({ key: "none", categoryId: null, name: "ไม่ระบุหมวดหมู่", products: uncategorized });
  }

  const archivedProducts = (archived ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    archivedAt: p.archived_at as string,
  }));

  return (
    <div className="space-y-6">
      {saved === "1" && <SavedToastTrigger title="บันทึกเมนูแล้ว" />}
      <ProductList groups={groups} initialCategory={category ?? null} />
      {archivedProducts.length > 0 && <ArchivedProductsSection products={archivedProducts} />}
    </div>
  );
}
