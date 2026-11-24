import { test } from "node:test";
import assert from "node:assert/strict";
import { isReceiptToken, receiptUrl, shouldRegisterServiceWorker } from "./receipt-link.ts";

const REF = "123e4567-e89b-42d3-a456-426614174000";

test("isReceiptToken accepts a v4 uuid in lower and upper case", () => {
  assert.equal(isReceiptToken(REF), true);
  assert.equal(isReceiptToken(REF.toUpperCase()), true);
});

test('isReceiptToken rejects "abc", "", a uuid with spaces, a 35-char string', () => {
  assert.equal(isReceiptToken("abc"), false);
  assert.equal(isReceiptToken(""), false);
  assert.equal(isReceiptToken(` ${REF} `), false);
  assert.equal(isReceiptToken(REF.slice(0, 35)), false);
});

test("receiptUrl strips the trailing slash of the origin", () => {
  assert.equal(receiptUrl("https://kidkubpos.vercel.app/", REF), "https://kidkubpos.vercel.app/r/" + REF);
  assert.equal(receiptUrl("https://kidkubpos.vercel.app", REF), "https://kidkubpos.vercel.app/r/" + REF);
});

test("shouldRegisterServiceWorker is false only under /r", () => {
  for (const p of ["/pos", "/", "/login", "/reports"]) assert.equal(shouldRegisterServiceWorker(p), true, p);
  for (const p of ["/r/x", "/r"]) assert.equal(shouldRegisterServiceWorker(p), false, p);
});
