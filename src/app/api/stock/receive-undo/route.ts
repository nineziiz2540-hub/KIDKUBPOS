import { stockPost } from "@/lib/stock/stock-route";
import { BAD_REQUEST, parseIdBody } from "@/lib/stock/stock-api";
import { undoReceiveCore } from "@/lib/stock/stock-writes";

/**
 * POST /api/stock/receive-undo — the 5 s "ย้อนกลับ" of a receive saved on the POS.
 * Body { ledgerId: uuid } → { ok: true } | { error }. A route handler, not a server action (final review I3).
 */
export async function POST(request: Request) {
  return stockPost(request, "ย้อนกลับไม่สำเร็จ", async (actor, body) => {
    const parsed = parseIdBody(body, "ledgerId");
    if ("error" in parsed) return { error: BAD_REQUEST, status: 400 };
    const res = await undoReceiveCore(actor, parsed.value);
    return res.error ? { error: res.error } : { ok: true };
  });
}
