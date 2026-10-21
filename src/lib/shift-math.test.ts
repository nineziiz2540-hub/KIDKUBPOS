import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_MOVEMENT,
  closingStep,
  compareCount,
  depositFor,
  differenceLabel,
  formatMoney,
  liveSummaryVisible,
  parseAmount,
  personalOutstanding,
  planFloat,
  validateMovement,
  type ClosingAttempt,
} from "./shift-math.ts";

test("parseAmount accepts amounts the way people type them", () => {
  assert.equal(parseAmount("1,000"), 1000);
  assert.equal(parseAmount(" 950 "), 950);
  assert.equal(parseAmount("45.5"), 45.5);
  assert.equal(parseAmount("0"), 0);
});

test("parseAmount rejects malformed, negative, empty and too-large amounts", () => {
  assert.equal(parseAmount("45.555"), null);
  assert.equal(parseAmount("-5"), null);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("   "), null);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount("1000001"), null);
  assert.equal(parseAmount("100001", MAX_MOVEMENT), null);
  assert.equal(parseAmount("100000", MAX_MOVEMENT), 100000);
});

test("compareCount reports short, over, match and no comparison", () => {
  assert.deepEqual(compareCount(5670, 5690), { kind: "short", amount: 20 });
  assert.deepEqual(compareCount(5695, 5690), { kind: "over", amount: 5 });
  assert.deepEqual(compareCount(85.5, 85.5), { kind: "match" });
  assert.deepEqual(compareCount(1000, null), { kind: "none" });
});

test("compareCount compares in satang, not floats", () => {
  // 0.1 + 0.2 style drift must not show as a 0.00000001 difference.
  assert.deepEqual(compareCount(0.1 + 0.2, 0.3), { kind: "match" });
  assert.deepEqual(compareCount(100, 99.5), { kind: "over", amount: 0.5 });
});

test("differenceLabel uses the short Thai wording", () => {
  assert.equal(differenceLabel(compareCount(5670, 5690)), "ขาด ฿20");
  assert.equal(differenceLabel(compareCount(5695, 5690)), "เกิน ฿5");
  assert.equal(differenceLabel(compareCount(85.5, 85.5)), "ตรง");
  assert.equal(differenceLabel(compareCount(100, 99.5)), "เกิน ฿0.50");
  assert.equal(differenceLabel(compareCount(6690, 5690)), "เกิน ฿1,000");
});

test("formatMoney puts the minus sign before the baht sign", () => {
  assert.equal(formatMoney(5230), "฿5,230");
  assert.equal(formatMoney(85.5), "฿85.50");
  assert.equal(formatMoney(0), "฿0");
  assert.equal(formatMoney(-10), "−฿10");
  assert.equal(formatMoney(-0.5), "−฿0.50");
});

const a = (amount: number, expected: number): ClosingAttempt => ({ amount, expected });

test("closingStep follows the one-recount rule", () => {
  assert.equal(closingStep([], 100), "count1");
  assert.equal(closingStep([a(90, 100)], 100), "count2");
  assert.equal(closingStep([a(100, 100)], 100), "float");
  assert.equal(closingStep([a(90, 100), a(90, 100)], 100), "float");
});

test("closingStep asks for a fresh count when the expected cash changed since the last count", () => {
  assert.equal(closingStep([a(100, 100)], 150), "recount_changed");
  assert.equal(closingStep([a(90, 100), a(90, 100)], 150), "recount_changed");
  assert.equal(closingStep([a(90, 100), a(150, 150)], 150), "float");
});

test("the live summary (expected cash) is hidden while anyone is counting at closing", () => {
  assert.equal(liveSummaryVisible("idle"), true);
  assert.equal(liveSummaryVisible("float"), true);
  for (const step of ["held", "count1", "count2", "recount_changed"]) {
    assert.equal(liveSummaryVisible(step), false, step);
  }
});

test("planFloat keeps the shop's float and deposits the rest", () => {
  assert.deepEqual(planFloat(5670, 1000), { floatLeft: 1000, deposit: 4670, shortfall: 0 });
});

test("planFloat on a slow day keeps everything and reports the shortfall", () => {
  assert.deepEqual(planFloat(800, 1000), { floatLeft: 800, deposit: 0, shortfall: 200 });
  assert.deepEqual(planFloat(1000, 1000), { floatLeft: 1000, deposit: 0, shortfall: 0 });
});

test("depositFor is the count minus the float, and rejects a float outside 0..count", () => {
  assert.equal(depositFor(5670, 1500), 4170);
  assert.equal(depositFor(5670.5, 1000), 4670.5);
  assert.equal(depositFor(500, 500), 0);
  assert.equal(depositFor(500, 600), null);
  assert.equal(depositFor(500, -1), null);
});

test("personalOutstanding is personal top-ups minus personal returns, never negative", () => {
  const topup = { reason: "personal_topup", amount: 500 };
  const ice = { reason: "purchase", amount: 60 };
  const back = { reason: "personal_return", amount: 500 };
  assert.equal(personalOutstanding([topup, ice]), 500);
  assert.equal(personalOutstanding([topup, ice, back]), 0);
  assert.equal(personalOutstanding([back]), 0);
});

test("validateMovement accepts the agreed reasons", () => {
  assert.equal(validateMovement({ direction: "out", reason: "purchase", amount: 60, note: "" }), null);
  assert.equal(validateMovement({ direction: "in", reason: "personal_topup", amount: 500, note: "" }), null);
  assert.equal(validateMovement({ direction: "out", reason: "purchase", amount: 100000, note: "" }), null);
  assert.equal(validateMovement({ direction: "in", reason: "correction", amount: 60, note: "กดผิด" }), null);
  assert.equal(validateMovement({ direction: "out", reason: "correction", amount: 60, note: "กดผิด" }), null);
});

test("validateMovement rejects wrong direction, missing note, bad amount and long note", () => {
  assert.notEqual(validateMovement({ direction: "in", reason: "purchase", amount: 60, note: "" }), null);
  assert.notEqual(validateMovement({ direction: "out", reason: "other_out", amount: 60, note: "  " }), null);
  assert.notEqual(validateMovement({ direction: "in", reason: "correction", amount: 60, note: "" }), null);
  assert.notEqual(validateMovement({ direction: "out", reason: "purchase", amount: 0, note: "" }), null);
  assert.notEqual(validateMovement({ direction: "out", reason: "purchase", amount: 100000.01, note: "" }), null);
  assert.notEqual(validateMovement({ direction: "out", reason: "purchase", amount: 60, note: "x".repeat(201) }), null);
  assert.notEqual(validateMovement({ direction: "out", reason: "nope", amount: 60, note: "" }), null);
  assert.notEqual(validateMovement({ direction: "sideways", reason: "purchase", amount: 60, note: "" }), null);
});
