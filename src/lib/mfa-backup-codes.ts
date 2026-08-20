import "server-only";
import bcrypt from "bcryptjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase());
  }
  return codes;
}

export async function storeBackupCodes(
  admin: SupabaseClient<Database>,
  profileId: string,
  codes: string[]
): Promise<void> {
  const rows = await Promise.all(
    codes.map(async (code) => ({
      profile_id: profileId,
      code_hash: await bcrypt.hash(code, 10),
    }))
  );
  const { error } = await admin.from("mfa_backup_codes").insert(rows);
  if (error) {
    throw new Error(`storeBackupCodes: insert failed: ${error.message}`);
  }
}

export async function verifyAndConsumeBackupCode(
  admin: SupabaseClient<Database>,
  profileId: string,
  submittedCode: string
): Promise<boolean> {
  const { data: unusedCodes, error } = await admin
    .from("mfa_backup_codes")
    .select("id, code_hash")
    .eq("profile_id", profileId)
    .is("used_at", null);
  if (error) {
    console.error("verifyAndConsumeBackupCode: read failed, treating as invalid:", error);
    return false;
  }

  for (const row of unusedCodes ?? []) {
    const matches = await bcrypt.compare(submittedCode, row.code_hash);
    if (!matches) continue;

    // Conditional update guards against two concurrent requests both matching the same row —
    // only the first to actually flip used_at from null wins.
    const { data: consumed, error: consumeError } = await admin
      .from("mfa_backup_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("used_at", null)
      .select("id");
    if (consumeError) {
      console.error("verifyAndConsumeBackupCode: consume failed, treating as invalid:", consumeError);
      return false;
    }
    return (consumed?.length ?? 0) > 0;
  }

  return false;
}

export async function deleteAllBackupCodes(
  admin: SupabaseClient<Database>,
  profileId: string
): Promise<void> {
  const { error } = await admin.from("mfa_backup_codes").delete().eq("profile_id", profileId);
  if (error) {
    console.error("deleteAllBackupCodes: delete failed (non-blocking):", error);
  }
}
