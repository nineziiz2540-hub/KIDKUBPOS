import { getProfile } from "@/lib/dal";
import { BUILD_VERSION } from "@/lib/build-version";

/**
 * The POS asks this every 30 s (src/components/pos/use-heartbeat.ts): answering at all means the
 * internet works, `version` tells an old tab that a newer deployment is live, and `promptpayId`
 * keeps the on-device QR pointed at the shop's current account. The service worker never caches
 * it (src/app/sw.ts), or an offline check would be answered from the cache.
 *
 * `promptpayId` is only sent when it was actually read: getProfile returns null on a database
 * error as well as when signed out, and a missing key makes the POS keep the ID it already has
 * instead of blanking the QR.
 */
export async function GET() {
  const profile = await getProfile();
  const tenant = profile?.tenants as { promptpay_id: string | null } | null | undefined;
  const body: { version: string; promptpayId?: string | null } = { version: BUILD_VERSION };
  if (tenant) body.promptpayId = tenant.promptpay_id;
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
