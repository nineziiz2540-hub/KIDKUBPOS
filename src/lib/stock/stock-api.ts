// The POS's stock write endpoints (/api/stock/*, round D2a final review I3, R-D2a-30): the same-origin
// check and the JSON body checks. Pure, no I/O and no framework imports, so node:test can run it. The
// route handlers (src/app/api/stock/*/route.ts) run these before the shared server cores
// (src/lib/stock/stock-writes.ts); the shop and the actor always come from the signed-in profile,
// never from the body.
import { parseReceiveFields, type ReceiveFields } from "./receive-input.ts";

export const BAD_REQUEST = "ข้อมูลไม่ถูกต้อง";
export const NOT_ALLOWED = "ไม่มีสิทธิ์ดำเนินการนี้";

/** The most material ids one flag call takes: a cup never has more out materials than this. */
export const MAX_FLAG_MATERIALS = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

function isObject(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

/** The request's own host, as Next's server-action check reads it: the first x-forwarded-host, and host. */
export function requestHosts(headers: { get(name: string): string | null }): { host: string | null; forwardedHost: string | null } {
  const forwarded = headers.get("x-forwarded-host");
  const first = forwarded?.split(",")[0]?.trim();
  return { host: headers.get("host"), forwardedHost: first ? first : null };
}

/**
 * CSRF defence for the JSON route handlers (they do not get the server actions' own origin check): a
 * request whose Origin header is present must come from this host (x-forwarded-host or host, as Next
 * compares for server actions). No Origin at all (not a browser page: curl, a server) is allowed — the
 * session cookie and getProfile still decide who it is. "null" or anything unparsable is refused.
 */
export function isSameOrigin(origin: string | null, hosts: { host: string | null; forwardedHost: string | null }): boolean {
  if (origin === null) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  if (originHost === "") return false;
  return originHost === hosts.forwardedHost || originHost === hosts.host;
}

/** A flag's material ids: the non-empty strings, each once; null when none is left or there are too many. */
export function normalizeFlagIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = [...new Set(raw.filter((id): id is string => typeof id === "string" && id !== ""))];
  return ids.length === 0 || ids.length > MAX_FLAG_MATERIALS ? null : ids;
}

/** POST /api/stock/flag: { materialIds: uuid[] (1–20), productId: uuid | null }. */
export function parseFlagBody(raw: unknown): { value: { materialIds: string[]; productId: string | null } } | { error: string } {
  if (!isObject(raw)) return { error: BAD_REQUEST };
  const materialIds = normalizeFlagIds(raw.materialIds);
  if (materialIds === null || !materialIds.every(isUuid)) return { error: BAD_REQUEST };
  const { productId } = raw;
  if (productId !== null && productId !== undefined && productId !== "" && !isUuid(productId)) return { error: BAD_REQUEST };
  return { value: { materialIds, productId: isUuid(productId) ? productId : null } };
}

/** POST /api/stock/pause: { productId: uuid, paused: boolean } (true = "ปิดขาย", false = "เปิดขาย"). */
export function parsePauseBody(raw: unknown): { value: { productId: string; paused: boolean } } | { error: string } {
  if (!isObject(raw)) return { error: BAD_REQUEST };
  const { productId, paused } = raw;
  if (!isUuid(productId) || typeof paused !== "boolean") return { error: BAD_REQUEST };
  return { value: { productId, paused } };
}

/** POST /api/stock/waste-undo { refId } and /api/stock/receive-undo { ledgerId }: one uuid. */
export function parseIdBody(raw: unknown, key: "refId" | "ledgerId"): { value: string } | { error: string } {
  if (!isObject(raw) || !isUuid(raw[key])) return { error: BAD_REQUEST };
  return { value: raw[key] as string };
}

/**
 * POST /api/stock/receive: { materialId: uuid, quantity: number, totalPrice?: number | string | null,
 * note?: string | null }. The amount, price and note go through the same rules as the inventory page's
 * form (parseReceiveFields; a price may come as typed, like the form's): the price only counts for an
 * owner or manager (`canPrice`, from the profile).
 */
export function parseReceiveBody(raw: unknown, canPrice: boolean): { value: ReceiveFields } | { error: string } {
  if (!isObject(raw) || !isUuid(raw.materialId)) return { error: BAD_REQUEST };
  const { quantity, totalPrice, note } = raw;
  if (typeof quantity !== "number") return { error: BAD_REQUEST };
  if (totalPrice !== undefined && totalPrice !== null && typeof totalPrice !== "number" && typeof totalPrice !== "string") {
    return { error: BAD_REQUEST };
  }
  if (note !== undefined && note !== null && typeof note !== "string") return { error: BAD_REQUEST };
  const fields: Record<string, unknown> = {
    raw_material_id: raw.materialId,
    quantity,
    total_price: totalPrice ?? null,
    note: note ?? null,
  };
  return parseReceiveFields((k) => fields[k], canPrice);
}
