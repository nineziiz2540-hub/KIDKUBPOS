import { notFound, redirect } from "next/navigation";
import { getProfile, getModifiers, getRawMaterials } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { MenuEditor } from "@/components/products/menu-editor";
import { RestoreProductButton } from "@/components/products/restore-product-button";
import type { DrinkType } from "@/lib/product-input";

export default async function EditMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ photo?: string }>;
}) {
  const { id } = await params;
  const { photo } = await searchParams;

  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") {
    redirect("/products");
  }

  const supabase = await createClient();
  const { data: product } = await supabase
    .from("products")
    .select("id, name, price, description, is_active, category_id, image_url, drink_type, archived_at")
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();

  if (!product) notFound();

  if (product.archived_at !== null) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-[26px] font-bold text-sidebar leading-tight">แก้ไขเมนู</h1>
          <p className="text-base text-muted-foreground mt-1">{product.name}</p>
        </div>
        <div className="max-w-lg rounded-xl border border-warning/30 bg-warning/10 p-4 flex items-center gap-4">
          <p className="flex-1 text-base font-medium text-sidebar">
            เมนูนี้ถูกเก็บแล้ว ไม่แสดงในหน้า POS
          </p>
          <RestoreProductButton productId={product.id} />
        </div>
      </div>
    );
  }

  const [{ data: categories }, modifiers, rawMaterials, { data: recipes }, { data: links }] =
    await Promise.all([
      supabase
        .from("categories")
        .select("id, name")
        .eq("tenant_id", profile.tenant_id)
        .order("sort_order")
        .order("name"),
      getModifiers(profile.tenant_id),
      getRawMaterials(profile.tenant_id),
      supabase
        .from("product_recipes")
        .select("raw_material_id, quantity_used")
        .eq("product_id", id)
        .eq("tenant_id", profile.tenant_id),
      supabase
        .from("product_modifiers")
        .select("modifier_id")
        .eq("product_id", id)
        .eq("tenant_id", profile.tenant_id),
    ]);

  return (
    <MenuEditor
      key={product.id}
      productId={product.id}
      initial={{
        name: product.name,
        price: String(Number(product.price)),
        description: product.description ?? "",
        categoryId: product.category_id,
        drinkType: (product.drink_type as DrinkType | null) ?? null,
        isActive: product.is_active,
        // Same order every visit: the order materials appear in the picker (by name).
        recipes: (recipes ?? [])
          .map((r) => ({
            rawMaterialId: r.raw_material_id,
            quantityUsed: String(Number(r.quantity_used)),
          }))
          .sort(
            (a, b) =>
              rawMaterials.findIndex((m) => m.id === a.rawMaterialId) -
              rawMaterials.findIndex((m) => m.id === b.rawMaterialId)
          ),
        modifierIds: (links ?? []).map((l) => l.modifier_id),
      }}
      imageUrl={product.image_url}
      categories={categories ?? []}
      modifiers={modifiers}
      rawMaterials={rawMaterials.map((m) => ({
        id: m.id,
        name: m.name,
        unit: m.unit,
        costPerUnit: Number(m.cost_per_unit),
      }))}
      photoFailed={photo === "failed"}
    />
  );
}
