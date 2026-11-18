"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/dal";
import { parseMaterialInput } from "@/lib/stock/material-input";

export type InventoryState = { error?: string; success?: boolean; ledgerId?: string } | undefined;

function isManagerOrOwner(role: string): boolean {
  return role === "owner" || role === "manager";
}

function parseMaterialFields(formData: FormData) {
  return parseMaterialInput((k) => {
    const v = formData.get(k);
    return typeof v === "string" ? v : null;
  });
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

  // An absent track_stock leaves the column unchanged; archived rows stay read-only.
  const { track_stock, ...rest } = parsed.fields;
  const { data, error } = await createAdminClient()
    .from("raw_materials")
    .update({
      ...rest,
      ...(track_stock === undefined ? {} : { track_stock }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .is("archived_at", null)
    .select("id");
  if (error) return { error: "บันทึกข้อมูลไม่สำเร็จ" };
  if (!data || data.length === 0) return { error: "วัตถุดิบนี้ปิดใช้แล้ว" };

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
