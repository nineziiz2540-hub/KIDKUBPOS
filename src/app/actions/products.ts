"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";

export type ProductState = { error?: string } | undefined;

function isManagerOrOwner(role: string): boolean {
  return role === "owner" || role === "manager";
}

export async function createProduct(
  prevState: ProductState,
  formData: FormData
): Promise<ProductState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const name = formData.get("name");
  const priceRaw = formData.get("price");
  const description = formData.get("description");
  const categoryId = formData.get("category_id");
  const drinkType = formData.get("drink_type");
  const isActive = formData.get("is_active") === "on";

  if (typeof name !== "string" || name.trim() === "") {
    return { error: "กรุณากรอกชื่อสินค้า" };
  }
  const price = typeof priceRaw === "string" ? parseFloat(priceRaw) : NaN;
  if (isNaN(price) || price < 0) {
    return { error: "กรุณากรอกราคาที่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("products").insert({
    name: name.trim(),
    price,
    description:
      typeof description === "string" && description.trim() !== ""
        ? description.trim()
        : null,
    category_id:
      typeof categoryId === "string" && categoryId !== "" ? categoryId : null,
    drink_type:
      typeof drinkType === "string" && drinkType !== "" ? drinkType : null,
    is_active: isActive,
    tenant_id: profile.tenant_id,
  });

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  redirect("/products?saved=1");
}

export async function updateProduct(
  prevState: ProductState,
  formData: FormData
): Promise<ProductState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const id = formData.get("id");
  const name = formData.get("name");
  const priceRaw = formData.get("price");
  const description = formData.get("description");
  const categoryId = formData.get("category_id");
  const drinkType = formData.get("drink_type");
  const isActive = formData.get("is_active") === "on";

  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    name.trim() === ""
  ) {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }
  const price = typeof priceRaw === "string" ? parseFloat(priceRaw) : NaN;
  if (isNaN(price) || price < 0) {
    return { error: "กรุณากรอกราคาที่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({
      name: name.trim(),
      price,
      description:
        typeof description === "string" && description.trim() !== ""
          ? description.trim()
          : null,
      category_id:
        typeof categoryId === "string" && categoryId !== ""
          ? categoryId
          : null,
      drink_type:
        typeof drinkType === "string" && drinkType !== "" ? drinkType : null,
      is_active: isActive,
    })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  redirect("/products?saved=1");
}

export async function deleteProduct(formData: FormData): Promise<void> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return;

  const id = formData.get("id");
  if (typeof id !== "string") return;

  const supabase = await createClient();
  await supabase
    .from("products")
    .delete()
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);
  redirect("/products");
}

export async function updateProductRecipes(
  formData: FormData
): Promise<void> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return;

  const productId = formData.get("product_id");
  if (typeof productId !== "string") return;

  const supabase = await createClient();

  // Delete all existing recipes for this product
  await supabase
    .from("product_recipes")
    .delete()
    .eq("product_id", productId)
    .eq("tenant_id", profile.tenant_id);

  // Build new recipes from parallel arrays
  const rawIds = formData.getAll("raw_material_id");
  const qtys = formData.getAll("quantity_used");

  const recipes: {
    tenant_id: string;
    product_id: string;
    raw_material_id: string;
    quantity_used: number;
  }[] = [];

  for (let i = 0; i < rawIds.length; i++) {
    const idVal = rawIds[i];
    const qtyVal = qtys[i];
    if (typeof idVal !== "string" || typeof qtyVal !== "string") continue;
    const qty = parseFloat(qtyVal);
    if (isNaN(qty) || qty <= 0) continue;
    recipes.push({
      tenant_id: profile.tenant_id,
      product_id: productId,
      raw_material_id: idVal,
      quantity_used: qty,
    });
  }

  // Deduplicate by raw_material_id — last occurrence wins
  const deduped = Array.from(
    new Map(recipes.map((r) => [r.raw_material_id, r])).values()
  );

  if (deduped.length > 0) {
    const { error: insertError } = await supabase
      .from("product_recipes")
      .insert(deduped);
    if (insertError) return;
  }

  revalidatePath(`/products/${productId}/edit`);
}

export async function updateProductModifiers(
  formData: FormData
): Promise<void> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return;

  const productId = formData.get("product_id");
  if (typeof productId !== "string") return;

  const supabase = await createClient();

  // Delete all existing modifier links for this product
  await supabase
    .from("product_modifiers")
    .delete()
    .eq("product_id", productId)
    .eq("tenant_id", profile.tenant_id);

  const modifierIds = formData.getAll("modifier_id");
  const links: {
    tenant_id: string;
    product_id: string;
    modifier_id: string;
  }[] = [];

  for (const mid of modifierIds) {
    if (typeof mid !== "string") continue;
    links.push({
      tenant_id: profile.tenant_id,
      product_id: productId,
      modifier_id: mid,
    });
  }

  // Deduplicate by modifier_id — last occurrence wins
  const deduped = Array.from(
    new Map(links.map((l) => [l.modifier_id, l])).values()
  );

  if (deduped.length > 0) {
    const { error: insertError } = await supabase
      .from("product_modifiers")
      .insert(deduped);
    if (insertError) return;
  }

  revalidatePath(`/products/${productId}/edit`);
}

export async function uploadProductImage(
  formData: FormData
): Promise<{ url: string } | { error: string }> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const file = formData.get("image");
  if (!(file instanceof File)) return { error: "ไม่พบไฟล์" };
  if (file.size === 0) return { error: "ไฟล์ว่างเปล่า" };
  if (file.size > 5 * 1024 * 1024) return { error: "ไฟล์ขนาดใหญ่เกิน 5MB" };

  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${profile.tenant_id}/${Date.now()}.${ext}`;

  const supabase = await createClient();
  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(path, file, { upsert: false });

  if (uploadError) return { error: "อัปโหลดรูปภาพไม่สำเร็จ" };

  const { data: urlData } = supabase.storage
    .from("product-images")
    .getPublicUrl(path);

  // Save image_url back to the product (product_id is optional FormData field)
  const productId = formData.get("product_id");
  if (typeof productId === "string" && productId !== "") {
    await supabase
      .from("products")
      .update({ image_url: urlData.publicUrl })
      .eq("id", productId)
      .eq("tenant_id", profile.tenant_id);
    revalidatePath(`/products/${productId}/edit`);
  }

  return { url: urlData.publicUrl };
}
