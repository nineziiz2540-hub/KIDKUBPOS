import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canAutoReload,
  classifyHeartbeat,
  INITIAL_CONNECTIVITY,
  isNewVersion,
  nextConnectivity,
  OFFLINE_AFTER_FAILURES,
  parseHeartbeatBody,
  RESULT_HOLD_MS,
} from "./connectivity.ts";

test("one failed check is not enough to cry wolf", () => {
  const s = nextConnectivity(INITIAL_CONNECTIVITY, "failure");
  assert.equal(s.status, "online");
  assert.equal(s.failures, 1);
});

test("two failed checks in a row mean offline", () => {
  assert.equal(OFFLINE_AFTER_FAILURES, 2);
  const s = nextConnectivity(nextConnectivity(INITIAL_CONNECTIVITY, "failure"), "failure");
  assert.equal(s.status, "offline");
});

test("one success after offline is back online with no failures", () => {
  const off = { status: "offline" as const, failures: 5 };
  assert.deepEqual(nextConnectivity(off, "success"), { status: "online", failures: 0 });
});

test("the browser saying offline goes offline at once", () => {
  assert.equal(nextConnectivity(INITIAL_CONNECTIVITY, "browser-offline").status, "offline");
});

test("a redirected or non-JSON answer means signed out, not offline", () => {
  assert.equal(classifyHeartbeat({ ok: true, redirected: true, contentType: "text/html" }), "signed-out");
  assert.equal(classifyHeartbeat({ ok: true, redirected: false, contentType: "text/html; charset=utf-8" }), "signed-out");
});

test("a server error is a failure", () => {
  assert.equal(classifyHeartbeat({ ok: false, redirected: false, contentType: "application/json" }), "failure");
});

test("a JSON answer is online", () => {
  assert.equal(
    classifyHeartbeat({ ok: true, redirected: false, contentType: "application/json; charset=utf-8" }),
    "online"
  );
});

test("auto-reload only when the POS is fully idle", () => {
  const idle = { cartCount: 0, heldLoaded: false, anyDialogOpen: false, paymentUnresolved: false, resultAgeMs: null, online: true };
  assert.equal(canAutoReload(idle), true);
  assert.equal(canAutoReload({ ...idle, cartCount: 1 }), false);
  assert.equal(canAutoReload({ ...idle, heldLoaded: true }), false);
  assert.equal(canAutoReload({ ...idle, anyDialogOpen: true }), false);
  assert.equal(canAutoReload({ ...idle, paymentUnresolved: true }), false);
});

test("a different build is a new version, but never against a dev build", () => {
  assert.equal(isNewVersion("dpl_a", "dpl_b"), true);
  assert.equal(isNewVersion("dpl_a", "dpl_a"), false);
  assert.equal(isNewVersion("dev", "dpl_b"), false);
  assert.equal(isNewVersion("dpl_a", "dev"), false);
});

// ── Final review fixes ──────────────────────────────────────────────────────

test("auto-reload waits while a sale's result is still on screen", () => {
  const idle = { cartCount: 0, heldLoaded: false, anyDialogOpen: false, paymentUnresolved: false };
  assert.equal(canAutoReload({ ...idle, resultAgeMs: 5_000, online: true }), false);
  assert.equal(canAutoReload({ ...idle, resultAgeMs: RESULT_HOLD_MS, online: true }), true);
  assert.equal(canAutoReload({ ...idle, resultAgeMs: null, online: true }), true);
});

test("auto-reload never happens while offline", () => {
  const idle = { cartCount: 0, heldLoaded: false, anyDialogOpen: false, paymentUnresolved: false };
  assert.equal(canAutoReload({ ...idle, resultAgeMs: null, online: false }), false);
});

test("a heartbeat without promptpayId leaves the last known value alone", () => {
  assert.deepEqual(parseHeartbeatBody({ version: "v1" }), { version: "v1", promptpayId: undefined });
  assert.deepEqual(parseHeartbeatBody({ version: "v1", promptpayId: null }), { version: "v1", promptpayId: null });
  assert.deepEqual(parseHeartbeatBody({ version: "v1", promptpayId: "0812345678" }), {
    version: "v1",
    promptpayId: "0812345678",
  });
  assert.deepEqual(parseHeartbeatBody("junk"), { version: undefined, promptpayId: undefined });
});
