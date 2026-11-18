import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEffectInputs, effectDraftsFromRows, effectRows, parseEffectDrafts } from "./option-effects.ts";

test("parseEffectDrafts: เพิ่มช็อต +9 g in the bean group, วิปครีม +15 g of a material", () => {
  const r = parseEffectDrafts([
    { kind: "slot_add", targetId: "g-bean", amount: "9" },
    { kind: "material_add", targetId: "whip", amount: " 15.5 " },
  ]);
  assert.deepEqual(r, {
    value: [
      { kind: "slot_add", groupId: "g-bean", amount: 9 },
      { kind: "material_add", materialId: "whip", amount: 15.5 },
    ],
  });
});

test("parseEffectDrafts: blank rows dropped, half rows and bad amounts refused", () => {
  assert.deepEqual(parseEffectDrafts([{ kind: "slot_add", targetId: "", amount: "" }]), { value: [] });
  assert.match((parseEffectDrafts([{ kind: "slot_add", targetId: "g", amount: "" }]) as { error: string }).error, /เลือกให้ครบ/);
  assert.match((parseEffectDrafts([{ kind: "material_add", targetId: "", amount: "3" }]) as { error: string }).error, /เลือกให้ครบ/);
  for (const a of ["0", "-1", "100001", "1.2345", "abc"]) {
    assert.match((parseEffectDrafts([{ kind: "slot_add", targetId: "g", amount: a }]) as { error: string }).error, /ปริมาณต้องมากกว่า 0/, a);
  }
});

test("the same target twice is refused (it would silently double)", () => {
  const r = parseEffectDrafts([
    { kind: "slot_add", targetId: "g", amount: "9" },
    { kind: "slot_add", targetId: "g", amount: "9" },
  ]);
  assert.deepEqual(r, { error: "ผลต่อสต๊อกซ้ำกัน — รวมเป็นบรรทัดเดียว" });
  // a group and a material may share an id string without clashing
  assert.ok("value" in parseEffectDrafts([
    { kind: "slot_add", targetId: "x", amount: "1" },
    { kind: "material_add", targetId: "x", amount: "1" },
  ]));
});

test("checkEffectInputs never trusts the client's shape", () => {
  assert.deepEqual(checkEffectInputs(null), { error: "ข้อมูลไม่ถูกต้อง" });
  assert.deepEqual(checkEffectInputs([{ kind: "slot_add", materialId: "m", amount: 1 }]), { error: "ข้อมูลไม่ถูกต้อง" });
  assert.deepEqual(checkEffectInputs([{ kind: "drop_table", groupId: "g", amount: 1 }]), { error: "ข้อมูลไม่ถูกต้อง" });
  assert.match((checkEffectInputs([{ kind: "slot_add", groupId: "g", amount: "9" }]) as { error: string }).error, /ปริมาณ/);
  assert.match((checkEffectInputs([{ kind: "slot_add", groupId: "g", amount: Infinity }]) as { error: string }).error, /ปริมาณ/);
  assert.match((checkEffectInputs(Array.from({ length: 21 }, (_, i) => ({ kind: "slot_add", groupId: `g${i}`, amount: 1 }))) as { error: string }).error, /ไม่เกิน 20/);
  // extra fields are not carried over
  assert.deepEqual(checkEffectInputs([{ kind: "slot_add", groupId: "g", amount: 9, tenant_id: "other" }]), {
    value: [{ kind: "slot_add", groupId: "g", amount: 9 }],
  });
});

test("rows ↔ drafts, and insert rows take the tenant from the caller", () => {
  const drafts = effectDraftsFromRows([
    { kind: "slot_add", group_id: "g", raw_material_id: null, amount: "9.000" },
    { kind: "material_add", group_id: null, raw_material_id: "m", amount: 15 },
    { kind: "slot_add", group_id: null, raw_material_id: null, amount: 1 }, // broken row: not shown
  ]);
  assert.deepEqual(drafts, [
    { kind: "slot_add", targetId: "g", amount: "9" },
    { kind: "material_add", targetId: "m", amount: "15" },
  ]);
  const parsed = parseEffectDrafts(drafts);
  assert.ok("value" in parsed);
  assert.deepEqual(effectRows("t1", "o1", parsed.value), [
    { tenant_id: "t1", option_id: "o1", kind: "slot_add", group_id: "g", raw_material_id: null, amount: 9 },
    { tenant_id: "t1", option_id: "o1", kind: "material_add", group_id: null, raw_material_id: "m", amount: 15 },
  ]);
});
