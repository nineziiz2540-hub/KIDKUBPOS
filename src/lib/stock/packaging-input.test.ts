import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PACKAGING_RPC_CODES,
  packagingMaterialGroups,
  packagingRpcError,
  packagingSetCost,
  packagingSetPayload,
  parseBagSettings,
  parsePackagingSetDraft,
  setInUseMessage,
} from "./packaging-input.ts";

const err = (r: { value: unknown } | { error: string }) => ("error" in r ? r.error : null);

// ── parsePackagingSetDraft: the brief's five errors, verbatim ─────────────────────────────────────

test("a set needs a name: ตั้งชื่อชุดภาชนะ", () => {
  assert.equal(err(parsePackagingSetDraft({ name: "", items: [{ materialId: "cup", qty: "1" }] })), "ตั้งชื่อชุดภาชนะ");
  assert.equal(err(parsePackagingSetDraft({ name: "   ", items: [{ materialId: "cup", qty: "1" }] })), "ตั้งชื่อชุดภาชนะ");
});

test("a set needs at least one material: ใส่วัตถุดิบอย่างน้อย 1 อย่าง", () => {
  assert.equal(err(parsePackagingSetDraft({ name: "แก้วเย็น 16oz", items: [] })), "ใส่วัตถุดิบอย่างน้อย 1 อย่าง");
  // a row the owner added but never filled is not an item
  assert.equal(
    err(parsePackagingSetDraft({ name: "แก้วเย็น 16oz", items: [{ materialId: "", qty: "" }] })),
    "ใส่วัตถุดิบอย่างน้อย 1 อย่าง"
  );
});

test("the same material twice: วัตถุดิบซ้ำกัน — รวมเป็นบรรทัดเดียว", () => {
  const r = parsePackagingSetDraft({
    name: "แก้วเย็น 16oz",
    items: [
      { materialId: "cup", qty: "1" },
      { materialId: "lid", qty: "1" },
      { materialId: "cup", qty: "1" },
    ],
  });
  assert.equal(err(r), "วัตถุดิบซ้ำกัน — รวมเป็นบรรทัดเดียว");
});

test("qty per cup above 0 and up to 1,000: จำนวนต่อแก้วต้องมากกว่า 0 ไม่เกิน 1,000", () => {
  for (const qty of ["0", "-1", "1000.5", "1001", "abc", ""]) {
    assert.equal(
      err(parsePackagingSetDraft({ name: "แก้วเย็น 16oz", items: [{ materialId: "cup", qty }] })),
      "จำนวนต่อแก้วต้องมากกว่า 0 ไม่เกิน 1,000",
      qty
    );
  }
  // the edges are fine
  assert.equal(err(parsePackagingSetDraft({ name: "x", items: [{ materialId: "cup", qty: "1000" }] })), null);
  assert.equal(err(parsePackagingSetDraft({ name: "x", items: [{ materialId: "cup", qty: "0.001" }] })), null);
});

test("at most 20 lines: ตั้งได้ไม่เกิน 20 บรรทัด", () => {
  const items = Array.from({ length: 21 }, (_, i) => ({ materialId: `m${i}`, qty: "1" }));
  assert.equal(err(parsePackagingSetDraft({ name: "ชุดใหญ่", items })), "ตั้งได้ไม่เกิน 20 บรรทัด");
  assert.equal(err(parsePackagingSetDraft({ name: "ชุดใหญ่", items: items.slice(0, 20) })), null);
});

