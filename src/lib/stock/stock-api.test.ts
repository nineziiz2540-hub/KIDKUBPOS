import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BAD_REQUEST, isSameOrigin, isUuid, MAX_FLAG_MATERIALS, normalizeFlagIds, parseFlagBody, parseIdBody, parsePauseBody,
  parseReceiveBody, requestHosts,
} from "./stock-api.ts";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const P = "33333333-3333-4333-8333-333333333333";

const hosts = (host: string | null, forwardedHost: string | null = null) => ({ host, forwardedHost });

test("same origin: a page of this host may write", () => {
  assert.equal(isSameOrigin("https://kidkubpos.vercel.app", hosts("kidkubpos.vercel.app")), true);
  assert.equal(isSameOrigin("http://localhost:3000", hosts("localhost:3000")), true);
  // behind a proxy the forwarded host counts too (as Next compares for server actions)
  assert.equal(isSameOrigin("https://pos.example.com", hosts("internal:3000", "pos.example.com")), true);
});

test("cross origin: another site's page is refused (CSRF)", () => {
  assert.equal(isSameOrigin("https://evil.example", hosts("kidkubpos.vercel.app")), false);
  assert.equal(isSameOrigin("https://evil.example", hosts("kidkubpos.vercel.app", "kidkubpos.vercel.app")), false);
  // the port is part of the host
  assert.equal(isSameOrigin("http://localhost:4000", hosts("localhost:3000")), false);
  // a look-alike sub-domain is another host
  assert.equal(isSameOrigin("https://kidkubpos.vercel.app.evil.example", hosts("kidkubpos.vercel.app")), false);
});

test("an Origin of null, garbage, or with no host to compare is refused; no Origin at all is allowed", () => {
  assert.equal(isSameOrigin("null", hosts("kidkubpos.vercel.app")), false);
  assert.equal(isSameOrigin("not a url", hosts("kidkubpos.vercel.app")), false);
  assert.equal(isSameOrigin("https://kidkubpos.vercel.app", hosts(null, null)), false);
  assert.equal(isSameOrigin(null, hosts("kidkubpos.vercel.app")), true);
});

test("the request hosts: host, and the first x-forwarded-host", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  assert.deepEqual(requestHosts(h({ host: "a:3000" })), { host: "a:3000", forwardedHost: null });
  assert.deepEqual(requestHosts(h({ host: "a", "x-forwarded-host": " b.example , c.example" })), { host: "a", forwardedHost: "b.example" });
  assert.deepEqual(requestHosts(h({ "x-forwarded-host": "" })), { host: null, forwardedHost: null });
});

test("ids are real uuids", () => {
  assert.equal(isUuid(U1), true);
  assert.equal(isUuid(U1.toUpperCase()), true);
  for (const bad of ["", "x", "11111111-1111-4111-8111-11111111111", `${U1}x`, 5, null, undefined, {}]) assert.equal(isUuid(bad), false);
});

test("a flag body: 1–20 uuids, each once, and a menu uuid or null", () => {
  assert.deepEqual(parseFlagBody({ materialIds: [U1, U2, U1], productId: P }), { value: { materialIds: [U1, U2], productId: P } });
  assert.deepEqual(parseFlagBody({ materialIds: [U1], productId: null }), { value: { materialIds: [U1], productId: null } });
  assert.deepEqual(parseFlagBody({ materialIds: [U1] }), { value: { materialIds: [U1], productId: null } });
  for (const bad of [
    null, [], "x", { materialIds: [] }, { materialIds: "x" }, { materialIds: ["not-a-uuid"] }, { materialIds: [U1], productId: "x" },
    { materialIds: Array.from({ length: MAX_FLAG_MATERIALS + 1 }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`) },
  ]) {
    assert.deepEqual(parseFlagBody(bad), { error: BAD_REQUEST });
  }
});

test("the flag action and route share one id rule", () => {
  assert.deepEqual(normalizeFlagIds(["a", "a", "", 3, "b"]), ["a", "b"]);
  assert.equal(normalizeFlagIds([]), null);
  assert.equal(normalizeFlagIds("a"), null);
  assert.equal(normalizeFlagIds(Array.from({ length: 21 }, (_, i) => `m${i}`)), null);
});

test("a pause body: a menu uuid and a boolean", () => {
  assert.deepEqual(parsePauseBody({ productId: P, paused: true }), { value: { productId: P, paused: true } });
  assert.deepEqual(parsePauseBody({ productId: P, paused: false }), { value: { productId: P, paused: false } });
  for (const bad of [null, {}, { productId: P }, { productId: P, paused: "true" }, { productId: "x", paused: true }, [P, true]]) {
    assert.deepEqual(parsePauseBody(bad), { error: BAD_REQUEST });
  }
});

test("an undo body: one uuid under its own key", () => {
  assert.deepEqual(parseIdBody({ refId: U1 }, "refId"), { value: U1 });
  assert.deepEqual(parseIdBody({ ledgerId: U2 }, "ledgerId"), { value: U2 });
  assert.deepEqual(parseIdBody({ refId: U1 }, "ledgerId"), { error: BAD_REQUEST });
  assert.deepEqual(parseIdBody({ refId: "x" }, "refId"), { error: BAD_REQUEST });
  assert.deepEqual(parseIdBody(null, "refId"), { error: BAD_REQUEST });
});

test("a receive body: the inventory form's rules, the price only for an owner or manager", () => {
  assert.deepEqual(parseReceiveBody({ materialId: U1, quantity: 12000 }, false), {
    value: { materialId: U1, quantity: 12000, totalPrice: null, note: null },
  });
  // owner/manager: the price counts (as a number, or as typed)
  assert.deepEqual(parseReceiveBody({ materialId: U1, quantity: 2000, totalPrice: 120 }, true), {
    value: { materialId: U1, quantity: 2000, totalPrice: 120, note: null },
  });
  assert.deepEqual(parseReceiveBody({ materialId: U1, quantity: 2000, totalPrice: "120.50" }, true), {
    value: { materialId: U1, quantity: 2000, totalPrice: 120.5, note: null },
  });
  // staff: a price is dropped, never refused, never saved
  assert.deepEqual(parseReceiveBody({ materialId: U1, quantity: 2000, totalPrice: 120 }, false), {
    value: { materialId: U1, quantity: 2000, totalPrice: null, note: null },
  });
  // the form's Thai for a bad amount or price
  assert.deepEqual(parseReceiveBody({ materialId: U1, quantity: 0 }, true), { error: "กรุณากรอกจำนวนที่ถูกต้อง (> 0)" });
  assert.deepEqual(parseReceiveBody({ materialId: U1, quantity: 1, totalPrice: -1 }, true), { error: "กรุณากรอกราคาที่ถูกต้อง" });
  assert.deepEqual(parseReceiveBody({ materialId: U1, quantity: 1, note: "x".repeat(501) }, true), {
    error: "หมายเหตุยาวเกินไป (ไม่เกิน 500 ตัวอักษร)",
  });
  // shapes the POS never sends
  for (const bad of [
    null, {}, { materialId: "x", quantity: 1 }, { materialId: U1, quantity: "5" }, { materialId: U1, quantity: 1, totalPrice: {} },
    { materialId: U1, quantity: 1, note: 5 },
  ]) {
    assert.deepEqual(parseReceiveBody(bad, true), { error: BAD_REQUEST });
  }
});
