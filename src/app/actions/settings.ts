"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";

export type SettingsState = { error?: string; success?: boolean } | undefined;

export async function updateStoreName(
  prevState: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const name = formData.get("name");
  if (typeof name !== "string" || name.trim() === "") {
    return { error: "กรุณากรอกชื่อร้านค้า" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tenants")
    .update({ name: name.trim() })
    .eq("id", profile.tenant_id);

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/settings");
  return { success: true };
}

export async function updateMemberRole(
  prevState: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const memberId = formData.get("member_id");
  const role = formData.get("role");

  if (typeof memberId !== "string" || typeof role !== "string") {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }
  if (!["owner", "manager", "staff"].includes(role)) {
    return { error: "role ไม่ถูกต้อง" };
  }
  if (memberId === profile.id) {
    return { error: "ไม่สามารถเปลี่ยน role ของตัวเองได้" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", memberId)
    .eq("tenant_id", profile.tenant_id);

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/settings/team");
  return { success: true };
}
