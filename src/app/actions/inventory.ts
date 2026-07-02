"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";

export type InventoryState = { error?: string; success?: boolean } | undefined;

function isManagerOrOwner(role: string): boolean {
  return role === "owner" || role === "manager";
}

export async function createRawMaterial(
  prevState: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const name = formData.get("name");
  const unit = formData.get("unit");
  const costRaw = formData.get("cost_per_unit");
  const minRaw = formData.get("min_stock_alert");

  if (typeof name !== "string" || name.trim() === "") {
    return { error: "กรุณากรอกชื่อวัตถุดิบ" };
  }
  if (typeof unit !== "string" || unit.trim() === "") {
    return { error: "กรุณากรอกหน่วย" };
  }
  const costPerUnit = typeof costRaw === "string" ? parseFloat(costRaw) : NaN;
  if (isNaN(costPerUnit) || costPerUnit < 0) {
    return { error: "กรุณากรอกต้นทุนที่ถูกต้อง" };
  }
  const minStock =
    typeof minRaw === "string" && minRaw !== "" ? parseFloat(minRaw) : 0;

  const supabase = await createClient();
  const { error } = await supabase.from("raw_materials").insert({
    tenant_id: profile.tenant_id,
    name: name.trim(),
    unit: unit.trim(),
    cost_per_unit: costPerUnit,
    min_stock_alert: isNaN(minStock) ? 0 : minStock,
  });

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/inventory");
  return { success: true };
}

export async function updateRawMaterial(
  prevState: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const id = formData.get("id");
  const name = formData.get("name");
  const unit = formData.get("unit");
  const costRaw = formData.get("cost_per_unit");
  const minRaw = formData.get("min_stock_alert");

  if (typeof id !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  if (typeof name !== "string" || name.trim() === "") {
    return { error: "กรุณากรอกชื่อวัตถุดิบ" };
  }
  if (typeof unit !== "string" || unit.trim() === "") {
    return { error: "กรุณากรอกหน่วย" };
  }
  const costPerUnit = typeof costRaw === "string" ? parseFloat(costRaw) : NaN;
  if (isNaN(costPerUnit) || costPerUnit < 0) {
    return { error: "กรุณากรอกต้นทุนที่ถูกต้อง" };
  }
  const minStock =
    typeof minRaw === "string" && minRaw !== "" ? parseFloat(minRaw) : 0;

  const supabase = await createClient();
  const { error } = await supabase
    .from("raw_materials")
    .update({
      name: name.trim(),
      unit: unit.trim(),
      cost_per_unit: costPerUnit,
      min_stock_alert: isNaN(minStock) ? 0 : minStock,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);

  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/inventory");
  return { success: true };
}

export async function deleteRawMaterial(formData: FormData): Promise<void> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return;

  const id = formData.get("id");
  if (typeof id !== "string") return;

  const supabase = await createClient();
  await supabase
    .from("raw_materials")
    .delete()
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);

  revalidatePath("/inventory");
}

export async function receiveStock(
  prevState: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const rawMaterialId = formData.get("raw_material_id");
  const qtyRaw = formData.get("quantity");
  const note = formData.get("note");

  if (typeof rawMaterialId !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  const quantity = typeof qtyRaw === "string" ? parseFloat(qtyRaw) : NaN;
  if (isNaN(quantity) || quantity <= 0) {
    return { error: "กรุณากรอกจำนวนที่ถูกต้อง (> 0)" };
  }

  const supabase = await createClient();

  // Fetch current stock (tenant-scoped)
  const { data: mat } = await supabase
    .from("raw_materials")
    .select("current_stock")
    .eq("id", rawMaterialId)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (!mat) return { error: "ไม่พบวัตถุดิบ" };

  const newStock = Number(mat.current_stock) + quantity;

  const { error: updateErr } = await supabase
    .from("raw_materials")
    .update({ current_stock: newStock, updated_at: new Date().toISOString() })
    .eq("id", rawMaterialId)
    .eq("tenant_id", profile.tenant_id);

  if (updateErr) return { error: "อัปเดตสต็อกไม่สำเร็จ" };

  const { error: txErr } = await supabase.from("inventory_transactions").insert({
    tenant_id: profile.tenant_id,
    raw_material_id: rawMaterialId,
    type: "receive",
    quantity,
    note: typeof note === "string" && note.trim() !== "" ? note.trim() : null,
    created_by: profile.id,
  });

  if (txErr) return { error: "บันทึกประวัติไม่สำเร็จ" };

  revalidatePath("/inventory");
  return { success: true };
}

export async function adjustStock(
  prevState: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const rawMaterialId = formData.get("raw_material_id");
  const newStockRaw = formData.get("new_stock");
  const note = formData.get("note");

  if (typeof rawMaterialId !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  const newStock = typeof newStockRaw === "string" ? parseFloat(newStockRaw) : NaN;
  if (isNaN(newStock) || newStock < 0) {
    return { error: "กรุณากรอกจำนวนสต็อกที่ถูกต้อง (>= 0)" };
  }

  const supabase = await createClient();

  const { data: mat } = await supabase
    .from("raw_materials")
    .select("current_stock")
    .eq("id", rawMaterialId)
    .eq("tenant_id", profile.tenant_id)
    .single();

  if (!mat) return { error: "ไม่พบวัตถุดิบ" };

  const delta = newStock - Number(mat.current_stock);

  const { error: updateErr } = await supabase
    .from("raw_materials")
    .update({ current_stock: newStock, updated_at: new Date().toISOString() })
    .eq("id", rawMaterialId)
    .eq("tenant_id", profile.tenant_id);

  if (updateErr) return { error: "อัปเดตสต็อกไม่สำเร็จ" };

  const { error: txErr } = await supabase.from("inventory_transactions").insert({
    tenant_id: profile.tenant_id,
    raw_material_id: rawMaterialId,
    type: "adjust",
    quantity: delta,
    note: typeof note === "string" && note.trim() !== "" ? note.trim() : null,
    created_by: profile.id,
  });

  if (txErr) return { error: "บันทึกประวัติไม่สำเร็จ" };

  revalidatePath("/inventory");
  return { success: true };
}
