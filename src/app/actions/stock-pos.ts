"use server";
// POS stock actions (round D2a): "ไม่มีแล้ว ปิดขาย" / "เปิดขายแล้วสั่ง", and the "ยอดน่าจะผิด" flag when
// the cashier sells a material the system thinks is out. Any active member of the shop may do both
// (spec §8 table). The service-role functions check the actor belongs to the shop and is active
// (supabase/migrations/20261123130000_stock_d2a_functions.sql); they never block a sale.
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/dal";

/** The most material ids one flag call takes: a cup never has more out materials than this. */
const MAX_FLAG_MATERIALS = 20;

/** Plain Thai for the functions' error codes (R-D2a-9); never a raw code on screen. */
function pauseErrorMessage(message: string, paused: boolean): string {
  if (message.includes("forbidden")) return "ไม่มีสิทธิ์ดำเนินการนี้";
  if (message.includes("invalid_paused")) return "ข้อมูลไม่ถูกต้อง";
  if (message.includes("product_not_found") || message.includes("not_found")) return "ไม่พบเมนูนี้ (อาจถูกเก็บเข้าคลังแล้ว)";
  return paused ? "ปิดขายไม่สำเร็จ ลองใหม่อีกครั้ง" : "เปิดขายไม่สำเร็จ ลองใหม่อีกครั้ง";
}

/** "ปิดขาย" (paused true) or "เปิดขาย" (false) a menu of the caller's shop. */
export async function setMenuPaused(productId: string, paused: boolean): Promise<{ error?: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  if (typeof productId !== "string" || productId === "" || typeof paused !== "boolean") {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }

  const { error } = await createAdminClient().rpc("set_menu_paused", {
    p_tenant_id: profile.tenant_id,
    p_actor_id: profile.id,
    p_product_id: productId,
    p_paused: paused,
  });
  if (error) {
    console.error("[setMenuPaused]", error.message);
    return { error: pauseErrorMessage(error.message, paused) };
  }
  return {};
}

/**
 * "ยังมีของ ขายต่อ": one "ยอดน่าจะผิด" flag per material per business day (the function ignores
 * repeats). Best-effort: the POS never waits for it, and a failure is only logged.
 */
export async function flagSoldWhileOut(materialIds: string[], productId: string): Promise<void> {
  const profile = await getProfile();
  if (!profile) return;
  if (!Array.isArray(materialIds) || typeof productId !== "string") return;
  const ids = [...new Set(materialIds.filter((id): id is string => typeof id === "string" && id !== ""))];
  if (ids.length === 0 || ids.length > MAX_FLAG_MATERIALS) return;

  const { error } = await createAdminClient().rpc("stock_flag_sold_while_out", {
    p_tenant_id: profile.tenant_id,
    p_actor_id: profile.id,
    p_material_ids: ids,
    p_product_id: productId === "" ? null : productId,
  });
  if (error) console.error("[flagSoldWhileOut]", error.message);
}
