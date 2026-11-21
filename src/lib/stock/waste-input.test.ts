import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WASTE_REASONS,
  parseWasteInput,
  wasteLabel,
  wasteMaterialQty,
  wasteReasonText,
  wasteUndoErrorMessage,
  type WasteInput,
} from "./waste-input.ts";

const menu = (over: Record<string, unknown> = {}) => ({
  kind: "menu", productId: "p1", quantity: 1, optionIds: [], reason: "ทำหก", ...over,
});
const material = (over: Record<string, unknown> = {}) => ({ kind: "material", materialId: "m1", qty: 200, reason: "ทำหก", ...over });

test("parseWasteInput accepts a menu waste", () => {
  const r = parseWasteInput(menu({ quantity: 2, optionIds: ["o1"], houseGlass: true }));
  assert.deepEqual(r, { value: { kind: "menu", productId: "p1", quantity: 2, optionIds: ["o1"], houseGlass: true, reason: "ทำหก" } });
});

test("parseWasteInput accepts a material waste, and keeps a 3-decimal quantity", () => {
  assert.deepEqual(parseWasteInput(material({ qty: 1000.125 })), {
    value: { kind: "material", materialId: "m1", qty: 1000.125, reason: "ทำหก" },
  });
});

test("parseWasteInput: reason must be one of the six; อื่น ๆ needs 1-100 chars of text", () => {
  assert.equal(WASTE_REASONS.length, 6);
  assert.deepEqual(parseWasteInput(menu({ reason: "" })), { error: "เลือกเหตุผล" });
  assert.deepEqual(parseWasteInput(menu({ reason: "ตกใจ" })), { error: "เลือกเหตุผล" });
  assert.deepEqual(parseWasteInput(menu({ reason: undefined })), { error: "เลือกเหตุผล" });
  assert.deepEqual(parseWasteInput(menu({ reason: "อื่น ๆ" })), { error: "พิมพ์เหตุผลสั้น ๆ" });
  assert.deepEqual(parseWasteInput(menu({ reason: "อื่น ๆ", otherText: "   " })), { error: "พิมพ์เหตุผลสั้น ๆ" });
  assert.deepEqual(parseWasteInput(menu({ reason: "อื่น ๆ", otherText: "x".repeat(101) })), { error: "พิมพ์เหตุผลสั้น ๆ" });
  const ok = parseWasteInput(menu({ reason: "อื่น ๆ", otherText: "  แมวทำตก  " }));
  assert.deepEqual(ok, { value: { kind: "menu", productId: "p1", quantity: 1, optionIds: [], reason: "อื่น ๆ", otherText: "แมวทำตก" } });
  assert.ok("value" in parseWasteInput(menu({ reason: "อื่น ๆ", otherText: "x".repeat(100) })));
});

test("parseWasteInput: menu quantity is an integer 1..20", () => {
  for (const q of [0, 21, 1.5, -1, "2", null, NaN]) {
    assert.deepEqual(parseWasteInput(menu({ quantity: q })), { error: "ใส่จำนวนให้ถูกต้อง" }, String(q));
  }
  assert.ok("value" in parseWasteInput(menu({ quantity: 20 })));
});

test("parseWasteInput: material qty is > 0, <= 100,000, at most 3 decimals", () => {
  for (const q of [0, -5, 100000.001, 1.0001, "5", null, Infinity]) {
    assert.deepEqual(parseWasteInput(material({ qty: q })), { error: "ใส่จำนวนให้ถูกต้อง" }, String(q));
  }
  assert.ok("value" in parseWasteInput(material({ qty: 100000 })));
  assert.ok("value" in parseWasteInput(material({ qty: 0.001 })));
});

test("parseWasteInput refuses anything that is not a waste", () => {
  for (const raw of [null, undefined, "x", 5, [], {}, { kind: "other" }, menu({ productId: "" }), material({ materialId: 3 }),
    menu({ optionIds: "o1" }), menu({ optionIds: [1] }), menu({ houseGlass: "yes" }), menu({ choices: { slots: "no" } })]) {
    assert.ok("error" in parseWasteInput(raw), JSON.stringify(raw));
  }
});

