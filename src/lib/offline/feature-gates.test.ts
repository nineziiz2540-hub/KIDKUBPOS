import { test } from "node:test";
import assert from "node:assert/strict";
import { gate } from "./feature-gates.ts";

const FEATURES = [
  "pin_discount",
  "hold",
  "resume_held",
  "member",
  "shift",
  "switch_user",
  "navigate",
] as const;

test("every feature except save_to_device is disabled offline", () => {
  for (const f of FEATURES) {
    assert.deepEqual(gate(f, { online: false, pendingCount: 0 }), {
      enabled: false,
      reason: "ใช้ไม่ได้ตอนเน็ตหลุด",
    });
  }
});
test("online with pending bills blocks all but navigate and switch_user", () => {
  for (const f of FEATURES) {
    const g = gate(f, { online: true, pendingCount: 2 });
    if (f === "navigate" || f === "switch_user") assert.equal(g.enabled, true);
    else assert.deepEqual(g, { enabled: false, reason: "รอส่งบิลค้างให้ครบก่อน" });
  }
});
test("online with nothing pending is enabled", () => {
  for (const f of [...FEATURES, "save_to_device" as const]) {
    assert.deepEqual(gate(f, { online: true, pendingCount: 0 }), { enabled: true });
  }
});
test("save_to_device ignores online and pending", () => {
  assert.deepEqual(gate("save_to_device", { online: false, pendingCount: 3 }), { enabled: true });
  assert.deepEqual(gate("save_to_device", { online: true, pendingCount: 3 }), { enabled: true });
});
test("save_to_device is disabled with a PIN discount", () => {
  assert.deepEqual(
    gate("save_to_device", { online: false, pendingCount: 0, attemptHasPinDiscount: true }),
    { enabled: false, reason: "ส่วนลดที่ใช้ PIN ต้องรอเน็ต" },
  );
});
