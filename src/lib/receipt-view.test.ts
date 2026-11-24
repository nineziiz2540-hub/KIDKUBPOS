import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toReceiptView, receiptTitle, RECEIPT_NOT_FOUND, RECEIPT_CANCELLED, RECEIPT_REFUNDED, RECEIPT_UNPAID,
  type ReceiptData,
} from "./receipt-view.ts";

const base: ReceiptData = {
  shop_name: "The Connect", shop_logo_url: null, order_number: "TC-0123", queue_number: 12,
  created_at: "2026-11-24T07:05:00Z", status: "completed",
  items: [{ name: "ลาเต้เย็น", quantity: 2, subtotal: 140, choices: null, options: null }],
  subtotal: 140, discount_amount: 0, total: 140, payment_method: "cash", cash_received: 200, change_amount: 60,
};

function receipt(d: ReceiptData) {
  const v = toReceiptView(d);
  assert.equal(v.kind, "receipt");
  if (v.kind !== "receipt") throw new Error("unreachable");
  return v;
}

test("completed cash bill", () => {
  const v = receipt(base);
  assert.equal(v.billLine, "บิล TC-0123 · คิว 12");
  assert.equal(v.dateTime, "24 พ.ย. 2569 14:05 น.");
  assert.equal(v.lines[0]?.text, "ลาเต้เย็น ×2");
  assert.equal(v.lines[0]?.amount, "฿140.00");
  assert.equal(v.total, "฿140.00");
  assert.equal(v.payment, "ชำระโดย เงินสด");
  assert.equal(v.cash, "รับเงิน ฿200.00 · ทอน ฿60.00");
  assert.equal(v.subtotal, null);
  assert.equal(v.discount, null);
});

test("discount shows subtotal and minus line", () => {
  const v = receipt({ ...base, subtotal: 155, discount_amount: 15 });
  assert.equal(v.subtotal, "฿155.00");
  assert.equal(v.discount, "-฿15.00");
});

test("thousands separator", () => {
  assert.equal(receipt({ ...base, total: 1250 }).total, "฿1,250.00");
});

test("Bangkok time across midnight", () => {
  assert.equal(receipt({ ...base, created_at: "2026-11-24T17:30:00Z" }).dateTime, "25 พ.ย. 2569 00:30 น.");
});

test("transfer shows no cash line even if amounts are present", () => {
  const v = receipt({ ...base, payment_method: "transfer" });
  assert.equal(v.payment, "ชำระโดย โอนเงิน");
  assert.equal(v.cash, null);
});

test("house glass word is not on the receipt", () => {
  const choices = {
    slots: [], slotAddGroupIds: [],
    sweetness: { levelId: "l1", levelName: "หวานน้อย", memberId: null, label: null },
    packaging: { houseGlass: true as const },
  };
  const item = { name: "ลาเต้เย็น", quantity: 1, subtotal: 70, choices, options: null };
  const v = receipt({ ...base, items: [item] });
  const detail = v.lines[0]?.detail;
  assert.ok(detail && detail.includes("หวานน้อย"));
  assert.ok(!detail.includes("แก้วร้าน"));
});

test("logo passes through; empty string becomes null", () => {
  assert.equal(receipt({ ...base, shop_logo_url: "https://x/logo.png" }).logoUrl, "https://x/logo.png");
  assert.equal(receipt({ ...base, shop_logo_url: "" }).logoUrl, null);
});

test("cancelled/refunded/unpaid give a notice with the exact message and tone", () => {
  const cases: [string, string, string][] = [
    ["cancelled", RECEIPT_CANCELLED, "destructive"],
    ["refunded", RECEIPT_REFUNDED, "warning"],
    ["unpaid", RECEIPT_UNPAID, "destructive"],
  ];
  for (const [status, message, tone] of cases) {
    const v = toReceiptView({ ...base, status });
    assert.equal(v.kind, "notice");
    if (v.kind === "notice") {
      assert.equal(v.message, message);
      assert.equal(v.tone, tone);
    }
  }
  assert.equal(RECEIPT_CANCELLED, "บิลนี้ถูกยกเลิกแล้ว");
  assert.equal(RECEIPT_REFUNDED, "บิลนี้คืนเงินแล้ว");
  assert.equal(RECEIPT_UNPAID, "ร้านยังไม่ได้รับเงินสำหรับบิลนี้ กรุณาติดต่อร้าน");
});

test("unknown status is not shown as paid", () => {
  assert.equal(toReceiptView({ ...base, status: "voided" }).kind, "not_found");
});

test("null data gives not_found with RECEIPT_NOT_FOUND", () => {
  assert.deepEqual(toReceiptView(null), { kind: "not_found", message: RECEIPT_NOT_FOUND });
});

test("completed with no items gives a receipt with lines []", () => {
  const { items: _i, ...rest } = base;
  void _i;
  assert.deepEqual(receipt(rest).lines, []);
});

test("receiptTitle", () => {
  assert.equal(receiptTitle(toReceiptView(base)), "ใบเสร็จ · The Connect");
  assert.equal(receiptTitle(toReceiptView(null)), "ใบเสร็จ");
});
