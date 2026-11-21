import "server-only";
// The stock writes shared by the server actions (owner/inventory pages) and the POS's JSON route
// handlers (/api/stock/*, final review I3, R-D2a-30): one copy of each write, so the two doors can never
// drift apart. Each takes an already-checked input and the actor from the signed-in profile (the shop,
// the person); the service-role functions check again that the actor belongs to the shop and is active
// (supabase/migrations/20261123130000_stock_d2a_functions.sql), and none of them ever blocks a sale.
// Every error is plain Thai; a raw database code never leaves this file.
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadStockCatalog } from "@/lib/stock/catalog";
import { resolveLine } from "@/lib/stock/stock-core";
import { toLineChoices } from "@/lib/order-pricing-core";
import type { ReceiveFields } from "@/lib/stock/receive-input";
import {
  keepCountedLines, NO_COUNTED_MATERIALS, wasteLabel, wasteReasonText, wasteUndoErrorMessage,
  type WasteInput, type WasteNames,
} from "@/lib/stock/waste-input";

/** Who is writing: always from getProfile(), never from the request. */
export type StockActor = { tenantId: string; actorId: string; role: string };

export function stockActor(profile: { tenant_id: string; id: string; role: string }): StockActor {
  return { tenantId: profile.tenant_id, actorId: profile.id, role: profile.role };
}

export function isManagerOrOwner(role: string): boolean {
  return role === "owner" || role === "manager";
}

/** Plain Thai for set_menu_paused's error codes (R-D2a-9); never a raw code on screen. */
function pauseErrorMessage(message: string, paused: boolean): string {
  if (message.includes("forbidden")) return "ไม่มีสิทธิ์ดำเนินการนี้";
  if (message.includes("invalid_paused")) return "ข้อมูลไม่ถูกต้อง";
  if (message.includes("product_not_found") || message.includes("not_found")) return "ไม่พบเมนูนี้ (อาจถูกเก็บเข้าคลังแล้ว)";
  return paused ? "ปิดขายไม่สำเร็จ ลองใหม่อีกครั้ง" : "เปิดขายไม่สำเร็จ ลองใหม่อีกครั้ง";
}

