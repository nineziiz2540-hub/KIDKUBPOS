import { test } from "node:test";
import assert from "node:assert/strict";
import { removalCheck, nextDefaultAfterRemoval, type RemovalCtx, type RemovalMember } from "./member-removal.ts";

const members: RemovalMember[] = [
  { id: "a", tier: "house", sortOrder: 0, isDefault: true },
  { id: "b", tier: "house", sortOrder: 1, isDefault: false },
  { id: "s", tier: "special", sortOrder: 2, isDefault: false },
];
const ctx = (over: Partial<RemovalCtx> = {}): RemovalCtx => ({
  members,
  sweetnessUses: [],
  slotDefaults: [],
  ...over,
});

test("blocked: used in a menu's sweetness (default or allowed), names listed once", () => {
  const out = removalCheck("b", ctx({
    sweetnessUses: [
      { menuName: "ลาเต้", defaultMemberId: "b", allowedMemberIds: ["a", "b"] },
      { menuName: "ชาไทย", defaultMemberId: "a", allowedMemberIds: ["b"] },
      { menuName: "โกโก้", defaultMemberId: "a", allowedMemberIds: ["a"] },
    ],
  }));
  assert.deepEqual(out, { ok: false, reason: "ใช้อยู่ในความหวานของเมนู: ลาเต้, ชาไทย" });
});

test("blocked: the group's only house member", () => {
  const out = removalCheck("a", ctx({ members: members.filter((m) => m.id !== "b") }));
  assert.deepEqual(out, { ok: false, reason: "ต้องมีเมล็ดร้านอย่างน้อย 1 ตัว" });
});

test("a special member can go even when it is not the only one", () => {
  assert.deepEqual(removalCheck("s", ctx()), { ok: true, warn: null });
});

test("warn: it is a slot default of a menu", () => {
  const out = removalCheck("b", ctx({
    slotDefaults: [
      { menuName: "อเมริกาโน่", defaultMemberId: "b" },
      { menuName: "ลาเต้", defaultMemberId: "a" },
      { menuName: "เอสเปรสโซ่", defaultMemberId: "b" },
    ],
  }));
  assert.deepEqual(out, {
    ok: true,
    warn: "เป็นค่าเริ่มต้นของเมนู: อเมริกาโน่, เอสเปรสโซ่ — ระบบจะใช้ตัวร้านตัวถัดไปแทน",
  });
});

test("ok with no warn when nothing uses it", () => {
  assert.deepEqual(removalCheck("b", ctx()), { ok: true, warn: null });
});

test("removing the default moves it to the first remaining house member", () => {
  assert.equal(nextDefaultAfterRemoval(members, "a"), "b");
  // sort order decides, not array order; specials are never picked
  const shuffled: RemovalMember[] = [
    { id: "s", tier: "special", sortOrder: 0, isDefault: false },
    { id: "b", tier: "house", sortOrder: 5, isDefault: false },
    { id: "a", tier: "house", sortOrder: 0, isDefault: true },
    { id: "c", tier: "house", sortOrder: 3, isDefault: false },
  ];
  assert.equal(nextDefaultAfterRemoval(shuffled, "a"), "c");
});

test("removing a non-default member moves nothing", () => {
  assert.equal(nextDefaultAfterRemoval(members, "b"), null);
});
