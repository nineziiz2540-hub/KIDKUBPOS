import { stockPost } from "@/lib/stock/stock-route";
import { parsePauseBody } from "@/lib/stock/stock-api";
import { setMenuPausedCore } from "@/lib/stock/stock-writes";

/**
 * POST /api/stock/pause — "ไม่มีแล้ว ปิดขาย" / "เปิดขายแล้วสั่ง" and the stock panel's switches on the POS.
 * Body { productId: uuid, paused: boolean } → { ok: true } | { error }.
 * The POS gives up after PAUSE_DEADLINE_MS and aborts the request (src/lib/pos-api.ts); the next
 * heartbeat shows whether the server did it (final review I3, R-D2a-30).
 */
export async function POST(request: Request) {
  return stockPost(request, "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง", async (actor, body) => {
    const parsed = parsePauseBody(body);
    if ("error" in parsed) return { error: parsed.error, status: 400 };
    const res = await setMenuPausedCore(actor, parsed.value.productId, parsed.value.paused);
    return res.error ? { error: res.error } : { ok: true };
  });
}
