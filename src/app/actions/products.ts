"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";
import { parseMenuDraft, type MenuDraft } from "@/lib/product-input";
import {
  MAX_PRODUCT_IMAGE_BYTES,
  PRODUCT_IMAGE_BUCKET,
  PRODUCT_IMAGE_TYPES,
  productImagePath,
  storagePathFromPublicUrl,
} from "@/lib/product-images";

type ActionResult = { ok: true } | { error: string };

const FORBIDDEN = "ไม่มีสิทธิ์ดำเนินการนี้";
const NOT_FOUND = "ไม่พบสินค้า";
const ARCHIVED = "เมนูนี้ถูกเก็บแล้ว กรุณากู้คืนก่อนแก้ไข";
const SAVE_FAILED = "บันทึกข้อมูลไม่สำเร็จ";

// Messages raised by save_menu / replace_product_recipes / replace_product_modifiers.
const RPC_ERRORS: Record<string, string> = {
  forbidden: FORBIDDEN,
  product_not_found: NOT_FOUND,
  product_archived: ARCHIVED,
  invalid_material: "วัตถุดิบไม่ถูกต้อง กรุณารีเฟรชหน้า",
  invalid_modifier: "กลุ่มตัวเลือกไม่ถูกต้อง กรุณารีเฟรชหน้า",
  invalid_quantity: "ปริมาณวัตถุดิบไม่ถูกต้อง",
  invalid_category: "หมวดหมู่ไม่ถูกต้อง",
};

function isManagerOrOwner(role: string): boolean {
  return role === "owner" || role === "manager";
}

