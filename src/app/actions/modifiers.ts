"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";

export type ModifierState = { error?: string; success?: boolean } | undefined;

function isManagerOrOwner(role: string): boolean {
  return role === "owner" || role === "manager";
}

export async function createModifier(
  prevState: ModifierState,
  formData: FormData
): Promise<ModifierState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const name = formData.get("name");
  const isRequired = formData.get("is_required") === "on";
  const isMultiSelect = formData.get("is_multi_select") === "on";
  const sortRaw = formData.get("sort_order");
  const sortOrder =
    typeof sortRaw === "string" && sortRaw !== "" ? parseInt(sortRaw, 10) : 0;

  if (typeof name !== "string" || name.trim() === "") {
    return { error: "กรุณากรอกชื่อตัวเลือก" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("modifiers").insert({
    tenant_id: profile.tenant_id,
    name: name.trim(),
    is_required: isRequired,
    is_multi_select: isMultiSelect,
    sort_order: isNaN(sortOrder) ? 0 : sortOrder,
  });

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/modifiers");
  return { success: true };
}

export async function updateModifier(
  prevState: ModifierState,
  formData: FormData
): Promise<ModifierState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const id = formData.get("id");
  const name = formData.get("name");
  const isRequired = formData.get("is_required") === "on";
  const isMultiSelect = formData.get("is_multi_select") === "on";
  const sortRaw = formData.get("sort_order");
  const sortOrder =
    typeof sortRaw === "string" && sortRaw !== "" ? parseInt(sortRaw, 10) : 0;

  if (typeof id !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  if (typeof name !== "string" || name.trim() === "") {
    return { error: "กรุณากรอกชื่อตัวเลือก" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("modifiers")
    .update({
      name: name.trim(),
      is_required: isRequired,
      is_multi_select: isMultiSelect,
      sort_order: isNaN(sortOrder) ? 0 : sortOrder,
    })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/modifiers");
  return { success: true };
}

export async function deleteModifier(formData: FormData): Promise<void> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return;

  const id = formData.get("id");
  if (typeof id !== "string") return;

  const supabase = await createClient();
  // ON DELETE CASCADE on modifier_options, product_modifiers — DB handles cleanup
  await supabase
    .from("modifiers")
    .delete()
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);

  revalidatePath("/modifiers");
}

export async function createModifierOption(
  prevState: ModifierState,
  formData: FormData
): Promise<ModifierState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const modifierId = formData.get("modifier_id");
  const name = formData.get("name");
  const priceDeltaRaw = formData.get("price_delta");
  const sortRaw = formData.get("sort_order");

  if (typeof modifierId !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  if (typeof name !== "string" || name.trim() === "") {
    return { error: "กรุณากรอกชื่อตัวเลือกย่อย" };
  }
  const priceDelta =
    typeof priceDeltaRaw === "string" && priceDeltaRaw !== ""
      ? parseFloat(priceDeltaRaw)
      : 0;
  const sortOrder =
    typeof sortRaw === "string" && sortRaw !== "" ? parseInt(sortRaw, 10) : 0;

  const supabase = await createClient();

  // Verify modifier belongs to this tenant before inserting option
  const { data: mod } = await supabase
    .from("modifiers")
    .select("id")
    .eq("id", modifierId)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (!mod) return { error: "ไม่พบกลุ่มตัวเลือก" };

  const { error } = await supabase.from("modifier_options").insert({
    modifier_id: modifierId,
    name: name.trim(),
    price_delta: isNaN(priceDelta) ? 0 : priceDelta,
    sort_order: isNaN(sortOrder) ? 0 : sortOrder,
  });

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/modifiers");
  return { success: true };
}

export async function deleteModifierOption(formData: FormData): Promise<void> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return;

  const id = formData.get("id");
  if (typeof id !== "string") return;

  const supabase = await createClient();

  // Verify option belongs to this tenant via modifier join
  const { data: opt } = await supabase
    .from("modifier_options")
    .select("id, modifiers(tenant_id)")
    .eq("id", id)
    .single();

  const mod = opt?.modifiers as { tenant_id: string } | null;
  if (!opt || mod?.tenant_id !== profile.tenant_id) return;

  await supabase.from("modifier_options").delete().eq("id", id);

  revalidatePath("/modifiers");
}
