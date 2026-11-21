"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/dal";
import { parseMaterialInput } from "@/lib/stock/material-input";
import { parseReceiveFields } from "@/lib/stock/receive-input";
// Owner-facing words for the stock functions' error codes (stockErrorMessage), and the receive/undo writes
// shared with the POS's /api/stock/receive and /api/stock/receive-undo.
import {
  isManagerOrOwner, receiveStockCore, stockActor, stockErrorMessage, undoReceiveCore,
} from "@/lib/stock/stock-writes";

export type InventoryState = { error?: string; success?: boolean; ledgerId?: string } | undefined;

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

  // The same checks as the POS's /api/stock/receive (parseReceiveFields), and the same write.
  const parsed = parseReceiveFields((k) => formData.get(k), isManagerOrOwner(profile.role));
  if ("error" in parsed) return { error: parsed.error };
  return receiveStockCore(stockActor(profile), parsed.value);
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

  const res = await undoReceiveCore(stockActor(profile), ledgerId);
  return res.error ? { error: res.error } : { success: true };
}
