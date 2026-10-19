"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";
import { parseCategoryName } from "@/lib/product-input";

export type CategoryState = { error?: string } | undefined;

function isManagerOrOwner(role: string): boolean {
  return role === "owner" || role === "manager";
}

export async function createCategory(
  prevState: CategoryState,
  formData: FormData
): Promise<CategoryState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const name = parseCategoryName(formData.get("name"));
  if ("error" in name) return { error: name.error };

  // sort_order is assigned by the database (end of the list).
  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .insert({ name: name.value, tenant_id: profile.tenant_id });

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  redirect("/categories");
}

export async function updateCategory(
  prevState: CategoryState,
  formData: FormData
): Promise<CategoryState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const id = formData.get("id");
  if (typeof id !== "string" || id === "") return { error: "ข้อมูลไม่ถูกต้อง" };
  const name = parseCategoryName(formData.get("name"));
  if ("error" in name) return { error: name.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .update({ name: name.value })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .select("id");

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };
  if (!data || data.length === 0) return { error: "ไม่พบหมวดหมู่" };

  redirect("/categories");
}

export async function deleteCategory(formData: FormData): Promise<void> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return;

  const id = formData.get("id");
  if (typeof id !== "string") return;

  // Menus in the category become uncategorized (FK ON DELETE SET NULL) and the database moves
  // them to the end of "ไม่ระบุหมวดหมู่".
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .delete()
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .select("id");
  if (error || !data || data.length === 0) redirect("/categories?error=1");
  redirect("/categories");
}
