"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";

type ActionResult = { ok: true } | { error: string };

const FORBIDDEN = "ไม่มีสิทธิ์ดำเนินการนี้";

const ERRORS: Record<string, string> = {
  forbidden: FORBIDDEN,
  // The list on screen no longer matches the database (another device/tab changed it).
  stale_order: "รายการมีการเปลี่ยนแปลง กรุณารีเฟรชหน้าแล้วจัดเรียงใหม่",
};

function toResult(error: { message?: string } | null): ActionResult {
  if (!error) return { ok: true };
  return { error: (error.message && ERRORS[error.message]) || "บันทึกลำดับไม่สำเร็จ" };
}

function revalidateMenu() {
  revalidatePath("/categories");
  revalidatePath("/products");
  revalidatePath("/pos");
}

async function isManager(): Promise<boolean> {
  const profile = await getProfile();
  return profile !== null && (profile.role === "owner" || profile.role === "manager");
}

/** `ids` is every category of the shop, in the new order. */
export async function reorderCategories(ids: string[]): Promise<ActionResult> {
  if (!(await isManager())) return { error: FORBIDDEN };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_categories", { p_ids: ids });
  const result = toResult(error);
  if ("ok" in result) revalidateMenu();
  return result;
}

/** `ids` is every non-archived menu of the category (null = uncategorized), in the new order. */
export async function reorderProducts(categoryId: string | null, ids: string[]): Promise<ActionResult> {
  if (!(await isManager())) return { error: FORBIDDEN };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_products", { p_category_id: categoryId, p_ids: ids });
  const result = toResult(error);
  if ("ok" in result) revalidateMenu();
  return result;
}