/** Plain Thai for the D1 stock functions' error codes (receive, adjust, undo). */
export function stockErrorMessage(message: string): string {
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

/** "ปิดขาย" (paused true) or "เปิดขาย" (false) a menu of the actor's shop. Any active member (spec §8). */
export async function setMenuPausedCore(actor: StockActor, productId: string, paused: boolean): Promise<{ error?: string }> {
  const { error } = await createAdminClient().rpc("set_menu_paused", {
    p_tenant_id: actor.tenantId,
    p_actor_id: actor.actorId,
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
export async function flagSoldWhileOutCore(actor: StockActor, materialIds: string[], productId: string | null): Promise<{ error?: string }> {
  const { error } = await createAdminClient().rpc("stock_flag_sold_while_out", {
    p_tenant_id: actor.tenantId,
    p_actor_id: actor.actorId,
    p_material_ids: materialIds,
    p_product_id: productId,
  });
  if (error) {
    console.error("[flagSoldWhileOut]", error.message);
    return { error: "บันทึกไม่สำเร็จ" };
  }
  return {};
}

/**
 * "บันทึกของเสีย": a menu (its recipe resolved on the server from the shop's own catalog, packaging
 * included unless the shop's own glass is used, D2-6) or one material. Any active member of the shop.
 * The caller, the shop and the new record id (p_ref_id) all come from here, never from the input.
 */
export async function recordWasteCore(actor: StockActor, input: WasteInput): Promise<{ refId: string; label: string } | { error: string }> {
  const admin = createAdminClient();
  let lines: { material_id: string; qty: number }[];
  let names: WasteNames;

  if (input.kind === "menu") {
    const { data: product } = await admin
      .from("products")
      .select("name")
      .eq("id", input.productId)
      .eq("tenant_id", actor.tenantId)
      .eq("is_active", true)
      .is("archived_at", null)
      .maybeSingle();
    if (!product) return { error: "ไม่พบเมนูนี้ (อาจถูกเก็บเข้าคลังแล้ว)" };
    const loaded = await loadStockCatalog(admin, actor.tenantId, [input.productId], input.optionIds);
    if ("error" in loaded) return { error: loaded.error };
    const resolved = resolveLine(
      input.productId,
      input.quantity,
      toLineChoices({ choices: input.choices, houseGlass: input.houseGlass }),
      input.optionIds,
      loaded.catalog
    );
    if ("error" in resolved) return { error: resolved.error };
    const resolvedLines = resolved.stock.map((l) => ({ material_id: l.materialId, qty: l.qty }));
    // stock_waste skips materials that are untracked or archived without a word: keep only the counted
    // ones here, and refuse a waste that would write nothing (no false "saved" toast, R-D2a-25).
    const { data: counted, error: countedError } =
      resolvedLines.length === 0
        ? { data: [], error: null }
        : await admin
            .from("raw_materials")
            .select("id")
            .eq("tenant_id", actor.tenantId)
            .eq("track_stock", true)
            .is("archived_at", null)
            .in("id", resolvedLines.map((l) => l.material_id));
    if (countedError) {
      console.error("[recordWaste]", countedError.message);
      return { error: "บันทึกของเสียไม่สำเร็จ ลองใหม่อีกครั้ง" };
    }
    lines = keepCountedLines(resolvedLines, new Set((counted ?? []).map((m) => m.id)));
    if (lines.length === 0) return { error: NO_COUNTED_MATERIALS };
    names = { name: product.name, parts: resolved.snapshot.slots.map((s) => s.label) };
  } else {
    const { data: material } = await admin
      .from("raw_materials")
      .select("name, unit, track_stock, archived_at")
      .eq("id", input.materialId)
      .eq("tenant_id", actor.tenantId)
      .maybeSingle();
    if (!material || material.archived_at !== null || !material.track_stock) {
      return { error: "ไม่พบวัตถุดิบนี้ (หรือไม่ได้นับสต๊อก)" };
    }
    lines = [{ material_id: input.materialId, qty: input.qty }];
    names = { name: material.name, unit: material.unit };
  }

  const label = wasteLabel(input, names);
  const refId = crypto.randomUUID();
  const { error } = await admin.rpc("stock_waste", {
    p_tenant_id: actor.tenantId,
    p_actor_id: actor.actorId,
    p_lines: lines,
    p_reason: wasteReasonText(input, label),
    p_ref_id: refId,
  });
  if (error) {
    console.error("[recordWaste]", error.message);
    return { error: "บันทึกของเสียไม่สำเร็จ ลองใหม่อีกครั้ง" };
  }
  return { refId, label };
}

/** "ย้อนกลับ" of a waste record: 10 minutes, once, the recorder or an owner/manager (decided by the function). */
export async function undoWasteCore(actor: StockActor, refId: string): Promise<{ error?: string }> {
  const { error } = await createAdminClient().rpc("stock_waste_undo", {
    p_tenant_id: actor.tenantId,
    p_actor_id: actor.actorId,
    p_ref_id: refId,
  });
  if (error) {
    console.error("[undoWaste]", error.message);
    return { error: wasteUndoErrorMessage(error.message) };
  }
  return {};
}

/**
 * "รับของเข้า": any active member; the price was already dropped for staff (parseReceiveFields), and the
 * function refuses a staff price again. The inventory page then shows the new level.
 */
export async function receiveStockCore(actor: StockActor, fields: ReceiveFields): Promise<{ error: string } | { success: true; ledgerId?: string }> {
  const { data: ledgerId, error } = await createAdminClient().rpc("stock_receive", {
    p_tenant_id: actor.tenantId,
    p_actor_id: actor.actorId,
    p_material_id: fields.materialId,
    p_qty: fields.quantity,
    p_total_price: fields.totalPrice,
    p_note: fields.note,
  });
  if (error) {
    console.error("[receiveStock]", error.message);
    return { error: stockErrorMessage(error.message) };
  }
  revalidatePath("/inventory");
  return { success: true, ledgerId: ledgerId ?? undefined };
}

/** Undo a receive within 10 minutes (the receiver, or an owner/manager; decided by the function). */
export async function undoReceiveCore(actor: StockActor, ledgerId: string): Promise<{ error?: string }> {
  const { error } = await createAdminClient().rpc("stock_receive_undo", {
    p_tenant_id: actor.tenantId,
    p_actor_id: actor.actorId,
    p_ledger_id: ledgerId,
  });
  if (error) {
    console.error("[undoReceive]", error.message);
    return { error: stockErrorMessage(error.message) };
  }
  revalidatePath("/inventory");
  return {};
}
