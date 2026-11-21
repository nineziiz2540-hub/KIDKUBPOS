import "server-only";
// What every POS stock route handler (/api/stock/*, final review I3, R-D2a-30) does before and after its
// own write: same-origin check (route handlers do not get the server actions' origin check), JSON only,
// the signed-in profile (getProfile, as the actions and /api/heartbeat), and a JSON answer that is never
// cached. The shop and the actor come from the profile only. An unexpected throw answers the route's
// plain Thai error, never a raw code.
import { getProfile } from "@/lib/dal";
import { BAD_REQUEST, isSameOrigin, NOT_ALLOWED, requestHosts } from "@/lib/stock/stock-api";
import { stockActor, type StockActor } from "@/lib/stock/stock-writes";

/** A body this large is never a stock write (a waste with 50 option ids is well under 10 KB). */
const MAX_BODY_BYTES = 64 * 1024;

/** What a route's write came back with: done (plus the fields to answer), or a Thai error (HTTP 422 unless given). */
export type StockOutcome = { ok: true; fields?: Record<string, unknown> } | { error: string; status?: number };

function answer(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function stockPost(
  request: Request,
  failedMessage: string,
  run: (actor: StockActor, body: unknown) => Promise<StockOutcome>
): Promise<Response> {
  if (!isSameOrigin(request.headers.get("origin"), requestHosts(request.headers))) {
    return answer({ error: NOT_ALLOWED }, 403);
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return answer({ error: BAD_REQUEST }, 415);
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return answer({ error: BAD_REQUEST }, 413);
  }

  const profile = await getProfile();
  if (!profile) return answer({ error: NOT_ALLOWED }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return answer({ error: BAD_REQUEST }, 400);
  }

  try {
    const out = await run(stockActor(profile), body);
    if ("error" in out) return answer({ error: out.error }, out.status ?? 422);
    return answer({ ...out.fields, ok: true }, 200);
  } catch (e) {
    console.error("[api/stock]", e instanceof Error ? e.message : e);
    return answer({ error: failedMessage }, 500);
  }
}
