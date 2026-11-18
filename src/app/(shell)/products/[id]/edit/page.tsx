import { notFound, redirect } from "next/navigation";
import { getProfile, getModifiers } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { loadMenuEditorRefs } from "@/lib/menu-editor-refs";
import { fillSweetnessGrid, menuDraftFromRows, menuSweeteners } from "@/lib/menu-draft";
import { MenuEditor } from "@/components/products/menu-editor";
import { RestoreProductButton } from "@/components/products/restore-product-button";

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

  const [{ data: categories }, modifiers, refs, recipes, links, sweetness, customAmounts] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name")
      .eq("tenant_id", profile.tenant_id)
      .order("sort_order")
      .order("name"),
    getModifiers(profile.tenant_id),
    loadMenuEditorRefs(profile.tenant_id),
    supabase
      .from("product_recipes")
      .select("line_kind, raw_material_id, group_id, quantity_used, default_member_id, allow_special")
      .eq("product_id", id)
      .eq("tenant_id", profile.tenant_id),
    supabase
      .from("product_modifiers")
      .select("modifier_id")
      .eq("product_id", id)
      .eq("tenant_id", profile.tenant_id),
    supabase
      .from("product_sweetness")
      .select("group_id, default_member_id, allowed_member_ids, default_level_id, use_custom")
      .eq("product_id", id)
      .eq("tenant_id", profile.tenant_id)
      .maybeSingle(),
    supabase
      .from("sweetness_amounts")
      .select("member_id, level_id, amount")
      .eq("product_id", id)
      .eq("tenant_id", profile.tenant_id),
  ]);

  // The editor saves the whole menu at once: never open it on a partial read, or saving would drop
  // the recipe lines, option links or sweetness that failed to load.
  if (recipes.error || links.error || sweetness.error || customAmounts.error) {
    console.error(
      "[EditMenuPage] load failed:",
      (recipes.error ?? links.error ?? sweetness.error ?? customAmounts.error)?.message
    );
    return (
      <div className="space-y-6">
        <h1 className="text-[26px] font-bold text-sidebar leading-tight">แก้ไขเมนู</h1>
        <p role="alert" className="max-w-lg rounded-xl border border-warning/30 bg-warning/10 p-4 text-base font-medium text-sidebar">
          โหลดข้อมูลเมนูไม่ครบ กรุณารีเฟรชหน้าอีกครั้ง
        </p>
      </div>
    );
  }

  const recipeRows = recipes.data ?? [];
  // Archived materials are hidden from the picker, but a line that still uses one is shown (ปิดใช้แล้ว)
  // and kept until the owner replaces or removes it.
  const usedMaterialIds = new Set(recipeRows.flatMap((r) => (r.raw_material_id ? [r.raw_material_id] : [])));
  const materials = [
    ...refs.materials,
    ...refs.archivedMaterials.filter((m) => usedMaterialIds.has(m.id)),
  ].sort((a, b) => a.name.localeCompare(b.name, "th"));

  const initial = menuDraftFromRows({
    product,
    recipes: recipeRows,
    modifierIds: (links.data ?? []).map((l) => l.modifier_id),
    sweetness: sweetness.data,
    customAmounts: customAmounts.data ?? [],
    materialOrder: materials.map((m) => m.id),
    groupOrder: refs.groups.map((g) => g.id),
  });
  if (initial.sweetness?.useCustom) {
    // A level or sweetener added since the menu's own table was saved gets a cell to fill.
    initial.sweetness.custom = fillSweetnessGrid(
      initial.sweetness.custom,
      menuSweeteners(initial.sweetness),
      refs.levels,
      refs.standardAmounts
    );
  }

  return (
    <MenuEditor
      key={product.id}
      productId={product.id}
      initial={initial}
      imageUrl={product.image_url}
      categories={categories ?? []}
      modifiers={modifiers}
      materials={materials}
      groups={refs.groups}
      levels={refs.levels}
      standardAmounts={refs.standardAmounts}
      photoFailed={photo === "failed"}
    />
  );
}
