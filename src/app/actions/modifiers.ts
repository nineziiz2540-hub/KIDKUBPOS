"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/dal";
import { checkEffectInputs, effectPayload, type EffectInput } from "@/lib/stock/option-effects";
import type { Json } from "@/types/database";

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

/**
 * "ผลต่อสต๊อก" of one option (round D1): replaces the option's stock effects as a set through
 * save_option_effects (user client, one transaction). The option's modifier and every group / material id
 * are checked against the caller's shop here first (friendly messages) and again in SQL. The tenant always
 * comes from the profile, never from the caller.
 */
export async function saveOptionEffects(optionId: string, effects: EffectInput[]): Promise<ModifierState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }
  if (typeof optionId !== "string" || optionId === "" || optionId.length > 64) return { error: "ข้อมูลไม่ถูกต้อง" };
  const checked = checkEffectInputs(effects);
  if ("error" in checked) return { error: checked.error };
  const tenantId = profile.tenant_id;
  const SAVE_FAIL = "บันทึกผลต่อสต๊อกไม่สำเร็จ — ลองอีกครั้ง";

  const supabase = await createClient();

  // The option must belong to one of this shop's modifier groups.
  const { data: option, error: optionError } = await supabase
    .from("modifier_options")
    .select("id, modifiers!inner(tenant_id)")
    .eq("id", optionId)
    .eq("modifiers.tenant_id", tenantId)
    .maybeSingle();
  if (optionError) return { error: SAVE_FAIL };
  if (!option) return { error: "ไม่พบตัวเลือกนี้ กรุณารีเฟรชหน้า" };

  // "เพิ่มในช่องเมล็ด/มัทฉะ": this shop's bean / matcha (or other) groups — never the sweetener group.
  const groupIds = [...new Set(checked.value.flatMap((e) => (e.kind === "slot_add" ? [e.groupId] : [])))];
  if (groupIds.length > 0) {
    const { data: groups, error } = await supabase
      .from("choice_groups")
      .select("id, kind")
      .eq("tenant_id", tenantId)
      .in("id", groupIds);
    if (error) return { error: SAVE_FAIL };
    if ((groups ?? []).length !== groupIds.length || (groups ?? []).some((g) => g.kind === "sweetener")) {
      return { error: "กลุ่มเมล็ด/มัทฉะไม่ถูกต้อง กรุณารีเฟรชหน้า" };
    }
  }

  // "เพิ่มวัตถุดิบ": this shop's materials that are still in use (not archived).
  const materialIds = [...new Set(checked.value.flatMap((e) => (e.kind === "material_add" ? [e.materialId] : [])))];
  if (materialIds.length > 0) {
    const { data: mats, error } = await createAdminClient()
      .from("raw_materials")
      .select("id")
      .eq("tenant_id", tenantId)
      .is("archived_at", null)
      .in("id", materialIds);
    if (error) return { error: SAVE_FAIL };
    if ((mats ?? []).length !== materialIds.length) return { error: "ไม่พบวัตถุดิบนี้ หรือปิดใช้แล้ว — เลือกวัตถุดิบอื่น" };
  }

  // Replace as a set in one transaction (save_option_effects deletes the old set and inserts the new one,
  // re-checking the role and every id against the caller's shop in SQL).
  const { error } = await supabase.rpc("save_option_effects", {
    p_option_id: optionId,
    p_effects: effectPayload(checked.value) as unknown as Json,
  });
  if (error) return { error: EFFECT_RPC_ERRORS[error.message] ?? SAVE_FAIL };

  revalidatePath("/modifiers");
  revalidatePath("/pos");
  return { success: true };
}

// Messages raised by save_option_effects.
const EFFECT_RPC_ERRORS: Record<string, string> = {
  forbidden: "ไม่มีสิทธิ์ดำเนินการนี้",
  option_not_found: "ไม่พบตัวเลือกนี้ กรุณารีเฟรชหน้า",
  invalid_group: "กลุ่มเมล็ด/มัทฉะไม่ถูกต้อง กรุณารีเฟรชหน้า",
  invalid_material: "ไม่พบวัตถุดิบนี้ หรือปิดใช้แล้ว — เลือกวัตถุดิบอื่น",
  invalid_effect_amount: "ปริมาณต้องมากกว่า 0 ไม่เกิน 100,000 และทศนิยมไม่เกิน 3 ตำแหน่ง",
  duplicate_effect: "ผลต่อสต๊อกซ้ำกัน — รวมเป็นบรรทัดเดียว",
  invalid_effect: "ข้อมูลไม่ถูกต้อง",
};
