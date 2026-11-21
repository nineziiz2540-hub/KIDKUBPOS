import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FLAG_TIMEOUT_MS, NO_ANSWER_WRITE, postFlag, postPause, postPosApi, postReceive, postReceiveUndo, postWaste,
  postWasteUndo, STOCK_WRITE_TIMEOUT_MS, type FetchLike,
} from "./pos-api.ts";
import { PAUSE_DEADLINE_MS } from "./stock/pos-states.ts";

type Call = { input: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch that answers `respond` and records every call. */
function fakeFetch(respond: (call: Call) => Response | Promise<Response>): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetchImpl: async (input, init) => {
      const call = { input, init };
      calls.push(call);
      return respond(call);
    },
  };
}

/** A fetch that never answers until its request is aborted (a stalled network), like the browser's. */
function stalledFetch(): { fetchImpl: FetchLike; aborted: () => boolean } {
  let wasAborted = false;
  return {
    aborted: () => wasAborted,
    fetchImpl: (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          wasAborted = true;
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }),
  };
}

const opts = (fetchImpl: FetchLike, timeoutMs = 1000) => ({ timeoutMs, fallbackError: "บันทึกไม่สำเร็จ", fetchImpl });

test("a stock write is a JSON POST that is never cached and never follows a redirect", async () => {
  const f = fakeFetch(() => jsonResponse({ ok: true }));
  const r = await postPosApi("/api/stock/flag", { materialIds: ["a"] }, opts(f.fetchImpl));
  assert.deepEqual(r, { ok: true, body: { ok: true } });
  assert.equal(f.calls.length, 1);
  const { input, init } = f.calls[0]!;
  assert.equal(input, "/api/stock/flag");
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, { "Content-Type": "application/json" });
  assert.equal(init.body, JSON.stringify({ materialIds: ["a"] }));
  assert.equal(init.cache, "no-store");
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.redirect, "manual");
  assert.ok(init.signal instanceof AbortSignal);
});

test("no answer in time: the request is aborted and it counts as no answer, never failed", async () => {
  const f = stalledFetch();
  const started = Date.now();
  const r = await postPosApi("/api/stock/waste", {}, opts(f.fetchImpl, 30));
  assert.deepEqual(r, { noAnswer: true });
  assert.equal(f.aborted(), true, "the stalled request is cancelled, not left running");
  assert.ok(Date.now() - started < 1000);
});

test("a network failure counts as no answer (the server may or may not have it)", async () => {
  const f = fakeFetch(() => Promise.reject(new TypeError("Failed to fetch")));
  assert.deepEqual(await postPosApi("/api/stock/receive", {}, opts(f.fetchImpl)), { noAnswer: true });
});

test("the route's Thai error comes through as it is, whatever the status", async () => {
  for (const status of [200, 400, 401, 403, 422, 500]) {
    const f = fakeFetch(() => jsonResponse({ error: "ไม่พบเมนูนี้ (อาจถูกเก็บเข้าคลังแล้ว)" }, status));
    assert.deepEqual(await postPosApi("/api/stock/pause", {}, opts(f.fetchImpl)), { error: "ไม่พบเมนูนี้ (อาจถูกเก็บเข้าคลังแล้ว)" });
  }
});

test("a redirect, an HTML page or a malformed answer is our own Thai error: the handler never ran", async () => {
  const redirect = fakeFetch(() => {
    const res = new Response(null, { status: 200 });
    Object.defineProperty(res, "type", { value: "opaqueredirect" });
    return res;
  });
  assert.deepEqual(await postPosApi("/api/stock/waste", {}, opts(redirect.fetchImpl)), { error: "บันทึกไม่สำเร็จ" });
  const html = fakeFetch(() => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }));
  assert.deepEqual(await postPosApi("/api/stock/waste", {}, opts(html.fetchImpl)), { error: "บันทึกไม่สำเร็จ" });
  const broken = fakeFetch(() => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }));
  assert.deepEqual(await postPosApi("/api/stock/waste", {}, opts(broken.fetchImpl)), { error: "บันทึกไม่สำเร็จ" });
  const noOk = fakeFetch(() => jsonResponse({ something: 1 }));
  assert.deepEqual(await postPosApi("/api/stock/waste", {}, opts(noOk.fetchImpl)), { error: "บันทึกไม่สำเร็จ" });
  const raw500 = fakeFetch(() => new Response("Internal Server Error", { status: 500, headers: { "content-type": "text/plain" } }));
  assert.deepEqual(await postPosApi("/api/stock/waste", {}, opts(raw500.fetchImpl)), { error: "บันทึกไม่สำเร็จ" });
});

