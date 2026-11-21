import { stockPost } from "@/lib/stock/stock-route";
import { parseFlagBody } from "@/lib/stock/stock-api";
import { flagSoldWhileOutCore } from "@/lib/stock/stock-writes";

/**
 * POST /api/stock/flag — "ยังมีของ ขายต่อ" on the POS: one "ยอดน่าจะผิด" flag per material per business day.
 * Body { materialIds: uuid[] (1–20), productId: uuid | null } → { ok: true } | { error }.
 * The POS fires it and forgets it (5 s timeout, src/lib/pos-api.ts): a route handler, not a server action,
 * so it never waits in the server-action queue ahead of the next payment (final review I3, R-D2a-30).
 */
export async function POST(request: Request) {
  return stockPost(request, "บันทึกไม่สำเร็จ", async (actor, body) => {
    const parsed = parseFlagBody(body);
    if ("error" in parsed) return { error: parsed.error, status: 400 };
    const res = await flagSoldWhileOutCore(actor, parsed.value.materialIds, parsed.value.productId);
    return res.error ? { error: res.error } : { ok: true };
  });
}
