// The POS's stock writes (round D2a final review I3, R-D2a-30): plain `fetch` to the JSON route handlers
// under /api/stock/*, each with its own AbortController timeout. Not server actions: Next runs a page's
// server actions one at a time, so a stalled flag, pause, waste or receive would sit ahead of the next
// createOrder and could push a payment into "no answer". A timed-out request is aborted here (the server
// may still finish it: the answer is "no answer", never "failed"). Pure apart from fetch, no framework
// imports, so node:test runs it with a fake fetch.
import type { PauseResult } from "./stock/pos-states.ts";
import { PAUSE_DEADLINE_MS } from "./stock/pos-states.ts";
import { wasteUndoErrorMessage, type WasteInput } from "./stock/waste-input.ts";

/** "ยังมีของ ขายต่อ"'s flag: fire and forget, given up after this. */
export const FLAG_TIMEOUT_MS = 5_000;
/** A waste, a receive and their undos: given up after this. */
export const STOCK_WRITE_TIMEOUT_MS = 10_000;

/** A waste or receive (or its undo) got no answer in time: it may still have been saved. */
export const NO_ANSWER_WRITE = "ยังไม่ได้คำตอบ — ดูประวัติก่อนบันทึกซ้ำ";

/** ok = the route answered `{ ok: true, ... }`; error = its Thai error (or ours); noAnswer = timed out or no network. */
export type PosApiResult = { ok: true; body: Record<string, unknown> } | { error: string } | { noAnswer: true };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * POST `payload` as JSON to `path`, giving up after `timeoutMs` (the request is aborted). A redirect (signed
 * out → /login, the 2FA wall) is not followed and, like an HTML or malformed answer, comes back as
 * `fallbackError`: the route handler never ran, so nothing was written.
 */
export async function postPosApi(
  path: string,
  payload: unknown,
  opts: { timeoutMs: number; fallbackError: string; fetchImpl?: FetchLike }
): Promise<PosApiResult> {
  const doFetch: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await doFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      credentials: "same-origin",
      redirect: "manual",
      signal: controller.signal,
    });
    const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
    if (res.type === "opaqueredirect" || res.redirected || !isJson) return { error: opts.fallbackError };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return controller.signal.aborted ? { noAnswer: true } : { error: opts.fallbackError };
    }
    if (isObject(body) && typeof body.error === "string" && body.error !== "") return { error: body.error };
    if (res.ok && isObject(body) && body.ok === true) return { ok: true, body };
    return { error: opts.fallbackError };
  } catch {
    // aborted by the timer, or the network failed: the server may or may not have done it
    return { noAnswer: true };
  } finally {
    clearTimeout(timer);
  }
}

/** "ยังมีของ ขายต่อ": the day's "ยอดน่าจะผิด" flag. The caller never waits for it; a failure is only logged. */
export function postFlag(materialIds: string[], productId: string, fetchImpl?: FetchLike): Promise<PosApiResult> {
  return postPosApi(
    "/api/stock/flag",
    { materialIds, productId: productId === "" ? null : productId },
    { timeoutMs: FLAG_TIMEOUT_MS, fallbackError: "บันทึกไม่สำเร็จ", fetchImpl }
  );
}

/** "ปิดขาย" (true) / "เปิดขาย" (false), given up after PAUSE_DEADLINE_MS: { noAnswer } = the server may still do it. */
export async function postPause(productId: string, paused: boolean, fetchImpl?: FetchLike): Promise<PauseResult> {
  const r = await postPosApi(
    "/api/stock/pause",
    { productId, paused },
    {
      timeoutMs: PAUSE_DEADLINE_MS,
      fallbackError: paused ? "ปิดขายไม่สำเร็จ ลองใหม่อีกครั้ง" : "เปิดขายไม่สำเร็จ ลองใหม่อีกครั้ง",
      fetchImpl,
    }
  );
  if ("noAnswer" in r) return { noAnswer: true };
  if ("error" in r) return { error: r.error };
  return { ok: true };
}

/** "บันทึกของเสีย": the record id and its label for the toast and its "ย้อนกลับ". */
export async function postWaste(
  input: WasteInput,
  fetchImpl?: FetchLike
): Promise<{ refId: string; label: string } | { error: string } | { noAnswer: true }> {
  const r = await postPosApi("/api/stock/waste", input, {
    timeoutMs: STOCK_WRITE_TIMEOUT_MS,
    fallbackError: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง",
    fetchImpl,
  });
  if (!("ok" in r)) return r;
  const { refId, label } = r.body;
  // saved, but the answer is unreadable: say so the way a lost answer is said
  if (typeof refId !== "string" || typeof label !== "string") return { noAnswer: true };
  return { refId, label };
}

/** "ย้อนกลับ" of a waste. */
export async function postWasteUndo(refId: string, fetchImpl?: FetchLike): Promise<{ ok: true } | { error: string } | { noAnswer: true }> {
  const r = await postPosApi("/api/stock/waste-undo", { refId }, {
    timeoutMs: STOCK_WRITE_TIMEOUT_MS,
    fallbackError: wasteUndoErrorMessage(undefined),
    fetchImpl,
  });
  return "ok" in r ? { ok: true } : r;
}

/**
 * "รับของเข้า" in the use unit; `totalPrice` (as typed, checked by the server like the inventory form) only
 * for an owner or manager — the server checks the role again and drops a staff price.
 */
export async function postReceive(
  input: { materialId: string; quantity: number; totalPrice?: string | number },
  fetchImpl?: FetchLike
): Promise<{ ledgerId: string | null } | { error: string } | { noAnswer: true }> {
  const r = await postPosApi("/api/stock/receive", input, {
    timeoutMs: STOCK_WRITE_TIMEOUT_MS,
    fallbackError: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง",
    fetchImpl,
  });
  if (!("ok" in r)) return r;
  return { ledgerId: typeof r.body.ledgerId === "string" ? r.body.ledgerId : null };
}

/** "ย้อนกลับ" of a receive. */
export async function postReceiveUndo(ledgerId: string, fetchImpl?: FetchLike): Promise<{ ok: true } | { error: string } | { noAnswer: true }> {
  const r = await postPosApi("/api/stock/receive-undo", { ledgerId }, {
    timeoutMs: STOCK_WRITE_TIMEOUT_MS,
    fallbackError: "ย้อนกลับไม่สำเร็จ",
    fetchImpl,
  });
  return "ok" in r ? { ok: true } : r;
}