test("a valid draft: แก้วเย็น 16oz = แก้ว 16oz 1, ฝาโดม 1, หลอด 1", () => {
  const r = parsePackagingSetDraft({
    name: "  แก้วเย็น 16oz ",
    items: [
      { materialId: "cup16", qty: "1" },
      { materialId: "", qty: "" }, // blank row dropped
      { materialId: "dome", qty: " 1 " },
      { materialId: "straw", qty: "1.5" },
    ],
  });
  assert.deepEqual(r, {
    value: {
      name: "แก้วเย็น 16oz",
      items: [
        { materialId: "cup16", qty: 1 },
        { materialId: "dome", qty: 1 },
        { materialId: "straw", qty: 1.5 },
      ],
    },
  });
  assert.ok("value" in r);
  assert.deepEqual(packagingSetPayload(r.value), {
    p_name: "แก้วเย็น 16oz",
    p_items: [
      { material_id: "cup16", qty: 1 },
      { material_id: "dome", qty: 1 },
      { material_id: "straw", qty: 1.5 },
    ],
  });
});

test("names over 60 characters, more than 3 decimals, a qty with no material, a bad shape", () => {
  assert.equal(err(parsePackagingSetDraft({ name: "ก".repeat(61), items: [{ materialId: "cup", qty: "1" }] })), "ชื่อชุดภาชนะยาวเกิน 60 ตัวอักษร");
  assert.equal(err(parsePackagingSetDraft({ name: "ก".repeat(60), items: [{ materialId: "cup", qty: "1" }] })), null);
  assert.equal(
    err(parsePackagingSetDraft({ name: "x", items: [{ materialId: "cup", qty: "1.2345" }] })),
    "จำนวนต่อแก้วใส่ทศนิยมได้ไม่เกิน 3 ตำแหน่ง"
  );
  assert.equal(
    err(parsePackagingSetDraft({ name: "x", items: [{ materialId: "", qty: "1" }] })),
    "เลือกวัตถุดิบให้ครบทุกบรรทัด หรือลบบรรทัดที่ไม่ใช้"
  );
  // the server never trusts what a client sent
  for (const bad of [null, "x", { name: 1, items: [] }, { name: "x", items: "cup" }, { name: "x", items: [null] }, { name: "x", items: [{ materialId: 5, qty: "1" }] }]) {
    assert.equal(err(parsePackagingSetDraft(bad)), "ข้อมูลไม่ถูกต้อง กรุณารีเฟรชหน้า", JSON.stringify(bad));
  }
});

// ── cost per cup (owner/manager page) ─────────────────────────────────────────────────────────────

test("packagingSetCost: qty × current cost in satang; no-cost and archived materials", () => {
  const materials = [
    { id: "cup16", name: "แก้ว 16oz", unit: "ชิ้น", costPerUnit: 2.5, archived: false },
    { id: "dome", name: "ฝาโดม", unit: "ชิ้น", costPerUnit: 0.75, archived: false },
    { id: "straw", name: "หลอด", unit: "ชิ้น", costPerUnit: 0, archived: false },
    { id: "old", name: "แก้วเก่า", unit: "ชิ้น", costPerUnit: 3, archived: true },
  ];
  assert.deepEqual(
    packagingSetCost([{ materialId: "cup16", qty: 1 }, { materialId: "dome", qty: 2 }], materials),
    { costSatang: 400, missingMaterials: [] }
  );
  // a material with no price is named (the number is too low); an archived one is not deducted at the till
  assert.deepEqual(
    packagingSetCost([{ materialId: "cup16", qty: 1 }, { materialId: "straw", qty: 1 }, { materialId: "old", qty: 1 }], materials),
    { costSatang: 250, missingMaterials: ["หลอด"] }
  );
});

test("packagingMaterialGroups: บรรจุภัณฑ์ first, then the other categories in their order", () => {
  const groups = packagingMaterialGroups([
    { id: "milk", category: "นม & ครีม" },
    { id: "cup", category: "บรรจุภัณฑ์" },
    { id: "bean", category: "เมล็ดกาแฟ" },
    { id: "lid", category: "บรรจุภัณฑ์" },
  ]);
  assert.deepEqual(
    groups.map((g) => [g.category, g.items.map((i) => i.id)]),
    [
      ["บรรจุภัณฑ์", ["cup", "lid"]],
      ["นม & ครีม", ["milk"]],
      ["เมล็ดกาแฟ", ["bean"]],
    ]
  );
});

