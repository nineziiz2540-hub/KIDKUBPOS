"use server";
// "ชุดภาชนะ" (round D2a, Task 8): owner/manager create, edit and archive packaging sets. Both writes go through
// the user client to the SECURITY INVOKER functions save_packaging_set / archive_packaging_set (migration
// 20261123130000), which re-check the role, the caller's shop and every material in SQL, in one transaction.
// The tenant always comes from the session, never from the caller's arguments.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";
import {
  packagingRpcError,
  packagingSetPayload,
  parsePackagingSetDraft,
  setInUseMessage,
} from "@/lib/stock/packaging-input";
import type { Json } from "@/types/database";

const NO_RIGHT = "ไม่มีสิทธิ์ดำเนินการนี้";
const BAD_INPUT = "ข้อมูลไม่ถูกต้อง กรุณารีเฟรชหน้า";

async function requireManager() {
  const profile = await getProfile();
  if (!profile || (profile.role !== "owner" && profile.role !== "manager")) return null;
  return profile;
}

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

function revalidatePackaging() {
  revalidatePath("/inventory/packaging");
  revalidatePath("/products"); // the menu editor lists the sets
  revalidatePath("/pos"); // the till deducts each menu's set
}

/** "บันทึก" on the set form: creates a set (setId null) or edits one; its items are replaced as a whole. */
export async function savePackagingSet(
  setId: string | null,
  draft: unknown
): Promise<{ ok: true; id: string; name: string } | { error: string }> {
  const profile = await requireManager();
  if (!profile) return { error: NO_RIGHT };
  if (setId !== null && !isId(setId)) return { error: BAD_INPUT };

  const parsed = parsePackagingSetDraft(draft);
  if ("error" in parsed) return { error: parsed.error };
  const { p_name, p_items } = packagingSetPayload(parsed.value);

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("save_packaging_set", {
    p_id: setId, // null creates a new set
    p_name,
    p_items: p_items as unknown as Json,
  });
  if (error || !id) return { error: packagingRpcError(error?.message) };

  revalidatePackaging();
  return { ok: true, id, name: p_name };
}

/**
 * "เก็บเข้าคลัง": refused while a menu that is not archived uses the set. The refusal names those menus
 * ("ใช้อยู่ในเมนู: ลาเต้, อเมริกาโน่") so the owner knows which ones to change first.
 */
export async function archivePackagingSet(setId: string): Promise<{ ok: true } | { error: string }> {
  const profile = await requireManager();
  if (!profile) return { error: NO_RIGHT };
  if (!isId(setId)) return { error: BAD_INPUT };

  const supabase = await createClient();
  const { error } = await supabase.rpc("archive_packaging_set", { p_id: setId });
  if (error) {
    if (error.message !== "set_in_use") return { error: packagingRpcError(error.message) };
    const { data: menus } = await supabase
      .from("products")
      .select("name")
      .eq("tenant_id", profile.tenant_id)
      .eq("packaging_set_id", setId)
      .is("archived_at", null)
      .order("name");
    return { error: setInUseMessage((menus ?? []).map((m) => m.name)) };
  }

  revalidatePackaging();
  return { ok: true };
}
