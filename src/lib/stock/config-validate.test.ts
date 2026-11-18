import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateGroupMembers, validateSweetnessAmount, validateSweetnessLevels,
  type LevelInput, type MemberInput,
} from "./config-validate.ts";

const m = (o: Partial<MemberInput> = {}): MemberInput => ({
  materialId: "m1", label: "คั่วอ่อน", tier: "house", priceDelta: 0, isDefault: false, ...o,
});
const beans = (): MemberInput[] => [
  m({ materialId: "a", label: "คั่วอ่อน" }),
  m({ materialId: "b", label: "คั่วกลาง", isDefault: true }),
  m({ materialId: "c", label: "คั่วเข้ม" }),
  m({ materialId: "k", label: "Kenya", tier: "special", priceDelta: 20 }),
];
const lv = (name: string, o: Partial<LevelInput> = {}): LevelInput => ({ name, isNone: false, isDefault: false, ...o });
const levels = (): LevelInput[] => [
  lv("ไม่หวาน", { isNone: true }), lv("หวานน้อย"), lv("หวานปกติ", { isDefault: true }), lv("หวานมาก"),
];

test("validateGroupMembers accepts the real bean setup", () => {
  assert.equal(validateGroupMembers("bean", beans()), null);
});
test("validateGroupMembers allows zero defaults", () => {
  assert.equal(validateGroupMembers("bean", beans().map((x) => ({ ...x, isDefault: false }))), null);
});
test("validateGroupMembers rejects bad members", () => {
  const bad = (members: MemberInput[], kind: "bean" | "sweetener" = "bean") =>
    assert.notEqual(validateGroupMembers(kind, members), null);
  bad([m({ isDefault: true }), m({ materialId: "z", isDefault: true })]);
  bad([m(), m()]);
  bad([m({ tier: "special", priceDelta: -1 })]);
  bad([m({ tier: "special", priceDelta: 20.555 })]);
  bad([m({ tier: "special", priceDelta: NaN })]);
  bad([m({ tier: "special", priceDelta: 100001 })]);
  bad([m({ priceDelta: 5 })]);
  bad([m({ label: "  " })]);
  bad([m({ tier: "special", priceDelta: 0 }), m({ materialId: "z" })], "sweetener");
});

test("validateSweetnessLevels accepts the real setup", () => {
  assert.equal(validateSweetnessLevels(levels()), null);
});
test("validateSweetnessLevels rejects bad levels", () => {
  const bad = (l: LevelInput[]) => assert.notEqual(validateSweetnessLevels(l), null);
  bad([lv("  ")]);
  bad([lv("หวานน้อย"), lv(" หวานน้อย ")]);
  bad([lv("a", { isNone: true }), lv("b", { isNone: true })]);
  bad([lv("a", { isDefault: true }), lv("b", { isDefault: true })]);
});

test("validateSweetnessAmount", () => {
  for (const a of [0, 10, 20, 35, 10000]) assert.equal(validateSweetnessAmount(a), null);
  for (const a of [-1, 10000.01, NaN]) assert.notEqual(validateSweetnessAmount(a), null);
});

test("validateSweetnessAmount: at most 3 decimals", () => {
  assert.equal(validateSweetnessAmount(12.125), null);
  assert.notEqual(validateSweetnessAmount(1.2345), null);
});