test("wasteLabel: a menu with choices, a material in ml, and the unit word of a cup", () => {
  const latte = parseWasteInput(menu()) as { value: WasteInput };
  assert.equal(wasteLabel(latte.value, { name: "ลาเต้", parts: ["เคนยา"] }), "ลาเต้ เคนยา 1 แก้ว");
  const two = parseWasteInput(menu({ quantity: 3 })) as { value: WasteInput };
  assert.equal(wasteLabel(two.value, { name: "มัทฉะ" }), "มัทฉะ 3 แก้ว");
  const milk = parseWasteInput(material()) as { value: WasteInput };
  assert.equal(wasteLabel(milk.value, { name: "นมโอ๊ต", unit: "ml" }), "นมโอ๊ต 200 ml");
  const half = parseWasteInput(material({ qty: 1000.5 })) as { value: WasteInput };
  assert.equal(wasteLabel(half.value, { name: "นมสด", unit: "ml" }), "นมสด 1,000.5 ml");
});

test("reason text joins reason and label (อื่น ๆ uses the typed text)", () => {
  const a = parseWasteInput(menu()) as { value: WasteInput };
  assert.equal(wasteReasonText(a.value, "ลาเต้ เคนยา 1 แก้ว"), "ทำหก · ลาเต้ เคนยา 1 แก้ว");
  const b = parseWasteInput(material({ reason: "อื่น ๆ", otherText: "แมวทำตก" })) as { value: WasteInput };
  assert.equal(wasteReasonText(b.value, "นมโอ๊ต 200 ml"), "แมวทำตก · นมโอ๊ต 200 ml");
});

test("wasteMaterialQty: ½ of a 2,000 ml purchase unit is 1,000 ml; the use unit is taken as typed", () => {
  assert.equal(wasteMaterialQty("", 0.5, "purchase", 2000), 1000);
  assert.equal(wasteMaterialQty("2", 0.25, "purchase", 2000), 4500);
  assert.equal(wasteMaterialQty("150", 0, "use", 2000), 150);
  assert.equal(wasteMaterialQty("150", 0.5, "use", null), 150.5);
  assert.equal(wasteMaterialQty("", 0, "use", null), null);
  assert.equal(wasteMaterialQty("3", 0, "purchase", null), 3); // no purchase size: already the use unit
});

test("wasteUndoErrorMessage maps every code to plain Thai, never a raw code", () => {
  assert.equal(wasteUndoErrorMessage("too_late"), "เลยเวลาย้อนกลับแล้ว (10 นาที)");
  assert.equal(wasteUndoErrorMessage("forbidden"), "ย้อนกลับได้เฉพาะคนที่บันทึก หรือผู้จัดการ");
  assert.equal(wasteUndoErrorMessage("already_undone"), "ย้อนกลับไปแล้ว");
  assert.equal(wasteUndoErrorMessage("not_found"), "ไม่พบรายการนี้");
  assert.equal(wasteUndoErrorMessage("some weird failure"), "ย้อนกลับไม่สำเร็จ ลองใหม่อีกครั้ง");
  assert.equal(wasteUndoErrorMessage(undefined), "ย้อนกลับไม่สำเร็จ ลองใหม่อีกครั้ง");
});

test("groupMaterials groups by category and sorts names, carrying no cost", async () => {
  const { groupMaterials } = await import("./waste-input.ts");
  const m = (id: string, name: string, category: string) => ({ id, name, unit: "ml", category, purchaseUnit: null, purchaseSize: null });
  const g = groupMaterials([m("1", "ข", "นม"), m("2", "ค", "เมล็ด"), m("3", "ก", "นม")]);
  assert.deepEqual(g.map((x) => [x.category, x.items.map((i) => i.id)]), [["นม", ["3", "1"]], ["เมล็ด", ["2"]]]);
});
