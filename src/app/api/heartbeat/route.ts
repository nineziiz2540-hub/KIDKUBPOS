import { getProfile, getTenantPromptPayId } from "@/lib/dal";
import { BUILD_VERSION } from "@/lib/build-version";

/**
 * The POS asks this every 30 s (src/components/pos/use-heartbeat.ts): answering at all means the
 * internet works, `version` tells an old tab that a newer deployment is live, and `promptpayId`
 * keeps the on-device QR pointed at the shop's current account. The service worker never caches
 * it (src/app/sw.ts), or an offline check would be answered from the cache.
 */
export async function GET() {
  const profile = await getProfile();
  const promptpayId = profile ? await getTenantPromptPayId(profile.tenant_id) : null;
  return Response.json(
    { version: BUILD_VERSION, promptpayId },
    { headers: { "Cache-Control": "no-store" } }
  );
}
