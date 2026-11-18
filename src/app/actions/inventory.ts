"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/dal";

export type InventoryState = { error?: string; success?: boolean; ledgerId?: string } | undefined;

function isManagerOrOwner(role: string): boolean {
  return role === "owner" || role === "manager";
}

type MaterialFields = {
  name: string;
  unit: string;
  cost_per_unit: number;
  min_stock_alert: number;
  category: string;
  purchase_unit: string | null;
  purchase_size: number | null;
  track_stock: boolean;
};

function parseMaterialFields(formData: FormData): { fields?: MaterialFields; error?: string } {
  const name = formData.get("name");
  const unit = formData.get("unit");
  const costRaw = formData.get("cost_per_unit");
  const minRaw = formData.get("min_stock_alert");
  const categoryRaw = formData.get("category");
  const purchaseUnitRaw = formData.get("purchase_unit");
  const purchaseSizeRaw = formData.get("purchase_size");

  if (typeof name !== "string" || name.trim() === "") return { error: "กรุณากรอกชื่อวัตถุดิบ" };
  if (typeof unit !== "string" || unit.trim() === "") return { error: "กรุณากรอกหน่วย" };
  const costPerUnit = typeof costRaw === "string" && costRaw !== "" ? parseFloat(costRaw) : 0;
  if (!Number.isFinite(costPerUnit) || costPerUnit < 0) return { error: "กรุณากรอกต้นทุนที่ถูกต้อง" };
  const minStock = typeof minRaw === "string" && minRaw !== "" ? parseFloat(minRaw) : 0;
  if (!Number.isFinite(minStock) || minStock < 0) return { error: "กรุณากรอกจำนวนเตือนที่ถูกต้อง" };

  const category =
    typeof categoryRaw === "string" && categoryRaw.trim() !== ""
      ? categoryRaw.trim().slice(0, 60)
      : "วัตถุดิบทั่วไป";

  const purchaseUnit =
    typeof purchaseUnitRaw === "string" && purchaseUnitRaw.trim() !== "" ? purchaseUnitRaw.trim() : null;
  let purchaseSize: number | null = null;
  if (typeof purchaseSizeRaw === "string" && purchaseSizeRaw.trim() !== "") {
    purchaseSize = parseFloat(purchaseSizeRaw);
    if (!Number.isFinite(purchaseSize) || purchaseSize <= 0) return { error: "กรุณากรอกขนาดที่ซื้อให้ถูกต้อง" };
  }
  if ((purchaseUnit === null) !== (purchaseSize === null)) {
    return { error: "ซื้อเป็น: กรอกทั้งชื่อหน่วยและขนาด หรือเว้นว่างทั้งคู่" };
  }

  return {
    fields: {
      name: name.trim(),
      unit: unit.trim(),
      cost_per_unit: costPerUnit,
      min_stock_alert: minStock,
      category,
      purchase_unit: purchaseUnit,
      purchase_size: purchaseSize,
      track_stock: formData.get("track_stock") === "on",
    },
  };
}

