"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/dal";
import { PRODUCT_IMAGE_BUCKET, storagePathFromPublicUrl } from "@/lib/product-images";
import { LOGO_MAX_BYTES, logoPath } from "@/lib/logo-image";

const FORBIDDEN = "ไม่มีสิทธิ์ดำเนินการนี้";
const UPLOAD_FAILED = "อัปโหลดโลโก้ไม่สำเร็จ";
const REMOVE_FAILED = "ลบโลโก้ไม่สำเร็จ";

async function requireOwner() {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") return null;
  return profile;
}

export async function uploadShopLogo(
  formData: FormData
): Promise<{ url: string } | { error: string }> {
  const profile = await requireOwner();
  if (!profile) return { error: FORBIDDEN };

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { error: "ไม่พบไฟล์" };
  if (file.type !== "image/png") return { error: "รองรับเฉพาะไฟล์ PNG" };
  if (file.size > LOGO_MAX_BYTES) return { error: "ไฟล์โลโก้ใหญ่เกินไป" };

  const supabase = await createClient();
  const { data: tenant, error: readError } = await supabase
    .from("tenants")
    .select("logo_url")
    .eq("id", profile.tenant_id)
    .single();
  if (readError || !tenant) return { error: UPLOAD_FAILED };

  const bucket = supabase.storage.from(PRODUCT_IMAGE_BUCKET);
  const path = logoPath(profile.tenant_id, Date.now());
  const { error: uploadError } = await bucket.upload(path, file, {
    contentType: "image/png",
    upsert: false,
  });
  if (uploadError) return { error: UPLOAD_FAILED };

  const { data: urlData } = bucket.getPublicUrl(path);
  const { data: updated, error: updateError } = await supabase
    .from("tenants")
    .update({ logo_url: urlData.publicUrl })
    .eq("id", profile.tenant_id)
    .select("id");
  if (updateError || !updated || updated.length === 0) {
    // Don't leave an orphan file behind when the row didn't take it.
    await bucket.remove([path]);
    return { error: UPLOAD_FAILED };
  }

  const oldPath = storagePathFromPublicUrl(tenant.logo_url);
  if (oldPath && oldPath !== path) await bucket.remove([oldPath]);

  revalidatePath("/settings");
  return { url: urlData.publicUrl };
}

export async function removeShopLogo(): Promise<{ ok: true } | { error: string }> {
  const profile = await requireOwner();
  if (!profile) return { error: FORBIDDEN };

  const supabase = await createClient();
  const { data: tenant, error: readError } = await supabase
    .from("tenants")
    .select("logo_url")
    .eq("id", profile.tenant_id)
    .single();
  if (readError || !tenant) return { error: REMOVE_FAILED };

  const { data: updated, error: updateError } = await supabase
    .from("tenants")
    .update({ logo_url: null })
    .eq("id", profile.tenant_id)
    .select("id");
  if (updateError || !updated || updated.length === 0) return { error: REMOVE_FAILED };

  const oldPath = storagePathFromPublicUrl(tenant.logo_url);
  if (oldPath) await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([oldPath]);

  revalidatePath("/settings");
  return { ok: true };
}
