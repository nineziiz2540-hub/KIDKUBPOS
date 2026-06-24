"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";

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

  const name = formData.get("name");
  if (typeof name !== "string" || name.trim() === "") {
    return { error: "กรุณากรอกชื่อหมวดหมู่" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .insert({ name: name.trim(), tenant_id: profile.tenant_id });

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
  const name = formData.get("name");
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    name.trim() === ""
  ) {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .update({ name: name.trim() })
    .eq("id", id);

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  redirect("/categories");
}

export async function deleteCategory(formData: FormData): Promise<void> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return;

  const id = formData.get("id");
  if (typeof id !== "string") return;

  const supabase = await createClient();
  await supabase.from("categories").delete().eq("id", id);
  redirect("/categories");
}
