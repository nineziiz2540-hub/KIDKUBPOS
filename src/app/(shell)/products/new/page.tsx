import { redirect } from "next/navigation";
import { getProfile, getModifiers, getRawMaterials } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { MenuEditor } from "@/components/products/menu-editor";

export default async function NewMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") {
    redirect("/products");
  }

  const { category } = await searchParams;
  const supabase = await createClient();
  const [{ data: categories }, modifiers, rawMaterials] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name")
      .eq("tenant_id", profile.tenant_id)
      .order("sort_order")
      .order("name"),
    getModifiers(profile.tenant_id),
    getRawMaterials(profile.tenant_id),
  ]);

  // Opened from a category tab: start in that category.
  const startCategory = (categories ?? []).some((c) => c.id === category) ? category! : null;

  return (
    <MenuEditor
      productId={null}
      initial={{
        name: "",
        price: "",
        description: "",
        categoryId: startCategory,
        drinkType: null,
        isActive: true,
        recipes: [],
        modifierIds: [],
      }}
      imageUrl={null}
      categories={categories ?? []}
      modifiers={modifiers}
      rawMaterials={rawMaterials.map((m) => ({
        id: m.id,
        name: m.name,
        unit: m.unit,
        costPerUnit: Number(m.cost_per_unit),
      }))}
    />
  );
}
