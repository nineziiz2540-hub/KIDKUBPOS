"use server";
// POS stock actions (round D2a): "ไม่มีแล้ว ปิดขาย" / "เปิดขายแล้วสั่ง", and the "ยอดน่าจะผิด" flag when
// the cashier sells a material the system thinks is out. Any active member of the shop may do both
// (spec §8 table). The service-role functions check the actor belongs to the shop and is active
// (supabase/migrations/20261123130000_stock_d2a_functions.sql); they never block a sale.
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/dal";
import { loadStockCatalog } from "@/lib/stock/catalog";
import { resolveLine } from "@/lib/stock/stock-core";
import { toLineChoices } from "@/lib/order-pricing-core";
import {
  keepCountedLines, NO_COUNTED_MATERIALS, parseWasteInput, wasteLabel, wasteReasonText, wasteUndoErrorMessage,
  type WasteInput, type WasteNames,
} from "@/lib/stock/waste-input";

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

/**
 * "บันทึกของเสีย": a menu (its recipe resolved on the server from the shop's own catalog, packaging
 * included unless the shop's own glass is used, D2-6) or one material. Any active member of the shop.
 * The caller, the shop and the new record id (p_ref_id) all come from here, never from the arguments.
 */
export async function recordWaste(raw: WasteInput): Promise<{ refId: string; label: string } | { error: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  const parsed = parseWasteInput(raw);
  if ("error" in parsed) return { error: parsed.error };
  const input = parsed.value;

  const admin = createAdminClient();
  let lines: { material_id: string; qty: number }[];
  let names: WasteNames;

  if (input.kind === "menu") {
    const { data: product } = await admin
      .from("products")
      .select("name")
      .eq("id", input.productId)
      .eq("tenant_id", profile.tenant_id)
      .eq("is_active", true)
      .is("archived_at", null)
      .maybeSingle();
    if (!product) return { error: "ไม่พบเมนูนี้ (อาจถูกเก็บเข้าคลังแล้ว)" };
    const loaded = await loadStockCatalog(admin, profile.tenant_id, [input.productId], input.optionIds);
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
            .eq("tenant_id", profile.tenant_id)
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
      .eq("tenant_id", profile.tenant_id)
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
    p_tenant_id: profile.tenant_id,
    p_actor_id: profile.id,
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
export async function undoWaste(refId: string): Promise<{ error?: string }> {
  const profile = await getProfile();
  if (!profile) return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  if (typeof refId !== "string" || !/^[0-9a-f-]{36}$/i.test(refId)) return { error: wasteUndoErrorMessage("not_found") };

  const { error } = await createAdminClient().rpc("stock_waste_undo", {
    p_tenant_id: profile.tenant_id,
    p_actor_id: profile.id,
    p_ref_id: refId,
  });
  if (error) {
    console.error("[undoWaste]", error.message);
    return { error: wasteUndoErrorMessage(error.message) };
  }
  return {};
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