async function requireManager() {
  const profile = await getProfile();
  if (!profile || !isManagerOrOwner(profile.role)) return null;
  return profile;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Loads a product of this shop; distinguishes "missing" from "archived" for the error message. */
async function loadOwnProduct(supabase: Supabase, tenantId: string, productId: string) {
  const { data } = await supabase
    .from("products")
    .select("id, archived_at, image_url")
    .eq("id", productId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data;
}

function revalidateMenu() {
  revalidatePath("/products");
  revalidatePath("/pos");
}

/**
 * Deletes a product that has never been sold. A product with sales can't be deleted
 * (order_items keeps a FK to it for history and reports), so it is archived instead.
 */
export async function removeProduct(
  productId: string
): Promise<{ outcome: "deleted" | "archived" } | { error: string }> {
  const profile = await requireManager();
  if (!profile) return { error: FORBIDDEN };

  const supabase = await createClient();
  const product = await loadOwnProduct(supabase, profile.tenant_id, productId);
  if (!product) return { error: NOT_FOUND };
  if (product.archived_at !== null) return { outcome: "archived" };

  // An open held bill would reopen with a product that no longer exists on the POS.
  const { data: held, error: heldError } = await supabase
    .from("held_bills")
    .select("queue_number")
    .eq("tenant_id", profile.tenant_id)
    .eq("status", "open")
    .filter("items", "cs", JSON.stringify([{ productId }]));
  if (heldError) return { error: "ลบสินค้าไม่สำเร็จ" };
  if (held && held.length > 0) {
    const queues = held.map((h) => h.queue_number).sort((a, b) => a - b).join(", ");
    return { error: `เมนูนี้อยู่ในบิลพักที่ยังไม่ชำระ (คิว ${queues}) กรุณาชำระหรือแก้ไขบิลก่อน` };
  }

  const { data: deleted, error: deleteError } = await supabase
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("tenant_id", profile.tenant_id)
    .select("id");

  if (!deleteError) {
    if (!deleted || deleted.length === 0) return { error: NOT_FOUND };
    const imagePath = storagePathFromPublicUrl(product.image_url);
    if (imagePath) await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([imagePath]);
    revalidateMenu();
    return { outcome: "deleted" };
  }

  // 23503 = still referenced by order_items: the product has been sold.
  if (deleteError.code !== "23503") return { error: "ลบสินค้าไม่สำเร็จ" };

  const { data: archived, error: archiveError } = await supabase
    .from("products")
    .update({ archived_at: new Date().toISOString(), is_active: false })
    .eq("id", productId)
    .eq("tenant_id", profile.tenant_id)
    .is("archived_at", null)
    .select("id");
  if (archiveError) return { error: "ลบสินค้าไม่สำเร็จ" };
  if (!archived || archived.length === 0) {
    // Another tab/device archived it a moment ago: the outcome the user asked for already holds.
    const current = await loadOwnProduct(supabase, profile.tenant_id, productId);
    if (!current?.archived_at) return { error: "ลบสินค้าไม่สำเร็จ" };
  }

  revalidateMenu();
  return { outcome: "archived" };
}

/** Brings an archived product back, still closed, so it never reappears on the POS by surprise. */
export async function restoreProduct(productId: string): Promise<ActionResult> {
  const profile = await requireManager();
  if (!profile) return { error: FORBIDDEN };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update({ archived_at: null, is_active: false })
    .eq("id", productId)
    .eq("tenant_id", profile.tenant_id)
    .not("archived_at", "is", null)
    .select("id");
  if (error) return { error: "กู้คืนไม่สำเร็จ" };
  if (!data || data.length === 0) return { error: NOT_FOUND };

  revalidateMenu();
  return { ok: true };
}

function rpcError(message: string | undefined): string {
  return (message && RPC_ERRORS[message]) || SAVE_FAILED;
}

/**
 * The one-page menu editor's single save: menu fields, recipe and option links in one
 * transaction (save_menu). The database puts a new or re-categorised menu at the end of its
 * category.
 */
export async function saveMenu(
  productId: string | null,
  draft: MenuDraft
): Promise<{ ok: true; id: string; categoryId: string | null } | { error: string }> {
  const profile = await requireManager();
  if (!profile) return { error: FORBIDDEN };

  const parsed = parseMenuDraft(draft);
  if ("error" in parsed) return { error: parsed.error };
  const { menu, recipes, modifierIds } = parsed.value;

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("save_menu", {
    p_id: productId,
    p_menu: {
      name: menu.name,
      price: menu.price,
      description: menu.description,
      category_id: menu.categoryId,
      drink_type: menu.drinkType,
      is_active: menu.isActive,
    },
    p_recipes: recipes.map((r) => ({ raw_material_id: r.rawMaterialId, quantity_used: r.quantityUsed })),
    p_modifier_ids: modifierIds,
  });
  if (error || !id) return { error: rpcError(error?.message) };

  revalidateMenu();
  revalidatePath(`/products/${id}/edit`);
  return { ok: true, id, categoryId: menu.categoryId };
}

/** "ลบรูป" in the editor: the menu goes back to having no photo, and the file is removed. */
export async function removeProductImage(productId: string): Promise<ActionResult> {
  const profile = await requireManager();
  if (!profile) return { error: FORBIDDEN };

  const supabase = await createClient();
  const product = await loadOwnProduct(supabase, profile.tenant_id, productId);
  if (!product) return { error: NOT_FOUND };
  if (product.archived_at !== null) return { error: ARCHIVED };

  const { data, error } = await supabase
    .from("products")
    .update({ image_url: null })
    .eq("id", productId)
    .eq("tenant_id", profile.tenant_id)
    .is("archived_at", null)
    .select("id");
  if (error || !data || data.length === 0) return { error: "ลบรูปไม่สำเร็จ" };

  const oldPath = storagePathFromPublicUrl(product.image_url);
  if (oldPath) await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([oldPath]);

  revalidatePath(`/products/${productId}/edit`);
  revalidateMenu();
  return { ok: true };
}

export async function uploadProductImage(
  formData: FormData
): Promise<{ url: string } | { error: string }> {
  const profile = await requireManager();
  if (!profile) return { error: FORBIDDEN };

  const productId = formData.get("product_id");
  if (typeof productId !== "string" || productId === "") return { error: NOT_FOUND };

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return { error: "ไม่พบไฟล์" };
  if (!(file.type in PRODUCT_IMAGE_TYPES)) return { error: "รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP" };
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) return { error: "ไฟล์ขนาดใหญ่เกิน 5MB" };

  const supabase = await createClient();
  const product = await loadOwnProduct(supabase, profile.tenant_id, productId);
  if (!product) return { error: NOT_FOUND };
  if (product.archived_at !== null) return { error: ARCHIVED };

  const bucket = supabase.storage.from(PRODUCT_IMAGE_BUCKET);
  const path = productImagePath(profile.tenant_id, productId, file.type, Date.now());
  const { error: uploadError } = await bucket.upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) return { error: "อัปโหลดรูปภาพไม่สำเร็จ" };

  const { data: urlData } = bucket.getPublicUrl(path);
  const { data: updated, error: updateError } = await supabase
    .from("products")
    .update({ image_url: urlData.publicUrl })
    .eq("id", productId)
    .eq("tenant_id", profile.tenant_id)
    .is("archived_at", null)
    .select("id");
  if (updateError || !updated || updated.length === 0) {
    // Don't leave an orphan file behind when the product row didn't take it.
    await bucket.remove([path]);
    return { error: "อัปโหลดรูปภาพไม่สำเร็จ" };
  }

  const oldPath = storagePathFromPublicUrl(product.image_url);
  if (oldPath && oldPath !== path) await bucket.remove([oldPath]);

  revalidatePath(`/products/${productId}/edit`);
  revalidateMenu();
  return { url: urlData.publicUrl };
}
