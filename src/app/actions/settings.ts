"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";
import bcrypt from "bcryptjs";
import { createAdminClient } from "@/lib/supabase/admin";

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

function isSixDigitPin(value: unknown): value is string {
  return typeof value === "string" && /^\d{6}$/.test(value);
}

export type TeamMemberState = { error?: string; success?: boolean } | undefined;

export async function createTeamMember(
  prevState: TeamMemberState,
  formData: FormData
): Promise<TeamMemberState> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const fullName = formData.get("full_name");
  const role = formData.get("role");
  const pin = formData.get("pin");
  const pinConfirm = formData.get("pin_confirm");
  const recoveryContact = formData.get("recovery_contact");

  if (typeof fullName !== "string" || fullName.trim() === "") {
    return { error: "กรุณากรอกชื่อ-นามสกุล" };
  }
  if (role !== "manager" && role !== "staff") {
    return { error: "ตำแหน่งไม่ถูกต้อง" };
  }
  if (!isSixDigitPin(pin) || pin !== pinConfirm) {
    return { error: "PIN ต้องเป็นตัวเลข 6 หลัก และตรงกันทั้ง 2 ช่อง" };
  }

  const supabase = await createClient();
  const { data: existingMembers } = await supabase
    .from("profiles")
    .select("pin_hash")
    .eq("tenant_id", profile.tenant_id)
    .not("pin_hash", "is", null);

  for (const member of existingMembers ?? []) {
    if (member.pin_hash && (await bcrypt.compare(pin, member.pin_hash))) {
      return { error: "PIN นี้ถูกใช้แล้วในร้านนี้ กรุณาใช้ PIN อื่น" };
    }
  }

  const admin = createAdminClient();
  const syntheticEmail = `staff.${crypto.randomUUID()}@internal.kidkubpos.local`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: syntheticEmail,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (createError || !created.user) {
    return { error: "สร้างบัญชีพนักงานไม่สำเร็จ" };
  }

  const pinHash = await bcrypt.hash(pin, 10);
  const { error: insertError } = await admin.from("profiles").insert({
    id: created.user.id,
    tenant_id: profile.tenant_id,
    full_name: fullName.trim(),
    role,
    pin_hash: pinHash,
    recovery_contact: typeof recoveryContact === "string" ? recoveryContact.trim() : null,
    auth_managed: false,
  });
  if (insertError) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(created.user.id);
    if (deleteError) {
      console.error("Failed to clean up orphaned auth user:", deleteError);
    }
    return { error: "บันทึกข้อมูลพนักงานไม่สำเร็จ" };
  }

  revalidatePath("/settings/team");
  return { success: true };
}

export async function resetTeamMemberPin(
  prevState: TeamMemberState,
  formData: FormData
): Promise<TeamMemberState> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const memberId = formData.get("member_id");
  const pin = formData.get("pin");
  const pinConfirm = formData.get("pin_confirm");

  if (typeof memberId !== "string") {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }
  if (!isSixDigitPin(pin) || pin !== pinConfirm) {
    return { error: "PIN ต้องเป็นตัวเลข 6 หลัก และตรงกันทั้ง 2 ช่อง" };
  }

  const supabase = await createClient();
  const { data: existingMembers } = await supabase
    .from("profiles")
    .select("id, pin_hash")
    .eq("tenant_id", profile.tenant_id)
    .not("pin_hash", "is", null);

  for (const member of existingMembers ?? []) {
    if (
      member.id !== memberId &&
      member.pin_hash &&
      (await bcrypt.compare(pin, member.pin_hash))
    ) {
      return { error: "PIN นี้ถูกใช้แล้วในร้านนี้ กรุณาใช้ PIN อื่น" };
    }
  }

  const pinHash = await bcrypt.hash(pin, 10);
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ pin_hash: pinHash, pin_failed_attempts: 0, pin_locked_until: null })
    .eq("id", memberId)
    .eq("tenant_id", profile.tenant_id);
  if (error) return { error: "ตั้ง PIN ใหม่ไม่สำเร็จ" };

  revalidatePath("/settings/team");
  return { success: true };
}
