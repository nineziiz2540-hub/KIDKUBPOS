import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMaterialInput } from "./material-input.ts";

function form(o: Record<string, string>) {
  return (k: string): string | null => (k in o ? o[k]! : null);
}
const ok = { name: "นมสด", unit: "ml" };

test("valid minimal input", () => {
  const r = parseMaterialInput(form(ok));
  assert.equal(r.error, undefined);
  assert.equal(r.fields?.category, "วัตถุดิบทั่วไป");
  assert.equal(r.fields?.track_stock, undefined);
});

test("track_stock: only on/off change it", () => {
  assert.equal(parseMaterialInput(form({ ...ok, track_stock: "on" })).fields?.track_stock, true);
  assert.equal(parseMaterialInput(form({ ...ok, track_stock: "off" })).fields?.track_stock, false);
  assert.equal(parseMaterialInput(form({ ...ok, track_stock: "x" })).fields?.track_stock, undefined);
});

test("length caps", () => {
  assert.equal(parseMaterialInput(form({ ...ok, name: "ก".repeat(101) })).error, "ชื่อยาวเกินไป (ไม่เกิน 100 ตัวอักษร)");
  assert.equal(parseMaterialInput(form({ ...ok, name: "ก".repeat(100) })).error, undefined);
  assert.ok(parseMaterialInput(form({ ...ok, unit: "x".repeat(21) })).error);
  assert.ok(parseMaterialInput(form({ ...ok, purchase_unit: "x".repeat(21), purchase_size: "2" })).error);
});

test("number caps", () => {
  assert.ok(parseMaterialInput(form({ ...ok, min_stock_alert: "-1" })).error);
  assert.ok(parseMaterialInput(form({ ...ok, min_stock_alert: "10000000" })).error);
  assert.equal(parseMaterialInput(form({ ...ok, min_stock_alert: "9999999" })).error, undefined);
  assert.ok(parseMaterialInput(form({ ...ok, purchase_unit: "ขวด", purchase_size: "0" })).error);
  assert.ok(parseMaterialInput(form({ ...ok, purchase_unit: "ขวด", purchase_size: "10000000" })).error);
  assert.ok(parseMaterialInput(form({ ...ok, cost_per_unit: "100000000" })).error);
  assert.ok(parseMaterialInput(form({ ...ok, cost_per_unit: "-1" })).error);
  assert.equal(parseMaterialInput(form({ ...ok, cost_per_unit: "0.054" })).error, undefined);
});

test("purchase unit and size come together", () => {
  assert.ok(parseMaterialInput(form({ ...ok, purchase_unit: "ขวด" })).error);
  assert.ok(parseMaterialInput(form({ ...ok, purchase_size: "2000" })).error);
  assert.equal(
    parseMaterialInput(form({ ...ok, purchase_unit: "ขวด", purchase_size: "2000" })).fields?.purchase_size,
    2000
  );
});
