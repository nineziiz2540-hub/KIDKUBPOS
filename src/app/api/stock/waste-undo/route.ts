import { stockPost } from "@/lib/stock/stock-route";
import { parseIdBody } from "@/lib/stock/stock-api";
import { wasteUndoErrorMessage } from "@/lib/stock/waste-input";
import { undoWasteCore } from "@/lib/stock/stock-writes";

/**
 * POST /api/stock/waste-undo — the 5 s "ย้อนกลับ" of a waste saved on the POS.
 * Body { refId: uuid } → { ok: true } | { error }. A route handler, not a server action (final review I3).
 */
export async function POST(request: Request) {
  return stockPost(request, wasteUndoErrorMessage(undefined), async (actor, body) => {
    const parsed = parseIdBody(body, "refId");
    if ("error" in parsed) return { error: wasteUndoErrorMessage("not_found"), status: 400 };
    const res = await undoWasteCore(actor, parsed.value);
    return res.error ? { error: res.error } : { ok: true };
  });
}
