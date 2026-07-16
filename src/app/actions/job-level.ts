"use server";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/dal";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_SECONDS = 30;
const WORKER_COOKIE = "worker_verified";

export type PinState = { error?: string } | undefined;

export async function setOwnPin(
  prevState: PinState,
  formData: FormData
): Promise<PinState> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบใหม่" };
  if (profile.pin_hash !== null) return { error: "คุณตั้ง PIN ไว้แล้ว" };

  const pin = formData.get("pin");
  const pinConfirm = formData.get("pin_confirm");
  if (
    typeof pin !== "string" ||
    typeof pinConfirm !== "string" ||
    !/^\d{6}$/.test(pin) ||
    pin !== pinConfirm
  ) {
    return { error: "PIN ต้องเป็นตัวเลข 6 หลัก และตรงกันทั้ง 2 ช่อง" };
  }

  const supabase = await createClient();
  const pinHash = await bcrypt.hash(pin, 10);
  const { error } = await supabase
    .from("profiles")
    .update({ pin_hash: pinHash })
    .eq("id", profile.id);
  if (error) return { error: "ตั้ง PIN ไม่สำเร็จ" };

  const cookieStore = await cookies();
  cookieStore.set(WORKER_COOKIE, profile.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect("/");
}

export async function verifyOwnPin(
  prevState: PinState,
  formData: FormData
): Promise<PinState> {
  const profile = await getProfile();
  if (!profile) return { error: "กรุณาเข้าสู่ระบบใหม่" };
  if (profile.pin_hash === null) return { error: "ยังไม่ได้ตั้ง PIN" };

  if (profile.pin_locked_until && new Date(profile.pin_locked_until) > new Date()) {
    const secondsLeft = Math.ceil(
      (new Date(profile.pin_locked_until).getTime() - Date.now()) / 1000
    );
    return { error: `ลองใหม่ในอีก ${secondsLeft} วินาที` };
  }

  const pin = formData.get("pin");
  if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
    return { error: "PIN ไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const correct = await bcrypt.compare(pin, profile.pin_hash);

  if (!correct) {
    const attempts = profile.pin_failed_attempts + 1;
    const lockedOut = attempts >= LOCKOUT_THRESHOLD;
    await supabase
      .from("profiles")
      .update({
        pin_failed_attempts: lockedOut ? 0 : attempts,
        pin_locked_until: lockedOut
          ? new Date(Date.now() + LOCKOUT_SECONDS * 1000).toISOString()
          : null,
      })
      .eq("id", profile.id);
    return { error: "PIN ไม่ถูกต้อง" };
  }

  await supabase
    .from("profiles")
    .update({ pin_failed_attempts: 0, pin_locked_until: null })
    .eq("id", profile.id);

  const cookieStore = await cookies();
  cookieStore.set(WORKER_COOKIE, profile.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect("/");
}

export async function switchToMember(
  prevState: PinState,
  formData: FormData
): Promise<PinState> {
  const callerProfile = await getProfile();
  if (!callerProfile) return { error: "กรุณาเข้าสู่ระบบใหม่" };

  const memberId = formData.get("member_id");
  const pin = formData.get("pin");
  if (typeof memberId !== "string" || typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("id, pin_hash, pin_failed_attempts, pin_locked_until")
    .eq("id", memberId)
    .eq("tenant_id", callerProfile.tenant_id)
    .single();

  if (!target || !target.pin_hash) {
    return { error: "ไม่พบข้อมูลพนักงาน" };
  }
  if (target.pin_locked_until && new Date(target.pin_locked_until) > new Date()) {
    const secondsLeft = Math.ceil(
      (new Date(target.pin_locked_until).getTime() - Date.now()) / 1000
    );
    return { error: `ลองใหม่ในอีก ${secondsLeft} วินาที` };
  }

  const correct = await bcrypt.compare(pin, target.pin_hash);
  if (!correct) {
    const attempts = target.pin_failed_attempts + 1;
    const lockedOut = attempts >= LOCKOUT_THRESHOLD;
    await admin
      .from("profiles")
      .update({
        pin_failed_attempts: lockedOut ? 0 : attempts,
        pin_locked_until: lockedOut
          ? new Date(Date.now() + LOCKOUT_SECONDS * 1000).toISOString()
          : null,
      })
      .eq("id", target.id);
    return { error: "PIN ไม่ถูกต้อง" };
  }

  await admin
    .from("profiles")
    .update({ pin_failed_attempts: 0, pin_locked_until: null })
    .eq("id", target.id);

  const { data: authUser, error: getUserError } = await admin.auth.admin.getUserById(target.id);
  if (getUserError || !authUser.user?.email) {
    return { error: "สลับผู้ใช้งานไม่สำเร็จ" };
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: authUser.user.email,
  });
  if (linkError || !linkData) {
    return { error: "สลับผู้ใช้งานไม่สำเร็จ" };
  }

  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError) {
    return { error: "สลับผู้ใช้งานไม่สำเร็จ" };
  }

  const cookieStore = await cookies();
  cookieStore.set(WORKER_COOKIE, target.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect("/");
}

export async function switchWorker(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(WORKER_COOKIE);
  redirect("/job-level");
}
