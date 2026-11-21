"use server";
// Stock actions of round D2a: "ปิดขาย" / "เปิดขาย", the "ยอดน่าจะผิด" flag, waste and its undo, and the
// owner's "ตรวจแล้ว". Any active member of the shop may pause, flag and waste (spec §8 table). The
// service-role functions check the actor belongs to the shop and is active
// (supabase/migrations/20261123130000_stock_d2a_functions.sql); they never block a sale.
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/dal";
import { parseWasteInput, wasteUndoErrorMessage, type WasteInput } from "@/lib/stock/waste-input";
import { normalizeFlagIds } from "@/lib/stock/stock-api";
import {
  flagSoldWhileOutCore, recordWasteCore, setMenuPausedCore, stockActor, undoWasteCore,
} from "@/lib/stock/stock-writes";

// The POS itself calls the JSON route handlers (/api/stock/*, final review I3) instead of these, so a
// stalled stock write never sits in the one-at-a-time server-action queue ahead of a payment. The
// writes are shared (src/lib/stock/stock-writes.ts); these actions stay for the owner pages.

/** "ปิดขาย" (paused true) or "เปิดขาย" (false) a menu of the caller's shop. */
export async function setMenuPaused(productId: string, paused: boolean): Promise<{ error?: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  if (typeof productId !== "string" || productId === "" || typeof paused !== "boolean") {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }
  return setMenuPausedCore(stockActor(profile), productId, paused);
}

/**
 * "ยังมีของ ขายต่อ": one "ยอดน่าจะผิด" flag per material per business day (the function ignores
 * repeats). Best-effort: a failure is only logged.
 */
export async function flagSoldWhileOut(materialIds: string[], productId: string): Promise<void> {
  const profile = await getProfile();
  if (!profile) return;
  if (typeof productId !== "string") return;
  const ids = normalizeFlagIds(materialIds);
  if (ids === null) return;
  await flagSoldWhileOutCore(stockActor(profile), ids, productId === "" ? null : productId);
}

/**
 * "บันทึกของเสีย": a menu or one material (recordWasteCore). Any active member of the shop. The caller,
 * the shop and the new record id all come from the server, never from the arguments.
 */
export async function recordWaste(raw: WasteInput): Promise<{ refId: string; label: string } | { error: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  const parsed = parseWasteInput(raw);
  if ("error" in parsed) return { error: parsed.error };
  return recordWasteCore(stockActor(profile), parsed.value);
}

/** "ย้อนกลับ" of a waste record: 10 minutes, once, the recorder or an owner/manager (decided by the function). */
export async function undoWaste(refId: string): Promise<{ error?: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  if (typeof refId !== "string" || !/^[0-9a-f-]{36}$/i.test(refId)) return { error: wasteUndoErrorMessage("not_found") };
  return undoWasteCore(stockActor(profile), refId);
}

/** Plain Thai for stock_flag_resolve's error codes (R-D2a-28); never a raw code on screen. */
function resolveFlagErrorMessage(message: string): string {
  if (message.includes("forbidden")) return "ไม่มีสิทธิ์ดำเนินการนี้";
  if (message.includes("not_found")) return "รายการนี้ตรวจไปแล้วหรือไม่พบ";
  return "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง";
}

/** "ตรวจแล้ว": the owner/manager has looked at a "ยอดน่าจะผิด" flag. The function checks the role. */
export async function resolveStockFlag(flagId: string): Promise<{ error?: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  if (typeof flagId !== "string" || !/^[0-9a-f-]{36}$/i.test(flagId)) {
    return { error: resolveFlagErrorMessage("not_found") };
  }

  const { error } = await createAdminClient().rpc("stock_flag_resolve", {
    p_tenant_id: profile.tenant_id,
    p_actor_id: profile.id,
    p_flag_id: flagId,
  });
  if (error) {
    console.error("[resolveStockFlag]", error.message);
    return { error: resolveFlagErrorMessage(error.message) };
  }
  revalidatePath("/inventory");
  return {};
}
