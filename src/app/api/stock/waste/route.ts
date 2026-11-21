import { stockPost } from "@/lib/stock/stock-route";
import { parseWasteInput } from "@/lib/stock/waste-input";
import { recordWasteCore } from "@/lib/stock/stock-writes";

/**
 * POST /api/stock/waste — "บันทึกของเสีย" from the POS stock panel.
 * Body: a WasteInput (src/lib/stock/waste-input.ts: kind "menu" with productId, quantity, choices,
 * optionIds, houseGlass, or kind "material" with materialId, qty; plus reason and otherText)
 * → { ok: true, refId, label } | { error }. A route handler, not a server action (final review I3).
 */
export async function POST(request: Request) {
  return stockPost(request, "บันทึกของเสียไม่สำเร็จ ลองใหม่อีกครั้ง", async (actor, body) => {
    const parsed = parseWasteInput(body);
    if ("error" in parsed) return { error: parsed.error, status: 400 };
    const res = await recordWasteCore(actor, parsed.value);
    return "error" in res ? { error: res.error } : { ok: true, fields: { refId: res.refId, label: res.label } };
  });
}
