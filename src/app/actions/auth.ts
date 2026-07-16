"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type SignInState = { error?: string } | undefined;

export async function signIn(
  prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "กรุณากรอกอีเมลและรหัสผ่าน" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" };
  }

  redirect("/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type SignUpState = { error?: string } | undefined;

export async function signUp(
  prevState: SignUpState,
  formData: FormData
): Promise<SignUpState> {
  const storeName = formData.get("store_name");
  const email = formData.get("email");
  const password = formData.get("password");
  const confirmPassword = formData.get("confirm_password");

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

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
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

  redirect("/job-level");
}

export type ForgotPasswordState = { error?: string; success?: boolean } | undefined;

export async function requestPasswordReset(
  prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = formData.get("email");
  if (typeof email !== "string" || email.trim() === "") {
    return { error: "กรุณากรอกอีเมล" };
  }

  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/reset-password`,
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
