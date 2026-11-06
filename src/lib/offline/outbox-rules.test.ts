import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adoptableRef,
  afterFailure,
  backoffMs,
  checkable,
  closeBlockCounts,
  counts,
  deviceNumberedMode,
  hasSenderWork,
  MAX_GENERIC_TRIES,
  MISSING_OFFLINE_MESSAGE,
  missingOfflineToReview,
  needsCounterRaise,
  nextWork,
  ORPHAN_AFTER_MS,
  recoverOrphans,
  saleBusinessDate,
  saleKey,
  sendable,
  startupRecovery,
  type OutboxEntry,
  type OutboxState,
} from "./outbox-rules.ts";
import { restorable, toDraft, type DraftState } from "./cart-draft.ts";

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

const offline = (o: Partial<NonNullable<OutboxEntry["offline"]>> = {}) => ({
  tenantId: "t1",
  sellerId: "u1",
  soldAt: "2026-11-05T10:00:00.000Z",
  queueNumber: 7,
  shiftId: null,
  ...o,
});

test("ORPHAN_AFTER_MS is the payment deadline plus 30 s", () => {
  assert.equal(ORPHAN_AFTER_MS, 45_000);
});

test("recoverOrphans touches only old attempts of this shop and returns only changes", () => {
  const now = 1_000_000;
  const old = now - ORPHAN_AFTER_MS - 1;
  const out = recoverOrphans(
    [
      st("old", "attempt", { createdAt: old }),
      st("young", "attempt", { createdAt: now - 1000 }),
      st("edge", "attempt", { createdAt: now - ORPHAN_AFTER_MS }),
      st("other", "attempt", { tenantId: "t2", createdAt: old }),
      st("pend", "pending", { createdAt: old }),
    ],
    now,
    "t1",
  );
  assert.deepEqual(
    out.map((e) => [e.clientRef, e.state]),
    [["old", "check-only"]],
  );
});

test("checkable: old check-only entries of this shop, oldest first", () => {
  const now = 1_000_000;
  const old = now - ORPHAN_AFTER_MS - 1;
  const out = checkable(
    [
      st("b", "check-only", { createdAt: old }),
      st("a", "check-only", { createdAt: old - 5 }),
      st("young", "check-only", { createdAt: now - 10 }),
      st("other", "check-only", { tenantId: "t2", createdAt: old }),
      st("att", "attempt", { createdAt: old }),
    ],
    now,
    "t1",
  );
  assert.deepEqual(out.map((e) => e.clientRef), ["a", "b"]);
});

test("needsCounterRaise: review with device data and no marker, this shop only", () => {
  const out = needsCounterRaise(
    [
      st("r", "review", { offline: offline() }),
      st("done", "review", { offline: offline(), counterRaised: true }),
      st("noDevice", "review", { offline: null }),
      st("other", "review", { tenantId: "t2", offline: offline() }),
      st("pend", "pending", { offline: offline() }),
      st("flagFalse", "review", { offline: offline(), counterRaised: false, createdAt: 1 }),
    ],
    "t1",
  );
  assert.deepEqual(out.map((e) => e.clientRef), ["flagFalse", "r"]);
});

test("saleBusinessDate uses the Bangkok date of the sale time, else createdAt", () => {
  // 18:30Z is 01:30 the next day in Bangkok.
  assert.equal(
    saleBusinessDate(st("a", "review", { offline: offline({ soldAt: "2026-11-05T18:30:00.000Z" }) })),
    "2026-11-06",
  );
  // The sale time wins over when the entry was put.
  assert.equal(
    saleBusinessDate(
      st("a", "review", {
        createdAt: Date.parse("2026-11-09T05:00:00Z"),
        offline: offline({ soldAt: "2026-11-05T05:00:00.000Z" }),
      }),
    ),
    "2026-11-05",
  );
  assert.equal(
    saleBusinessDate(st("a", "review", { offline: null, createdAt: Date.parse("2026-11-05T17:00:00Z") })),
    "2026-11-06",
  );
  assert.equal(
    saleBusinessDate(
      st("a", "review", { offline: offline({ soldAt: "garbage" }), createdAt: Date.parse("2026-11-05T01:00:00Z") }),
    ),
    "2026-11-05",
  );
});

