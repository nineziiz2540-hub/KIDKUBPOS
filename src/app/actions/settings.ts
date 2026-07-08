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

export async function updateBusinessSettings(
  prevState: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const fixedCostRaw = formData.get("fixed_cost_monthly");
  const gpPercentRaw = formData.get("delivery_gp_percent");
  const orderPrefix = formData.get("order_prefix");

  const fixedCost =
    typeof fixedCostRaw === "string" ? parseFloat(fixedCostRaw) : NaN;
  if (isNaN(fixedCost) || fixedCost < 0) {
    return { error: "กรุณากรอกต้นทุนคงที่ที่ถูกต้อง (>= 0)" };
  }

  const gpPercent =
    typeof gpPercentRaw === "string" ? parseFloat(gpPercentRaw) : NaN;
  if (isNaN(gpPercent) || gpPercent < 0 || gpPercent > 100) {
    return { error: "กรุณากรอก GP% ที่ถูกต้อง (0–100)" };
  }

  if (typeof orderPrefix !== "string" || orderPrefix.trim() === "") {
    return { error: "กรุณากรอก Order Prefix" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tenants")
    .update({
      fixed_cost_monthly: fixedCost,
      delivery_gp_percent: gpPercent,
      order_prefix: orderPrefix.trim().toUpperCase(),
    })
    .eq("id", profile.tenant_id);

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/settings");
  return { success: true };
}

export async function updatePromptPayId(
  prevState: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const raw = formData.get("promptpay_id");
  if (typeof raw !== "string") {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }

  const digits = raw.replace(/[^0-9]/g, "");
  if (digits !== "" && digits.length !== 10 && digits.length !== 13 && digits.length !== 15) {
    return {
      error: "เลข PromptPay ต้องเป็นเบอร์โทร (10 หลัก) หรือเลขผู้เสียภาษี (13 หลัก)",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tenants")
    .update({ promptpay_id: digits === "" ? null : digits })
    .eq("id", profile.tenant_id);

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/settings");
  return { success: true };
}
