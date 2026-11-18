import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMade, clampMade, totalCups } from "./void-made.ts";

const items = [
  { id: "a", quantity: 3 },
  { id: "b", quantity: 1 },
];

test("none and all answer every item", () => {
  assert.deepEqual(buildMade("none", { a: 2 }, items), { a: "none", b: "none" });
  assert.deepEqual(buildMade("all", {}, items), { a: "all", b: "all" });
});

test("some uses the counter per line and defaults to 0", () => {
  assert.deepEqual(buildMade("some", { a: 1 }, items), { a: 1, b: 0 });
});

test("some clamps to 0..quantity and whole numbers", () => {
  assert.equal(clampMade(5, 3), 3);
  assert.equal(clampMade(-2, 3), 0);
  assert.equal(clampMade(1.9, 3), 1);
  assert.equal(clampMade(Number.NaN, 3), 0);
  assert.equal(clampMade(undefined, 3), 0);
  assert.deepEqual(buildMade("some", { a: 9, b: -1 }, items), { a: 3, b: 0 });
});

test("an empty bill gives an empty answer", () => {
  assert.deepEqual(buildMade("all", {}, []), {});
});

test("totalCups sums quantities", () => {
  assert.equal(totalCups(items), 4);
  assert.equal(totalCups([]), 0);
});

import { isMadeComplete } from "./void-made.ts";

test("isMadeComplete: nothing chosen is incomplete, none/all are complete", () => {
  assert.equal(isMadeComplete(null, {}, items), false);
  assert.equal(isMadeComplete("none", {}, items), true);
  assert.equal(isMadeComplete("all", {}, items), true);
});

test("isMadeComplete: some needs at least one cup made", () => {
  assert.equal(isMadeComplete("some", {}, items), false);
  assert.equal(isMadeComplete("some", { a: 0, b: 0 }, items), false);
  assert.equal(isMadeComplete("some", { a: -4 }, items), false);
  assert.equal(isMadeComplete("some", { b: 1 }, items), true);
  assert.equal(isMadeComplete("some", { a: 9 }, items), true);
  assert.equal(isMadeComplete("some", { zzz: 2 }, items), false);
});
