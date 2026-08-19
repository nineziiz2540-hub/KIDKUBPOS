import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function checkLoginLockout(
  admin: SupabaseClient<Database>,
  email: string
): Promise<{ locked: true; minutesLeft: number } | { locked: false }> {
  try {
    const { data, error } = await admin
      .from("login_lockouts")
      .select("locked_until")
      .eq("email", email)
      .maybeSingle();
    if (error) {
      console.error("checkLoginLockout: read failed, failing open:", error);
      return { locked: false };
    }
    if (data?.locked_until && new Date(data.locked_until) > new Date()) {
      const minutesLeft = Math.ceil(
        (new Date(data.locked_until).getTime() - Date.now()) / 60000
      );
      return { locked: true, minutesLeft };
    }
    return { locked: false };
  } catch (err) {
    console.error("checkLoginLockout: unexpected error, failing open:", err);
    return { locked: false };
  }
}

export async function recordLoginFailure(
  admin: SupabaseClient<Database>,
  email: string
): Promise<{ lockedOut: true; minutesLeft: number } | { lockedOut: false }> {
  try {
    const { data: existing, error: selectError } = await admin
      .from("login_lockouts")
      .select("failed_attempts")
      .eq("email", email)
      .maybeSingle();
    if (selectError) {
      console.error("recordLoginFailure: read failed, recording skipped:", selectError);
      return { lockedOut: false };
    }

    const attempts = (existing?.failed_attempts ?? 0) + 1;
    const lockedOut = attempts >= LOCKOUT_THRESHOLD;
    const lockedUntil = lockedOut
      ? new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString()
      : null;

    const { error } = await admin.from("login_lockouts").upsert({
      email,
      failed_attempts: lockedOut ? 0 : attempts,
      locked_until: lockedUntil,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error("recordLoginFailure: write failed:", error);
      return { lockedOut: false };
    }

    return lockedOut ? { lockedOut: true, minutesLeft: LOCKOUT_MINUTES } : { lockedOut: false };
  } catch (err) {
    console.error("recordLoginFailure: unexpected error:", err);
    return { lockedOut: false };
  }
}

export async function clearLoginLockout(
  admin: SupabaseClient<Database>,
  email: string
): Promise<void> {
  try {
    const { error } = await admin.from("login_lockouts").delete().eq("email", email);
    if (error) {
      console.error("clearLoginLockout: delete failed (non-blocking):", error);
    }
  } catch (err) {
    console.error("clearLoginLockout: unexpected error (non-blocking):", err);
  }
}
