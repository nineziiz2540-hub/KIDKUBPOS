import { getProfile } from "@/lib/dal";
import { BUILD_VERSION } from "@/lib/build-version";
import { bangkokToday } from "@/lib/bangkok-time";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The POS asks this every 30 s (src/components/pos/use-heartbeat.ts): answering at all means the
 * internet works, `version` tells an old tab that a newer deployment is live, and `promptpayId`
 * keeps the on-device QR pointed at the shop's current account. The service worker never caches
 * it (src/app/sw.ts), or an offline check would be answered from the cache.
 *
 * Round C2: `shiftId` is the shop's open shift (null for none), which an offline sale records,
 * and `queue` is today's Bangkok date with the last queue number handed out (0 before the first),
 * from which the device numbers offline sales.
 *
 * Every field but `version` is only sent when it was actually read: getProfile returns null on a
 * database error as well as when signed out, and a missing key makes the POS keep the value it
 * already has instead of blanking the QR or forgetting the shift.
 */
export async function GET() {
  const profile = await getProfile();
  const tenant = profile?.tenants as { promptpay_id: string | null } | null | undefined;
  const body: {
    version: string;
    promptpayId?: string | null;
    shiftId?: string | null;
    queue?: { date: string; last: number };
  } = { version: BUILD_VERSION };
  if (tenant) body.promptpayId = tenant.promptpay_id;

  if (profile) {
    const today = bangkokToday();
    const supabase = await createClient();
    // The same read as getActiveShift (src/lib/dal.ts), which can't tell "no shift" from a failed
    // read; a failed read must leave shiftId out, not say "no shift".
    const [shift, counter] = await Promise.all([
      supabase
        .from("shifts")
        .select("id")
        .eq("tenant_id", profile.tenant_id)
        .eq("status", "open")
        .maybeSingle(),
      // tenant_queue_counters has no RLS policy for members; read it with the admin client,
      // scoped to the caller's shop.
      createAdminClient()
        .from("tenant_queue_counters")
        .select("last_number")
        .eq("tenant_id", profile.tenant_id)
        .eq("business_date", today)
        .maybeSingle(),
    ]);
    if (!shift.error) body.shiftId = shift.data?.id ?? null;
    if (!counter.error) body.queue = { date: today, last: counter.data?.last_number ?? 0 };
  }

  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
