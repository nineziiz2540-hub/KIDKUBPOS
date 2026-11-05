import { test } from "node:test";
import assert from "node:assert/strict";
import {
  afterFailure,
  backoffMs,
  counts,
  deviceNumberedMode,
  MAX_GENERIC_TRIES,
  sendable,
  startupRecovery,
  type OutboxEntry,
  type OutboxState,
} from "./outbox-rules.ts";

function entry(over: Partial<OutboxEntry> & { clientRef: string }): OutboxEntry {
  return {
    tenantId: "t1",
    sellerId: "u1",
    state: "pending",
    createdAt: 1000,
    input: { items: [], paymentMethod: "cash", orderType: "dine_in" } as unknown as OutboxEntry["input"],
    offline: null,
    display: {
      total: 50,
      itemCount: 1,
      itemsText: "ลาเต้",
      paymentMethod: "cash",
      queueNumber: null,
      cashReceived: null,
      changeAmount: null,
    },
    tries: 0,
    nextTryAt: 0,
    lastError: null,
    reviewCode: null,
    serverQueueNumber: null,
    ...over,
  };
}
const st = (clientRef: string, state: OutboxState, o: Partial<OutboxEntry> = {}) =>
  entry({ clientRef, state, ...o });

test("startupRecovery turns attempt into check-only only", () => {
  const out = startupRecovery([
    st("a", "attempt"),
    st("b", "pending"),
    st("c", "review"),
    st("d", "check-only"),
  ]);
  assert.deepEqual(
    out.map((e) => e.state),
    ["check-only", "pending", "review", "check-only"],
  );
});

test("sendable filters and sorts oldest first", () => {
  const list = [
    st("late", "pending", { createdAt: 30 }),
    st("early", "pending", { createdAt: 10 }),
    st("other", "pending", { tenantId: "t2", createdAt: 5 }),
    st("rev", "review", { createdAt: 1 }),
    st("chk", "check-only", { createdAt: 2 }),
    st("future", "pending", { createdAt: 3, nextTryAt: 999 }),
  ];
  assert.deepEqual(
    sendable(list, 100, "t1").map((e) => e.clientRef),
    ["early", "late"],
  );
});

test("deviceNumberedMode", () => {
  assert.equal(deviceNumberedMode([], "t1", false), true);
  assert.equal(deviceNumberedMode([st("a", "pending")], "t1", true), true);
  assert.equal(deviceNumberedMode([st("a", "pending", { tenantId: "t2" })], "t1", true), false);
  assert.equal(deviceNumberedMode([st("a", "review"), st("b", "check-only")], "t1", true), false);
});

test("backoff sequence", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(backoffMs), [5000, 10000, 20000, 40000, 60000, 60000]);
});

test("afterFailure retry schedules the next try", () => {
  const r = afterFailure(st("a", "pending", { tries: 1 }), { outcome: "retry", error: "x" }, 1000);
  assert.equal(r.state, "pending");
  assert.equal(r.tries, 2);
  assert.equal(r.nextTryAt, 1000 + backoffMs(1));
  assert.equal(r.lastError, "x");
});

test("afterFailure review and refused go to review", () => {
  const a = afterFailure(
    st("a", "pending"),
    { outcome: "review", reviewCode: "menu_changed", error: "e1" },
    1,
  );
  assert.equal(a.state, "review");
  assert.equal(a.reviewCode, "menu_changed");
  assert.equal(a.lastError, "e1");
  const b = afterFailure(st("a", "pending"), { outcome: "refused", error: "e2" }, 1);
  assert.equal(b.state, "review");
  assert.equal(b.reviewCode, "other");
  assert.equal(b.lastError, "e2");
});

test("generic retry past the cap becomes review other", () => {
  const generic = "บันทึกออเดอร์ไม่สำเร็จ";
  const r = afterFailure(
    st("a", "pending", { tries: MAX_GENERIC_TRIES }),
    { outcome: "retry", error: generic },
    1,
  );
  assert.equal(r.state, "review");
  assert.equal(r.reviewCode, "other");
  const below = afterFailure(
    st("a", "pending", { tries: MAX_GENERIC_TRIES - 1 }),
    { outcome: "retry", error: generic },
    1,
  );
  assert.equal(below.state, "pending");
  const nonGeneric = afterFailure(
    st("a", "pending", { tries: MAX_GENERIC_TRIES }),
    { outcome: "retry", error: "network" },
    1,
  );
  assert.equal(nonGeneric.state, "pending");
});

test("counts", () => {
  const list = [
    st("a", "pending"),
    st("b", "pending"),
    st("c", "review"),
    st("d", "check-only"),
    st("e", "attempt"),
    st("f", "pending", { tenantId: "t2" }),
  ];
  assert.deepEqual(counts(list, "t1"), { pending: 2, review: 1, checkOnly: 1 });
});
