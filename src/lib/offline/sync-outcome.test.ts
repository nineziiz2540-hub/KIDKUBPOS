import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkOfflineSale,
  classifyRecordError,
  recordErrorMessage,
  REVIEW_MESSAGES,
} from "./sync-outcome.ts";

const OFFLINE = { offline: true };
const ONLINE = { offline: false };

test("a cash bill whose shift closed goes to review as shift_closed", () => {
  assert.deepEqual(
    classifyRecordError('P0001: offline_shift_closed (SQLSTATE P0001)', OFFLINE),
    { outcome: "review", reviewCode: "shift_closed" }
  );
});

test("a stale held bill is reviewed offline and refused online", () => {
  assert.deepEqual(classifyRecordError("held_bill_stale", OFFLINE), {
    outcome: "review",
    reviewCode: "held_bill_stale",
  });
  assert.deepEqual(classifyRecordError("held_bill_stale", ONLINE), { outcome: "refused" });
});

test("forbidden offline means the seller was deactivated", () => {
  assert.deepEqual(classifyRecordError("forbidden", OFFLINE), {
    outcome: "review",
    reviewCode: "seller_inactive",
  });
  assert.deepEqual(classifyRecordError("forbidden", ONLINE), { outcome: "refused" });
});

test("a deleted product is reviewed as product_missing", () => {
  const raw =
    'insert or update on table "order_items" violates foreign key constraint "order_items_product_id_fkey"';
  assert.deepEqual(classifyRecordError(raw, OFFLINE), {
    outcome: "review",
    reviewCode: "product_missing",
  });
  assert.deepEqual(classifyRecordError(raw, ONLINE), { outcome: "refused" });
});

test("a network failure is retried", () => {
  assert.deepEqual(classifyRecordError("TypeError: fetch failed", OFFLINE), { outcome: "retry" });
  assert.deepEqual(classifyRecordError("TypeError: fetch failed", ONLINE), { outcome: "retry" });
});

test("no open shift online is refused", () => {
  assert.deepEqual(classifyRecordError("no_open_shift", ONLINE), { outcome: "refused" });
});

test("invalid_offline, reason_required and invalid_queue_number are reviewed as other offline", () => {
  for (const code of ["invalid_offline", "reason_required", "invalid_queue_number"]) {
    assert.deepEqual(classifyRecordError(code, OFFLINE), { outcome: "review", reviewCode: "other" });
    assert.deepEqual(classifyRecordError(code, ONLINE), { outcome: "refused" });
  }
});

test("a Postgres data exception is never retried", () => {
  const raw = 'invalid input syntax for type uuid: "x"';
  assert.deepEqual(classifyRecordError(raw, { offline: true, sqlState: "22P02" }), {
    outcome: "review",
    reviewCode: "other",
  });
  assert.deepEqual(classifyRecordError(raw, { offline: false, sqlState: "22P02" }), {
    outcome: "refused",
  });
});

test("an old tab's missing client_ref is retried", () => {
  assert.deepEqual(classifyRecordError("invalid_client_ref", OFFLINE), { outcome: "retry" });
});

test("offline_shift_closed has its own message, not the online shift_closed one", () => {
  assert.equal(recordErrorMessage("offline_shift_closed"), REVIEW_MESSAGES.shift_closed);
  assert.equal(recordErrorMessage("fetch failed"), null);
  assert.equal(recordErrorMessage("x", "22P02"), "ข้อมูลบิลไม่ถูกต้อง");
});

test("review messages are the exact copy", () => {
  assert.deepEqual(REVIEW_MESSAGES, {
    menu_changed: "ราคาหรือเมนูมีการเปลี่ยนแปลงระหว่างเน็ตหลุด",
    held_bill_stale: "บิลพักนี้ถูกแก้ไข ชำระ หรือยกเลิกไปแล้ว กรุณาเปิดรายการบิลพักใหม่",
    shift_closed: "กะที่เปิดอยู่ตอนขายถูกปิดไปแล้ว",
    needs_approval: "ส่วนลดนี้ต้องให้ผู้จัดการอนุมัติ",
    seller_inactive: "พนักงานที่ขายบิลนี้ถูกปิดใช้งานแล้ว",
    product_missing: "มีเมนูในบิลที่ถูกลบไปแล้ว บันทึกไม่ได้",
    other: "",
  });
});

// ── checkOfflineSale ────────────────────────────────────────────────────────

const TENANT = "11111111-1111-4111-8111-111111111111";
const SALE = {
  tenantId: TENANT,
  sellerId: "22222222-2222-4222-8222-222222222222",
  soldAt: "2026-11-05T09:30:00.000Z",
  queueNumber: 12,
  shiftId: "33333333-3333-4333-8333-333333333333",
};

test("a valid offline sale passes", () => {
  assert.deepEqual(checkOfflineSale(SALE, TENANT), { ok: true, sale: SALE });
  assert.deepEqual(checkOfflineSale({ ...SALE, shiftId: null }, TENANT), {
    ok: true,
    sale: { ...SALE, shiftId: null },
  });
});

test("wrong_tenant: a bill of another shop waits, it is never sent or refused", () => {
  assert.deepEqual(
    checkOfflineSale({ ...SALE, tenantId: "44444444-4444-4444-8444-444444444444" }, TENANT),
    { error: "บิลนี้เป็นของร้านอื่น", outcome: "retry" }
  );
});

test("a sale time without a zone is rejected; Z or an offset is accepted", () => {
  assert.deepEqual(checkOfflineSale({ ...SALE, soldAt: "2026-11-05T09:30" }, TENANT), {
    error: "ข้อมูลบิลที่ขายตอนเน็ตหลุดไม่ถูกต้อง",
    outcome: "review",
    reviewCode: "other",
  });
  assert.ok("ok" in checkOfflineSale({ ...SALE, soldAt: "2026-11-05T16:30:00+07:00" }, TENANT));
  assert.ok("ok" in checkOfflineSale({ ...SALE, soldAt: "2026-11-05T09:30:00.000Z" }, TENANT));
});

test("an invalid offline sale goes to review as other", () => {
  const bad = [
    { ...SALE, sellerId: "nope" },
    { ...SALE, soldAt: "yesterday-ish" },
    { ...SALE, soldAt: "2026-11-05T09:30" },
    { ...SALE, queueNumber: 0 },
    { ...SALE, queueNumber: 10000 },
    { ...SALE, queueNumber: 1.5 },
    { ...SALE, shiftId: "x" },
    { ...SALE, shiftId: undefined },
  ];
  for (const sale of bad) {
    const r = checkOfflineSale(sale, TENANT);
    assert.ok(!("ok" in r), JSON.stringify(sale));
    assert.equal(r.outcome, "review");
    assert.equal(r.reviewCode, "other");
  }
  const notObject = checkOfflineSale("junk", TENANT);
  assert.ok(!("ok" in notObject));
  assert.equal(notObject.outcome, "review");
});
