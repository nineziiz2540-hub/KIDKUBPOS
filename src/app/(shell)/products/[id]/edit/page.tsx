import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  getProfile,
  getRawMaterials,
  getModifiers,
  getModifiersForProduct,
} from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { updateProduct } from "@/app/actions/products";
import { ProductForm } from "@/components/products/product-form";
import { RecipeTab } from "@/components/products/recipe-tab";
import { ModifiersTab } from "@/components/products/modifiers-tab";
import { ImageUploadSection } from "@/components/products/image-upload-section";

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab = "info" } = await searchParams;

  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") {
    redirect("/products");
  }

  const supabase = await createClient();
  const [{ data: product }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, name, price, description, is_active, category_id, image_url, drink_type"
      )
      .eq("id", id)
      .eq("tenant_id", profile.tenant_id)
      .single(),
    supabase
      .from("categories")
      .select("id, name")
      .eq("tenant_id", profile.tenant_id)
      .order("name"),
  ]);

  if (!product) notFound();

  // Fetch tab-specific data
  const [rawMaterials, allModifiers, existingRecipesResult, linkedModifiersResult] =
    await Promise.all([
      tab === "recipe" ? getRawMaterials(profile.tenant_id) : Promise.resolve([]),
      tab === "modifiers"
        ? getModifiers(profile.tenant_id)
        : Promise.resolve([]),
      tab === "recipe"
        ? supabase
            .from("product_recipes")
            .select("raw_material_id, quantity_used")
            .eq("product_id", id)
            .eq("tenant_id", profile.tenant_id)
        : Promise.resolve({ data: null }),
      tab === "modifiers"
        ? getModifiersForProduct(id)
        : Promise.resolve([]),
    ]);

  const existingRecipes = (existingRecipesResult?.data ?? []) as {
    raw_material_id: string;
    quantity_used: number;
  }[];
  const linkedModifierIds = (
    linkedModifiersResult as { id: string }[]
  ).map((m) => m.id);

  const tabs = [
    { key: "info", label: "ข้อมูลทั่วไป" },
    { key: "recipe", label: "สูตรอาหาร" },
    { key: "modifiers", label: "ตัวเลือกเพิ่มเติม" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">แก้ไขสินค้า</h1>
        <p className="text-sm text-muted-foreground mt-1">{product.name}</p>
      </div>

      {/* Tab navigation */}
      <div className="flex border-b gap-0">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/products/${id}/edit?tab=${t.key}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-accent text-accent"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* Tab content */}
      {tab === "info" && (
        <div className="space-y-6">
          <ProductForm
            action={updateProduct}
            categories={categories ?? []}
            defaults={{
              id: product.id,
              name: product.name,
              price: Number(product.price),
              description: product.description,
              category_id: product.category_id,
              drink_type: product.drink_type,
              is_active: product.is_active,
            }}
          />
          <div className="rounded-lg border bg-white p-5 max-w-lg">
            <h2 className="text-base font-semibold text-sidebar mb-4">
              รูปภาพสินค้า
            </h2>
            <ImageUploadSection
              productId={id}
              currentImageUrl={product.image_url}
            />
          </div>
        </div>
      )}

      {tab === "recipe" && (
        <RecipeTab
          productId={id}
          rawMaterials={rawMaterials}
          initialRows={existingRecipes.map((r) => ({
            raw_material_id: r.raw_material_id,
            quantity_used: String(r.quantity_used),
          }))}
        />
      )}

      {tab === "modifiers" && (
        <ModifiersTab
          productId={id}
          allModifiers={allModifiers}
          linkedModifierIds={linkedModifierIds}
        />
      )}
    </div>
  );
}