// ── every code the SQL raises reads as plain Thai ────────────────────────────────────────────────

test("every save_packaging_set / archive_packaging_set code maps to Thai", () => {
  assert.deepEqual([...PACKAGING_RPC_CODES].sort(), [
    "duplicate_material", "forbidden", "invalid_qty", "items_required", "material_not_found",
    "name_required", "name_taken", "name_too_long", "set_in_use", "set_not_found", "too_many_items",
  ]);
  const fallback = packagingRpcError("something_new");
  for (const code of PACKAGING_RPC_CODES) {
    const text = packagingRpcError(code);
    assert.notEqual(text, fallback, code);
    assert.match(text, /[฀-๿]/, code);
    assert.doesNotMatch(text, /_/, code);
  }
  assert.equal(packagingRpcError("name_required"), "ตั้งชื่อชุดภาชนะ");
  assert.equal(packagingRpcError("items_required"), "ใส่วัตถุดิบอย่างน้อย 1 อย่าง");
  assert.equal(packagingRpcError("duplicate_material"), "วัตถุดิบซ้ำกัน — รวมเป็นบรรทัดเดียว");
  assert.equal(packagingRpcError("invalid_qty"), "จำนวนต่อแก้วต้องมากกว่า 0 ไม่เกิน 1,000");
  assert.equal(packagingRpcError("too_many_items"), "ตั้งได้ไม่เกิน 20 บรรทัด");
  assert.equal(packagingRpcError(undefined), fallback);
});

test("set_in_use names the menus: ใช้อยู่ในเมนู: ลาเต้, อเมริกาโน่", () => {
  assert.equal(setInUseMessage(["ลาเต้", "อเมริกาโน่"]), "ใช้อยู่ในเมนู: ลาเต้, อเมริกาโน่");
  const many = ["a", "b", "c", "d", "e", "f", "g", "h"];
  assert.equal(setInUseMessage(many), "ใช้อยู่ในเมนู: a, b, c, d, e, f และอีก 2 เมนู");
  // the menus could not be read: still says why and what to do
  assert.equal(setInUseMessage([]), packagingRpcError("set_in_use"));
});

// ── shop bag settings ("ถุงหิ้ว") ─────────────────────────────────────────────────────────────────

test("parseBagSettings: none, or 1 bag per N cups with N 1–20", () => {
  assert.deepEqual(parseBagSettings({ materialId: "bag", mode: "none", perCups: "" }), {
    value: { bagMaterialId: "bag", bagsPerCups: null },
  });
  assert.deepEqual(parseBagSettings({ materialId: "bag", mode: "per_cups", perCups: " 2 " }), {
    value: { bagMaterialId: "bag", bagsPerCups: 2 },
  });
  for (const n of ["1", "20"]) assert.equal(err(parseBagSettings({ materialId: "bag", mode: "per_cups", perCups: n })), null);
  for (const n of ["0", "21", "1.5", "-1", "abc", ""]) {
    assert.equal(
      err(parseBagSettings({ materialId: "bag", mode: "per_cups", perCups: n })),
      "1 ถุงต่อทุก N แก้ว: ใส่ N เป็นจำนวนเต็ม 1–20",
      n
    );
  }
  // no bag material: nothing is counted, so no automatic bags either
  assert.deepEqual(parseBagSettings({ materialId: "", mode: "per_cups", perCups: "2" }), {
    value: { bagMaterialId: null, bagsPerCups: null },
  });
  assert.equal(err(parseBagSettings({ materialId: "bag", mode: "always", perCups: "" })), "ข้อมูลไม่ถูกต้อง กรุณารีเฟรชหน้า");
  assert.equal(err(parseBagSettings({ materialId: 7, mode: "none", perCups: "" })), "ข้อมูลไม่ถูกต้อง กรุณารีเฟรชหน้า");
});
