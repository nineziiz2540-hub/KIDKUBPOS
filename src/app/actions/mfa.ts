"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/dal";
import {
  deleteAllBackupCodes,
  generateBackupCodes,
  storeBackupCodes,
  verifyAndConsumeBackupCode,
} from "@/lib/mfa-backup-codes";

export type EnrollMfaResult =
  | { error: string }
  | { factorId: string; qrCode: string; secret: string };

export async function enrollMfa(): Promise<EnrollMfaResult> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const supabase = await createClient();

  // Clean up any unverified factor left over from an abandoned attempt (page reload, tab close,
  // navigating away mid-enrollment) before starting a new one — otherwise these accumulate
  // silently and eventually hit GoTrue's per-user factor cap, permanently blocking enrollment.
  // listFactors()'s `.totp` convenience array only ever contains VERIFIED factors by design
  // (that's how the SDK types it) — unverified ones only show up in `.all`, so that's what we
  // scan here.
  const { data: existingFactors } = await supabase.auth.mfa.listFactors();
  for (const factor of existingFactors?.all ?? []) {
    if (factor.factor_type === "totp" && factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: "KIDKUBPOS",
  });
  if (error || !data) {
    return { error: "เริ่มเปิดใช้งาน 2FA ไม่สำเร็จ กรุณาลองใหม่" };
  }

  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export type MfaEnrollState =
  | { error?: string }
  | { success: true; backupCodes: string[] }
  | undefined;

export async function confirmMfaEnrollment(
  prevState: MfaEnrollState,
  formData: FormData
): Promise<MfaEnrollState> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const factorId = formData.get("factor_id");
  const code = formData.get("code");
  if (typeof factorId !== "string" || typeof code !== "string" || code.length === 0) {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    return { error: "รหัสไม่ถูกต้อง กรุณาลองใหม่" };
  }

  const admin = createAdminClient();
  const backupCodes = generateBackupCodes();
  try {
    // Replace, not append — a retry or a queued double-dispatch reaching this point twice must
    // not leave an earlier, never-shown batch of valid codes lingering alongside the latest one.
    await deleteAllBackupCodes(admin, profile.id);
    await storeBackupCodes(admin, profile.id, backupCodes);
  } catch (err) {
    console.error("confirmMfaEnrollment: storeBackupCodes failed:", err);
    return { error: "เปิดใช้งาน 2FA สำเร็จ แต่สร้างรหัสสำรองไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ" };
  }

  return { success: true, backupCodes };
}

export type DisableMfaResult = { error?: string };

export async function disableMfa(): Promise<DisableMfaResult> {
  const profile = await getProfile();
  if (!profile || profile.role !== "owner") {
    return { error: "ไม่มีสิทธิ์ดำเนินการนี้" };
  }

  const supabase = await createClient();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) {
    return { error: "ปิดใช้งาน 2FA ไม่สำเร็จ กรุณาลองใหม่" };
  }
  const verifiedFactors = factors.totp.filter((f) => f.status === "verified");
  if (verifiedFactors.length === 0) {
    return { error: "ยังไม่ได้เปิดใช้งาน 2FA" };
  }

  // Unenroll every verified factor, not just one — e.g. two browser tabs each completing their
  // own enrollment could leave more than one. Leaving any verified factor behind would keep the
  // account gated at aal2 in src/proxy.ts even though the UI just reported 2FA as disabled.
  for (const factor of verifiedFactors) {
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (unenrollError) {
      return { error: "ปิดใช้งาน 2FA ไม่สำเร็จ กรุณาลองใหม่" };
    }
  }

  const admin = createAdminClient();
  await deleteAllBackupCodes(admin, profile.id);

  return {};
}

export type MfaChallengeState = { error?: string } | undefined;

export async function verifyMfaChallenge(
  prevState: MfaChallengeState,
  formData: FormData
): Promise<MfaChallengeState> {
  const factorId = formData.get("factor_id");
  const code = formData.get("code");
  if (typeof factorId !== "string" || typeof code !== "string" || code.length === 0) {
    return { error: "ข้อมูลไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) {
    return { error: "รหัสไม่ถูกต้อง กรุณาลองใหม่" };
  }

  redirect("/");
}

export async function verifyMfaBackupCode(
  prevState: MfaChallengeState,
  formData: FormData
): Promise<MfaChallengeState> {
  const profile = await getProfile();
  if (!profile) {
    return { error: "กรุณาเข้าสู่ระบบใหม่" };
  }

  const backupCode = formData.get("backup_code");
  if (typeof backupCode !== "string" || backupCode.trim() === "") {
    return { error: "กรุณากรอกรหัสสำรอง" };
  }

  const admin = createAdminClient();
  const valid = await verifyAndConsumeBackupCode(admin, profile.id, backupCode.trim().toUpperCase());
  if (!valid) {
    return { error: "รหัสสำรองไม่ถูกต้องหรือถูกใช้ไปแล้ว" };
  }

  const { data: factors, error: listError } = await admin.auth.admin.mfa.listFactors({
    userId: profile.id,
  });
  if (listError || !factors) {
    return { error: "กู้คืนไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ" };
  }
  // Remove every verified factor, not just one — see disableMfa for why (e.g. two tabs each
  // completing their own enrollment). Leaving any behind would keep the account gated at aal2
  // even though the backup code just proved recovery and the UI reports 2FA as disabled.
  for (const factor of factors.factors) {
    if (factor.status !== "verified") continue;
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId: profile.id,
    });
    if (deleteError) {
      console.error("verifyMfaBackupCode: deleteFactor failed:", deleteError);
      return { error: "กู้คืนไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ" };
    }
  }

  await deleteAllBackupCodes(admin, profile.id);

  redirect("/");
}
