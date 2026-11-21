import { stockPost } from "@/lib/stock/stock-route";
import { parseReceiveBody } from "@/lib/stock/stock-api";
import { isManagerOrOwner, receiveStockCore } from "@/lib/stock/stock-writes";

/**
 * POST /api/stock/receive — "รับของเข้า" from the POS stock panel.
 * Body { materialId: uuid, quantity: number (use unit), totalPrice?: number | string | null, note?: string | null }
 * → { ok: true, ledgerId: string | null } | { error }. The price only counts for an owner or manager
 * (the role from the profile, as the inventory page's receiveStock); the same write as that action.
 * A route handler, not a server action (final review I3).
 */
export async function POST(request: Request) {
  return stockPost(request, "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง", async (actor, body) => {
    const parsed = parseReceiveBody(body, isManagerOrOwner(actor.role));
    if ("error" in parsed) return { error: parsed.error, status: 400 };
    const res = await receiveStockCore(actor, parsed.value);
    return "error" in res ? { error: res.error } : { ok: true, fields: { ledgerId: res.ledgerId ?? null } };
  });
}
