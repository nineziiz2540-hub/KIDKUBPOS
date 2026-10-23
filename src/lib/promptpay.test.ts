import { test } from "node:test";
import assert from "node:assert/strict";
import generatePayload from "promptpay-qr";
import { buildPromptPayPayload } from "./promptpay.ts";

test("buildPromptPayPayload matches promptpay-qr for a whole amount", () => {
  assert.equal(
    buildPromptPayPayload("0812345678", 160),
    generatePayload("0812345678", { amount: 160 })
  );
});

test("buildPromptPayPayload rounds a float-noisy amount to satang first", () => {
  assert.equal(
    buildPromptPayPayload("0812345678", 85.49999999999999),
    generatePayload("0812345678", { amount: 85.5 })
  );
});

test("the payload is an EMVCo QR payload", () => {
  assert.ok(buildPromptPayPayload("0812345678", 55).startsWith("000201"));
});