test("each POS stock write has its own path, body and timeout", async () => {
  assert.equal(FLAG_TIMEOUT_MS, 5_000);
  assert.equal(PAUSE_DEADLINE_MS, 5_000);
  assert.equal(STOCK_WRITE_TIMEOUT_MS, 10_000);
  const f = fakeFetch(({ input }) =>
    jsonResponse(
      input === "/api/stock/waste"
        ? { ok: true, refId: "r1", label: "ลาเต้ 1 แก้ว" }
        : input === "/api/stock/receive"
          ? { ok: true, ledgerId: "l1" }
          : { ok: true }
    )
  );
  await postFlag(["m1", "m2"], "p1", f.fetchImpl);
  assert.deepEqual(await postPause("p1", true, f.fetchImpl), { ok: true });
  assert.deepEqual(
    await postWaste({ kind: "material", materialId: "m1", qty: 100, reason: "ทำหก" }, f.fetchImpl),
    { refId: "r1", label: "ลาเต้ 1 แก้ว" }
  );
  assert.deepEqual(await postWasteUndo("r1", f.fetchImpl), { ok: true });
  assert.deepEqual(await postReceive({ materialId: "m1", quantity: 12000, totalPrice: "120" }, f.fetchImpl), { ledgerId: "l1" });
  assert.deepEqual(await postReceiveUndo("l1", f.fetchImpl), { ok: true });
  assert.deepEqual(
    f.calls.map((c) => [c.input, JSON.parse(String(c.init.body))]),
    [
      ["/api/stock/flag", { materialIds: ["m1", "m2"], productId: "p1" }],
      ["/api/stock/pause", { productId: "p1", paused: true }],
      ["/api/stock/waste", { kind: "material", materialId: "m1", qty: 100, reason: "ทำหก" }],
      ["/api/stock/waste-undo", { refId: "r1" }],
      ["/api/stock/receive", { materialId: "m1", quantity: 12000, totalPrice: "120" }],
      ["/api/stock/receive-undo", { ledgerId: "l1" }],
    ]
  );
});

test("a pause or reopen with no answer is noAnswer (it may still happen); its error stays Thai", async () => {
  // postPause gives up after PAUSE_DEADLINE_MS (5 s, asserted above); the same abort mapping, with a short timeout
  const stalled = stalledFetch();
  assert.deepEqual(await postPosApi("/api/stock/pause", {}, opts(stalled.fetchImpl, 20)), { noAnswer: true });
  const down = fakeFetch(() => Promise.reject(new TypeError("Failed to fetch")));
  assert.deepEqual(await postPause("p1", false, down.fetchImpl), { noAnswer: true });
  const refused = fakeFetch(() => jsonResponse({ error: "ไม่มีสิทธิ์ดำเนินการนี้" }, 422));
  assert.deepEqual(await postPause("p1", true, refused.fetchImpl), { error: "ไม่มีสิทธิ์ดำเนินการนี้" });
  const html = fakeFetch(() => new Response("<html>", { headers: { "content-type": "text/html" } }));
  assert.deepEqual(await postPause("p1", true, html.fetchImpl), { error: "ปิดขายไม่สำเร็จ ลองใหม่อีกครั้ง" });
  assert.deepEqual(await postPause("p1", false, html.fetchImpl), { error: "เปิดขายไม่สำเร็จ ลองใหม่อีกครั้ง" });
});

test("a waste or receive with no answer says so in Thai, and a saved answer without its id says the same", async () => {
  assert.equal(NO_ANSWER_WRITE, "ยังไม่ได้คำตอบ — ดูประวัติก่อนบันทึกซ้ำ");
  const down = fakeFetch(() => Promise.reject(new TypeError("Failed to fetch")));
  assert.deepEqual(await postWaste({ kind: "material", materialId: "m1", qty: 1, reason: "ทำหก" }, down.fetchImpl), { noAnswer: true });
  assert.deepEqual(await postReceive({ materialId: "m1", quantity: 1 }, down.fetchImpl), { noAnswer: true });
  assert.deepEqual(await postWasteUndo("r1", down.fetchImpl), { noAnswer: true });
  assert.deepEqual(await postReceiveUndo("l1", down.fetchImpl), { noAnswer: true });
  const okNoId = fakeFetch(() => jsonResponse({ ok: true }));
  assert.deepEqual(await postWaste({ kind: "material", materialId: "m1", qty: 1, reason: "ทำหก" }, okNoId.fetchImpl), { noAnswer: true });
  // a receive that answered without a ledger id still saved: no "ย้อนกลับ" then
  assert.deepEqual(await postReceive({ materialId: "m1", quantity: 1 }, okNoId.fetchImpl), { ledgerId: null });
});

test("a flag with an empty menu id sends null", async () => {
  const f = fakeFetch(() => jsonResponse({ ok: true }));
  await postFlag(["m1"], "", f.fetchImpl);
  assert.deepEqual(JSON.parse(String(f.calls[0]!.init.body)), { materialIds: ["m1"], productId: null });
});