export async function createRawMaterial(
  prevState: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }
  const parsed = parseMaterialFields(formData);
  if (!parsed.fields) return { error: parsed.error };

  // Owner/manager only (checked above); the user client can no longer write stock tables.
  const { error } = await createAdminClient().from("raw_materials").insert({
    tenant_id: profile.tenant_id,
    ...parsed.fields,
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
  if (typeof id !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  const parsed = parseMaterialFields(formData);
  if (!parsed.fields) return { error: parsed.error };

  const { error } = await createAdminClient()
    .from("raw_materials")
    .update({ ...parsed.fields, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id);
  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };

  revalidatePath("/inventory");
  return { success: true };
}

// Owner-facing words for the stock functions' error codes (supabase/migrations/20261118140000_*).
function stockErrorMessage(message: string): string {
  if (message.includes("forbidden_price")) return "ไม่มีสิทธิ์ใส่ราคา";
  if (message.includes("undo_forbidden")) return "ไม่มีสิทธิ์ย้อนกลับรายการนี้";
  if (message.includes("undo_expired")) return "ย้อนกลับไม่ได้แล้ว (เกิน 10 นาที)";
  if (message.includes("already_undone")) return "รายการนี้ย้อนกลับไปแล้ว";
  if (message.includes("not_a_receive")) return "ไม่ใช่รายการรับของ";
  if (message.includes("forbidden")) return "ไม่มีสิทธิ์ดำเนินการนี้";
  if (message.includes("reason_required")) return "กรุณากรอกเหตุผล (ไม่เกิน 500 ตัวอักษร)";
  if (message.includes("material_not_found")) return "ไม่พบวัตถุดิบ";
  if (message.includes("invalid_qty")) return "จำนวนไม่ถูกต้อง";
  if (message.includes("invalid_note")) return "หมายเหตุยาวเกินไป (ไม่เกิน 500 ตัวอักษร)";
  if (message.includes("invalid_price")) return "ราคาไม่ถูกต้อง";
  return "บันทึกไม่สำเร็จ";
}

export async function deleteRawMaterial(formData: FormData): Promise<InventoryState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const id = formData.get("id");
  if (typeof id !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };

  // Archive, never delete: the ledger and recipes keep pointing at the material.
  const { data, error } = await createAdminClient()
    .from("raw_materials")
    .update({ archived_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .is("archived_at", null)
    .select("id");

  if (error) {
    console.error("[deleteRawMaterial]", error.message);
    return { error: "ปิดใช้ไม่สำเร็จ" };
  }
  if (!data || data.length === 0) return { error: "ไม่พบวัตถุดิบ" };

  revalidatePath("/inventory");
  return { success: true };
}

export async function unarchiveRawMaterial(formData: FormData): Promise<InventoryState> {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }
  const id = formData.get("id");
  if (typeof id !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };

  const { data, error } = await createAdminClient()
    .from("raw_materials")
    .update({ archived_at: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .not("archived_at", "is", null)
    .select("id");
  if (error) {
    console.error("[unarchiveRawMaterial]", error.message);
    return { error: "เปิดใช้ไม่สำเร็จ" };
  }
  if (!data || data.length === 0) return { error: "ไม่พบวัตถุดิบ" };

  revalidatePath("/inventory");
  return { success: true };
}

export async function receiveStock(
  prevState: InventoryState,
  formData: FormData
): Promise<InventoryState> {
  // Staff may receive without a price; the price is only honoured for owner/manager.
  const profile = await getProfile();
  if (!profile) return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };

  const rawMaterialId = formData.get("raw_material_id");
  const qtyRaw = formData.get("quantity");
  const priceRaw = formData.get("total_price");
  const noteRaw = formData.get("note");
  const note = typeof noteRaw === "string" && noteRaw.trim() !== "" ? noteRaw.trim() : null;
  if (note !== null && note.length > 500) return { error: "หมายเหตุยาวเกินไป (ไม่เกิน 500 ตัวอักษร)" };

  if (typeof rawMaterialId !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  const quantity = typeof qtyRaw === "string" ? parseFloat(qtyRaw) : NaN;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { error: "กรุณากรอกจำนวนที่ถูกต้อง (> 0)" };
  }

  let totalPrice: number | null = null;
  if (isManagerOrOwner(profile.role) && typeof priceRaw === "string" && priceRaw.trim() !== "") {
    totalPrice = parseFloat(priceRaw);
    if (!Number.isFinite(totalPrice) || totalPrice < 0) {
      return { error: "กรุณากรอกราคาที่ถูกต้อง" };
    }
  }

  const { data: ledgerId, error } = await createAdminClient().rpc("stock_receive", {
    p_tenant_id: profile.tenant_id,
    p_actor_id: profile.id,
    p_material_id: rawMaterialId,
    p_qty: quantity,
    p_total_price: totalPrice,
    p_note: note,
  });
  if (error) {
    console.error("[receiveStock]", error.message);
    return { error: stockErrorMessage(error.message) };
  }

  revalidatePath("/inventory");
  return { success: true, ledgerId: ledgerId ?? undefined };
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
  const reason = formData.get("reason") ?? formData.get("note");

  if (typeof rawMaterialId !== "string") return { error: "ข้อมูลไม่ถูกต้อง" };
  const newStock = typeof newStockRaw === "string" ? parseFloat(newStockRaw) : NaN;
  if (!Number.isFinite(newStock) || newStock < 0) {
    return { error: "กรุณากรอกจำนวนสต็อกที่ถูกต้อง (>= 0)" };
  }
  if (typeof reason !== "string" || reason.trim() === "" || reason.trim().length > 500) {
    return { error: "กรุณากรอกเหตุผล (ไม่เกิน 500 ตัวอักษร)" };
  }

  const { error } = await createAdminClient().rpc("stock_adjust", {
    p_tenant_id: profile.tenant_id,
    p_actor_id: profile.id,
    p_material_id: rawMaterialId,
    p_new_balance: newStock,
    p_reason: reason.trim(),
  });
  if (error) {
    console.error("[adjustStock]", error.message);
    return { error: stockErrorMessage(error.message) };
  }

  revalidatePath("/inventory");
  return { success: true };
}

/** Undo a receive within 10 minutes (the receiver, or an owner/manager). Used by Task 10's UI. */
export async function undoReceive(ledgerId: string): Promise<InventoryState> {
  const profile = await getProfile();
  if (!profile) return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  if (typeof ledgerId !== "string" || ledgerId === "") return { error: "ข้อมูลไม่ถูกต้อง" };

  const { error } = await createAdminClient().rpc("stock_receive_undo", {
    p_tenant_id: profile.tenant_id,
    p_actor_id: profile.id,
    p_ledger_id: ledgerId,
  });
  if (error) {
    console.error("[undoReceive]", error.message);
    return { error: stockErrorMessage(error.message) };
  }

  revalidatePath("/inventory");
  return { success: true };
}
