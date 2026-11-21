import { test } from "node:test";
import assert from "node:assert/strict";
import { flagText } from "./flag-text.ts";

const when = "2026-11-21T03:00:00Z";

test("sold_while_out reads as the sentence with menu, material, date and who, plus the hint", () => {
  const r = flagText(
    { kind: "sold_while_out", created_at: when },
    { menu: "ลาเต้", material: "นมสด", person: "สมชาย", orderNumber: null }
  );
  assert.equal(r.text, "ขายลาเต้ตอนระบบคิดว่านมสดหมด · 21 พ.ย. 2569 · โดย สมชาย");
  assert.equal(r.hint, "รับของเข้าหรือนับใหม่ให้ตรง");
});

test("stock_skipped names the bill and has no hint", () => {
  const r = flagText(
    { kind: "stock_skipped", created_at: when },
    { menu: null, material: null, person: null, orderNumber: "A-0042" }
  );
  assert.equal(r.text, "หักสต๊อกไม่สำเร็จ · บิล A-0042");
  assert.equal(r.hint, null);
});

test("missing names fall back to neutral words and never crash", () => {
  const a = flagText(
    { kind: "sold_while_out", created_at: when },
    { menu: null, material: null, person: null, orderNumber: null }
  );
  assert.equal(a.text, "ขายเมนูตอนระบบคิดว่าวัตถุดิบหมด · 21 พ.ย. 2569 · โดย -");
  const b = flagText(
    { kind: "stock_skipped", created_at: when },
    { menu: null, material: null, person: null, orderNumber: null }
  );
  assert.equal(b.text, "หักสต๊อกไม่สำเร็จ · บิล -");
});
