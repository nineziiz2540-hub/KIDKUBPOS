import { test } from "node:test";
import assert from "node:assert/strict";
import { observeQueue, nextDeviceQueue } from "./device-queue.ts";

test("observeQueue starts from null", () => {
  assert.deepEqual(observeQueue(null, "2026-11-05", 12), { date: "2026-11-05", last: 12 });
});
test("observeQueue keeps the max on the same date", () => {
  assert.equal(observeQueue({ date: "2026-11-05", last: 12 }, "2026-11-05", 9).last, 12);
  assert.equal(observeQueue({ date: "2026-11-05", last: 12 }, "2026-11-05", 15).last, 15);
});
test("observeQueue resets on a new date", () => {
  assert.deepEqual(observeQueue({ date: "2026-11-04", last: 40 }, "2026-11-05", 3), {
    date: "2026-11-05",
    last: 3,
  });
});
test("nextDeviceQueue starts at 1 on a new date", () => {
  const r = nextDeviceQueue({ date: "2026-11-04", last: 40 }, "2026-11-05");
  assert.equal(r.number, 1);
  assert.deepEqual(r.state, { date: "2026-11-05", last: 1 });
  assert.equal(nextDeviceQueue(null, "2026-11-05").number, 1);
});
test("nextDeviceQueue continues on the same date", () => {
  const r = nextDeviceQueue({ date: "2026-11-05", last: 12 }, "2026-11-05");
  assert.equal(r.number, 13);
  assert.equal(r.state.last, 13);
});
