import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canAutoReload,
  classifyHeartbeat,
  FIRST_RECHECK_MS,
  INITIAL_CONNECTIVITY,
  isNewVersion,
  nextConnectivity,
  OFFLINE_AFTER_FAILURES,
  parseHeartbeatBody,
  recheckAfterFailureMs,
  RESULT_HOLD_MS,
  showSyncingBar,
} from "./connectivity.ts";

test("a page that has never reached the server re-checks soon after a failed check", () => {
  assert.equal(FIRST_RECHECK_MS, 3_000);
  // Reloaded while offline: the first check failed, so the verdict comes in seconds, not 30 s.
  assert.equal(recheckAfterFailureMs({ failures: 1, everSucceeded: false }), FIRST_RECHECK_MS);
});

test("no quick re-check once the page has reached the server, or once it is already offline", () => {
  // A page that was working keeps the slow, no-crying-wolf pace.
  assert.equal(recheckAfterFailureMs({ failures: 1, everSucceeded: true }), null);
  assert.equal(recheckAfterFailureMs({ failures: OFFLINE_AFTER_FAILURES, everSucceeded: false }), null);
});

test("the yellow 'back online' bar waits until the server has answered once", () => {
  const base = { offline: false, sending: false, pendingCount: 2 };
  assert.equal(showSyncingBar({ ...base, confirmed: false }), false);
  assert.equal(showSyncingBar({ ...base, confirmed: false, sending: true }), false);
  assert.equal(showSyncingBar({ ...base, confirmed: true }), true);
});

test("the yellow bar never shows offline or with nothing to send", () => {
  assert.equal(showSyncingBar({ offline: true, confirmed: true, sending: true, pendingCount: 2 }), false);
  assert.equal(showSyncingBar({ offline: false, confirmed: true, sending: false, pendingCount: 0 }), false);
  assert.equal(showSyncingBar({ offline: false, confirmed: true, sending: true, pendingCount: 0 }), true);
});

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
  const none = { shiftId: undefined, queue: undefined };
  assert.deepEqual(parseHeartbeatBody({ version: "v1" }), { version: "v1", promptpayId: undefined, ...none });
  assert.deepEqual(parseHeartbeatBody({ version: "v1", promptpayId: null }), {
    version: "v1",
    promptpayId: null,
    ...none,
  });
  assert.deepEqual(parseHeartbeatBody({ version: "v1", promptpayId: "0812345678" }), {
    version: "v1",
    promptpayId: "0812345678",
    ...none,
  });
  assert.deepEqual(parseHeartbeatBody("junk"), { version: undefined, promptpayId: undefined, ...none });
});

// ── Round C2: open shift and today's queue counter ──────────────────────────

test("a heartbeat carries the open shift and today's last queue number", () => {
  assert.deepEqual(parseHeartbeatBody({ version: "v", shiftId: null, queue: { date: "2026-11-05", last: 12 } }), {
    version: "v",
    promptpayId: undefined,
    shiftId: null,
    queue: { date: "2026-11-05", last: 12 },
  });
  assert.equal(parseHeartbeatBody({ version: "v", shiftId: "s1" }).shiftId, "s1");
});

test("a heartbeat without shift or queue leaves both undefined", () => {
  const r = parseHeartbeatBody({ version: "v" });
  assert.equal(r.shiftId, undefined);
  assert.equal(r.queue, undefined);
});

test("a queue with a non-number last is ignored", () => {
  assert.equal(parseHeartbeatBody({ version: "v", queue: { date: "2026-11-05", last: "12" } }).queue, undefined);
  assert.equal(parseHeartbeatBody({ version: "v", queue: { last: 3 } }).queue, undefined);
  assert.equal(parseHeartbeatBody({ version: "v", queue: null }).queue, undefined);
});
