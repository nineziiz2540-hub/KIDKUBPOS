import "server-only";
import bcrypt from "bcryptjs";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Checks a 6-digit PIN against every active owner/manager in the tenant and returns the id of
 * the one it belongs to, or null. Deactivated members keep their role and pin_hash, so they're
 * excluded explicitly: a former manager's PIN must not approve anything. Reads pin_hash through
 * the admin client: profiles RLS doesn't expose other members' hashes to the person asking.
 */
export async function verifyManagerPin(tenantId: string, pin: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: approvers } = await admin
    .from("profiles")
    .select("id, pin_hash")
    .eq("tenant_id", tenantId)
    .in("role", ["owner", "manager"])
    .is("deactivated_at", null)
    .not("pin_hash", "is", null);

  for (const approver of approvers ?? []) {
    if (approver.pin_hash && (await bcrypt.compare(pin, approver.pin_hash))) {
      return approver.id;
    }
  }
  return null;
}