test("missingOfflineToReview moves the entry to review other with a reason", () => {
  const r = missingOfflineToReview(st("a", "pending"));
  assert.equal(r.state, "review");
  assert.equal(r.reviewCode, "other");
  assert.equal(r.lastError, MISSING_OFFLINE_MESSAGE);
  assert.ok(r.lastError);
});

test("nextWork order: due pending, then check-only, then counter raise; skips tried", () => {
  const now = 1_000_000;
  const old = now - ORPHAN_AFTER_MS - 1;
  const list = [
    st("p2", "pending", { createdAt: 20 }),
    st("p1", "pending", { createdAt: 10 }),
    st("wait", "pending", { createdAt: 1, nextTryAt: now + 1 }),
    st("c", "check-only", { createdAt: old }),
    st("r", "review", { offline: offline() }),
  ];
  assert.deepEqual(nextWork(list, now, "t1", new Set()), { kind: "send", entry: list[1] });
  const noPending = list.slice(2);
  assert.deepEqual(nextWork(noPending, now, "t1", new Set()), { kind: "check", entry: list[3] });
  assert.deepEqual(nextWork(noPending, now, "t1", new Set(["c"])), { kind: "raise", entry: list[4] });
  assert.equal(nextWork(noPending, now, "t1", new Set(["c", "r"])), null);
  // Another shop's entries are never work.
  assert.equal(
    nextWork([st("x", "pending", { tenantId: "t2" }), st("y", "review", { tenantId: "t2", offline: offline() })], now, "t1", new Set()),
    null,
  );
  // A pending bill is sent again even if tried earlier in the burst (it is gated by nextTryAt).
  const p1 = list[1]!;
  assert.deepEqual(nextWork([p1], now, "t1", new Set(["p1"])), { kind: "send", entry: p1 });
});

test("hasSenderWork", () => {
  assert.equal(hasSenderWork([], "t1"), false);
  assert.equal(hasSenderWork([st("a", "pending")], "t1"), true);
  assert.equal(hasSenderWork([st("a", "check-only")], "t1"), true);
  assert.equal(hasSenderWork([st("a", "attempt")], "t1"), true);
  assert.equal(hasSenderWork([st("a", "review", { offline: offline(), counterRaised: true })], "t1"), false);
  assert.equal(hasSenderWork([st("a", "review", { offline: offline() })], "t1"), true);
  assert.equal(hasSenderWork([st("a", "pending", { tenantId: "t2" })], "t1"), false);
});

// ── closeBlockCounts (R24b) ─────────────────────────────────────────────────
test("closeBlockCounts: product_missing review bills don't block, they are counted apart", () => {
  const list = [
    st("p", "pending"),
    st("r1", "review", { reviewCode: "menu_changed" }),
    st("r2", "review", { reviewCode: "product_missing" }),
    st("r3", "review", { reviewCode: "other" }),
    st("c", "check-only"),
    st("x", "review", { tenantId: "t2", reviewCode: "other" }),
  ];
  assert.deepEqual(closeBlockCounts(list, "t1"), { pending: 1, review: 2, unrecordable: 1 });
  assert.deepEqual(closeBlockCounts(list), { pending: 1, review: 3, unrecordable: 1 });
  assert.deepEqual(closeBlockCounts([], "t1"), { pending: 0, review: 0, unrecordable: 0 });
});

// ── saleKey / adoptableRef (lost answer → reload → same client_ref) ─────────
const latte = {
  cartItemKey: "p1",
  productId: "p1",
  name: "ลาเต้",
  basePrice: 55,
  quantity: 2,
  selectedModifiers: [],
  note: null,
  totalPrice: 110,
};
const cartInput = {
  items: [latte],
  paymentMethod: "cash" as const,
  orderType: "dine_in" as const,
  clientRef: "",
};

test("saleKey ignores client_ref, cash received and names; follows what makes the sale", () => {
  const base = saleKey(cartInput);
  assert.equal(saleKey({ ...cartInput }), base);
  assert.equal(
    saleKey({ ...cartInput, items: [{ ...latte, name: "x", cartItemKey: "k" }] }),
    base,
  );
  assert.notEqual(saleKey({ ...cartInput, items: [{ ...latte, quantity: 3, totalPrice: 165 }] }), base);
  assert.notEqual(saleKey({ ...cartInput, paymentMethod: "transfer" }), base);
  assert.notEqual(saleKey({ ...cartInput, discountType: "amount", discountValue: 10 }), base);
  assert.notEqual(saleKey({ ...cartInput, heldBillId: "h1", heldBillVersion: 2 }), base);
  assert.notEqual(saleKey({ ...cartInput, customerId: "c1" }), base);
});

