"use server";
import { redirect } from "next/navigation";
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
    is_active: isActive,
    tenant_id: profile.tenant_id,
  });

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  redirect("/products");
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
      is_active: isActive,
    })
    .eq("id", id);

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  redirect("/products");
}

export async function deleteProduct(formData: FormData): Promise<void> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return;

  const id = formData.get("id");
  if (typeof id !== "string") return;

  const supabase = await createClient();
  await supabase.from("products").delete().eq("id", id);
  redirect("/products");
}
