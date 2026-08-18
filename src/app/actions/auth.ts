"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/dal";

export type SignInState = { error?: string } | undefined;

export async function signIn(
  prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = formData.get("email");
  const password = formData.get("password");
  const turnstileToken = formData.get("turnstile_token");

  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "กรุณากรอกอีเมลและรหัสผ่าน" };
  }
  if (typeof turnstileToken !== "string" || turnstileToken === "") {
    return { error: "กรุณายืนยันว่าคุณไม่ใช่บอท" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: turnstileToken },
  });

  if (error) {
    return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  }

  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete("worker_verified");
  redirect("/login");
}

export type SignUpState = { error?: string; success?: boolean } | undefined;

export async function signUp(
  prevState: SignUpState,
  formData: FormData
): Promise<SignUpState> {
  const storeName = formData.get("store_name");
  const email = formData.get("email");
  const password = formData.get("password");
  const confirmPassword = formData.get("confirm_password");
  const turnstileToken = formData.get("turnstile_token");

  if (
    typeof storeName !== "string" ||
    typeof email !== "string" ||
    typeof password !== "string" ||
    typeof confirmPassword !== "string" ||
    storeName.trim() === ""
  ) {
    return { error: "กรุณากรอกข้อมูลให้ครบถ้วน" };
  }
  if (password !== confirmPassword) {
    return { error: "รหัสผ่านไม่ตรงกัน" };
  }
  if (password.length < 6) {
    return { error: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" };
  }
  if (typeof turnstileToken !== "string" || turnstileToken === "") {
    return { error: "กรุณายืนยันว่าคุณไม่ใช่บอท" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { captchaToken: turnstileToken },
  });
  if (error || !data.user) {
    return { error: "สมัครสมาชิกไม่สำเร็จ อีเมลนี้อาจถูกใช้แล้ว" };
  }

  const { error: rpcError } = await supabase.rpc("create_tenant_and_owner", {
    p_user_id: data.user.id,
    p_store_name: storeName.trim(),
  });
  if (rpcError) {
    const admin = createAdminClient();
    const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
    if (deleteError) {
      console.error("Failed to clean up orphaned auth user:", deleteError);
    }
    console.error("create_tenant_and_owner failed:", rpcError);
    return { error: "สร้างร้านค้าไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ" };
  }

  if (!data.session) {
    return { success: true };
  }

  redirect("/job-level");
}

export type ForgotPasswordState = { error?: string; success?: boolean } | undefined;

export async function requestPasswordReset(
  prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = formData.get("email");
  const turnstileToken = formData.get("turnstile_token");
  if (typeof email !== "string" || email.trim() === "") {
    return { error: "กรุณากรอกอีเมล" };
  }
  if (typeof turnstileToken !== "string" || turnstileToken === "") {
    return { error: "กรุณายืนยันว่าคุณไม่ใช่บอท" };
  }

  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${origin}/reset-password`,
    captchaToken: turnstileToken,
  });

  // Always the same response, regardless of whether the email exists —
  // avoids leaking which emails are registered.
  return { success: true };
}

export type UpdatePasswordState = { error?: string; success?: boolean } | undefined;

export async function updatePassword(
  prevState: UpdatePasswordState,
  formData: FormData
): Promise<UpdatePasswordState> {
  const password = formData.get("password");
  const confirmPassword = formData.get("confirm_password");

  if (typeof password !== "string" || typeof confirmPassword !== "string") {
    return { error: "กรุณากรอกรหัสผ่านให้ครบถ้วน" };
  }
  if (password !== confirmPassword) {
    return { error: "รหัสผ่านไม่ตรงกัน" };
  }
  if (password.length < 6) {
    return { error: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "เปลี่ยนรหัสผ่านไม่สำเร็จ ลิงก์อาจหมดอายุ" };

  return { success: true };
}

export type SetBackupPasswordState = { error?: string } | undefined;

export async function setBackupPassword(
  prevState: SetBackupPasswordState,
  formData: FormData
): Promise<SetBackupPasswordState> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบใหม่" };

  const password = formData.get("password");
  const confirmPassword = formData.get("confirm_password");
  if (typeof password !== "string" || typeof confirmPassword !== "string") {
    return { error: "กรุณากรอกรหัสผ่านให้ครบถ้วน" };
  }
  if (password !== confirmPassword) {
    return { error: "รหัสผ่านไม่ตรงกัน" };
  }
  if (password.length < 6) {
    return { error: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" };
  }

  const supabase = await createClient();
  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) return { error: "ตั้งรหัสผ่านไม่สำเร็จ กรุณาลองใหม่" };

  const { data: updated, error: profileError } = await supabase
    .from("profiles")
    .update({ has_backup_password: true })
    .eq("id", profile.id)
    .select("id");
  if (profileError || !updated || updated.length === 0) {
    console.error(
      "setBackupPassword: failed to flag has_backup_password:",
      profileError ?? "update matched 0 rows (RLS rejected or row missing)"
    );
    return { error: "ตั้งรหัสผ่านไม่สำเร็จ กรุณาลองใหม่" };
  }

  redirect("/job-level");
}