const REF_A = "11111111-1111-4111-8111-111111111111";
const REF_B = "22222222-2222-4222-8222-222222222222";
const ids = { tenantId: "t1", sellerId: "u1" };
const draftState = (over: Partial<DraftState> = {}): DraftState => ({
  savedAt: 1000,
  items: [latte],
  orderType: "dine_in",
  paymentMethod: "cash",
  customer: null,
  activeHeld: null,
  discount: null,
  ...over,
});
/** A draft saved, then read back after a reload (JSON round trip through the device store). */
const reloaded = (state: DraftState) =>
  restorable(JSON.parse(JSON.stringify(toDraft(state, ids))), ids);

test("adoptableRef takes only the draft's own ref, still unanswered, same shop/seller/sale", () => {
  const input = cartInput as unknown as OutboxEntry["input"];
  const key = saleKey(cartInput);
  const list = [
    st(REF_A, "check-only", { input }),
    st(REF_B, "attempt", { input }),
    st("final", "pending", { input }),
    st("shop2", "check-only", { input, tenantId: "t2" }),
    st("seller2", "attempt", { input, sellerId: "u2" }),
  ];
  assert.equal(adoptableRef(REF_A, list, "t1", "u1", key), REF_A);
  assert.equal(adoptableRef(REF_B, list, "t1", "u1", key), REF_B);
  // No ref, a ref with no entry, a final bill, another shop/seller, or another sale: nothing.
  assert.equal(adoptableRef(undefined, list, "t1", "u1", key), null);
  assert.equal(adoptableRef(null, list, "t1", "u1", key), null);
  assert.equal(adoptableRef("33333333-3333-4333-8333-333333333333", list, "t1", "u1", key), null);
  assert.equal(adoptableRef("final", list, "t1", "u1", key), null);
  assert.equal(adoptableRef("shop2", list, "t1", "u1", key), null);
  assert.equal(adoptableRef("seller2", list, "t1", "u1", key), null);
  assert.equal(
    adoptableRef(REF_A, list, "t1", "u1", saleKey({ ...cartInput, paymentMethod: "transfer" })),
    null,
  );
});

test("lost answer → reload: the restored cart adopts the ref its draft stored", () => {
  // Sale A was tried online (draft saved with its ref), the answer was lost: entry check-only.
  const outbox = [st(REF_A, "check-only", { input: cartInput as unknown as OutboxEntry["input"] })];
  const back = reloaded(draftState({ attemptRef: REF_A }));
  assert.equal(back?.attemptRef, REF_A);
  assert.equal(adoptableRef(back?.attemptRef, outbox, "t1", "u1", saleKey(cartInput)), REF_A);
});

test("clear → identical cart for the next customer → reload: nothing is adopted", () => {
  // Sale A's answer was lost (check-only), then the cart was cleared (draft discarded) and
  // customer B ordered the very same cart; B never paid, so B's draft carries no ref.
  const outbox = [st(REF_A, "check-only", { input: cartInput as unknown as OutboxEntry["input"] })];
  const back = reloaded(draftState());
  assert.ok(back);
  assert.equal(back.attemptRef, undefined);
  assert.equal(adoptableRef(back.attemptRef, outbox, "t1", "u1", saleKey(cartInput)), null);
});

test("the draft's attempt ref must be a UUID; a malformed one is dropped, the cart still restores", () => {
  const d = toDraft(draftState({ attemptRef: REF_A }), ids);
  assert.equal(d?.attemptRef, REF_A);
  assert.equal(toDraft(draftState({ attemptRef: "x" }), ids)?.attemptRef, undefined);
  const bad = restorable({ ...d, attemptRef: 42 }, ids);
  assert.ok(bad);
  assert.equal(bad.attemptRef, undefined);
  assert.equal(restorable({ ...d, attemptRef: "not-a-uuid" }, ids)?.attemptRef, undefined);
});
