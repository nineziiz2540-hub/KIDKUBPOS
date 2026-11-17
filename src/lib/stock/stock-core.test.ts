import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cupPriceDeltaSatang, defaultLevel, defaultSlotMember, resolveLine, STOCK_STALE,
  type ChoiceGroup, type GroupMember, type ResolvedLine, type StockCatalog,
} from "./stock-core.ts";

function member(id: string, groupId: string, materialId: string, o: Partial<GroupMember> = {}): GroupMember {
  return { id, groupId, materialId, label: materialId, tier: "house", priceDelta: 0, isDefault: false, sortOrder: 0, ...o };
}

function build(): StockCatalog {
  const beans: ChoiceGroup = {
    id: "beans", kind: "bean", name: "เมล็ด",
    members: [
      member("m_light", "beans", "light", { sortOrder: 1 }),
      member("m_med", "beans", "med", { sortOrder: 2, isDefault: true }),
      member("m_dark", "beans", "dark", { sortOrder: 3 }),
      member("m_kenya", "beans", "kenya", { tier: "special", priceDelta: 20, sortOrder: 4 }),
    ],
  };
  const sweet: ChoiceGroup = {
    id: "sweet", kind: "sweetener", name: "ความหวาน",
    members: [
      member("m_syrup", "sweet", "syrup", { isDefault: true, sortOrder: 1 }),
      member("m_condensed", "sweet", "condensed", { sortOrder: 2 }),
      member("m_mix", "sweet", "mix", { sortOrder: 3 }),
    ],
  };
  const table = (m: string, v: number[]): [string, number][] =>
    ["none", "less", "normal", "more"].map((l, i) => [`${m}:${l}`, v[i]!]);
  return {
    recipes: new Map([
      ["latte", [
        { kind: "slot", groupId: "beans", qty: 18, defaultMemberId: "m_med", allowSpecial: true },
        { kind: "fixed", materialId: "milk", qty: 180 },
        { kind: "fixed", materialId: "ice", qty: 150 },
      ]],
      ["espresso_house", [
        { kind: "slot", groupId: "beans", qty: 18, defaultMemberId: "m_med", allowSpecial: false },
      ]],
      ["thai_tea", []],
    ]),
    groups: new Map([["beans", beans], ["sweet", sweet]]),
    levels: [
      { id: "none", name: "ไม่หวาน", isNone: true, isDefault: false, sortOrder: 1 },
      { id: "less", name: "หวานน้อย", isNone: false, isDefault: false, sortOrder: 2 },
      { id: "normal", name: "หวานปกติ", isNone: false, isDefault: true, sortOrder: 3 },
      { id: "more", name: "หวานมาก", isNone: false, isDefault: false, sortOrder: 4 },
    ],
    standardSweetness: new Map([
      ...table("m_syrup", [0, 10, 20, 35]),
      ...table("m_condensed", [0, 15, 30, 45]),
      ...table("m_mix", [0, 15, 30, 45]),
    ]),
    productSweetness: new Map([
      ["latte", { groupId: "sweet", defaultMemberId: "m_syrup", allowedMemberIds: ["m_condensed", "m_mix"], defaultLevelId: null, custom: null }],
      ["thai_tea", {
        groupId: "sweet", defaultMemberId: "m_condensed", allowedMemberIds: [], defaultLevelId: null,
        custom: new Map(table("m_condensed", [0, 20, 40, 55])),
      }],
    ]),
    optionEffects: new Map([["extraShot", [{ kind: "slot_add", groupId: "beans", qty: 9 }]]]),
  };
}

const cat = build();
const sorted = (pairs: [string, number][]) =>
  pairs.map(([materialId, qty]) => ({ materialId, qty })).sort((a, b) => (a.materialId < b.materialId ? -1 : 1));
function ok(r: ResolvedLine | { error: string }): ResolvedLine {
  assert.ok(!("error" in r), "expected a resolved line");
  return r;
}

test("plain latte uses every default", () => {
  const r = ok(resolveLine("latte", 1, undefined, [], cat));
  assert.deepEqual(r.stock, sorted([["ice", 150], ["med", 18], ["milk", 180], ["syrup", 20]]));
  assert.equal(r.priceDeltaSatang, 0);
});

test("kenya, less sweet, milk mix, extra shot (spec 6.4 example)", () => {
  const r = ok(resolveLine("latte", 1,
    { slots: [{ groupId: "beans", memberId: "m_kenya" }], sweetness: { levelId: "less", memberId: "m_mix" } },
    ["extraShot"], cat));
  assert.deepEqual(r.stock, sorted([["ice", 150], ["kenya", 27], ["milk", 180], ["mix", 15]]));
  assert.equal(r.priceDeltaSatang, 4000);
  assert.deepEqual(r.snapshot.slots, [
    { groupId: "beans", memberId: "m_kenya", materialId: "kenya", label: "kenya", tier: "special" },
  ]);
  assert.deepEqual(r.snapshot.sweetness, { levelId: "less", levelName: "หวานน้อย", memberId: "m_mix", label: "mix" });
});

test("no sweetness takes no sweetener", () => {
  const r = ok(resolveLine("latte", 1, { sweetness: { levelId: "none", memberId: "m_mix" } }, [], cat));
  assert.deepEqual(r.stock, sorted([["ice", 150], ["med", 18], ["milk", 180]]));
  assert.equal(r.snapshot.sweetness?.memberId, null);
  assert.equal(r.snapshot.sweetness?.label, null);
});

test("quantity multiplies and aggregates", () => {
  const r = ok(resolveLine("latte", 2, undefined, ["extraShot"], cat));
  assert.equal(r.stock.find((l) => l.materialId === "med")?.qty, 54);
  assert.equal(r.stock.find((l) => l.materialId === "milk")?.qty, 360);
});

test("per-menu sweetness table wins", () => {
  const r = ok(resolveLine("thai_tea", 1, { sweetness: { levelId: "less", memberId: null } }, [], cat));
  assert.deepEqual(r.stock, sorted([["condensed", 20]]));
});

test("a special bean where the menu forbids it is stale", () => {
  const r = resolveLine("espresso_house", 1, { slots: [{ groupId: "beans", memberId: "m_kenya" }] }, [], cat);
  assert.deepEqual(r, { error: STOCK_STALE });
});

test("an unknown member or level is stale", () => {
  assert.deepEqual(
    resolveLine("latte", 1, { slots: [{ groupId: "beans", memberId: "nope" }] }, [], cat),
    { error: STOCK_STALE });
  assert.deepEqual(
    resolveLine("latte", 1, { sweetness: { levelId: "nope", memberId: null } }, [], cat),
    { error: STOCK_STALE });
  assert.deepEqual(
    resolveLine("thai_tea", 1, { sweetness: { levelId: "less", memberId: "m_mix" } }, [], cat),
    { error: STOCK_STALE });
});

test("a pre-D1 cart line (no choices) resolves with defaults", () => {
  const a = ok(resolveLine("latte", 1, undefined, [], cat));
  const b = ok(resolveLine("latte", 1, {}, [], cat));
  assert.deepEqual(a, b);
  assert.equal(a.snapshot.sweetness?.levelId, "normal");
});

test("a missing table cell counts as zero", () => {
  const c = build();
  c.standardSweetness.delete("m_syrup:more");
  const r = ok(resolveLine("latte", 1, { sweetness: { levelId: "more", memberId: null } }, [], c));
  assert.deepEqual(r.stock, sorted([["ice", 150], ["med", 18], ["milk", 180]]));
});

test("an empty group is skipped", () => {
  const c = build();
  c.groups.set("beans", { id: "beans", kind: "bean", name: "เมล็ด", members: [] });
  const r = ok(resolveLine("latte", 1, undefined, ["extraShot"], c));
  assert.deepEqual(r.stock, sorted([["ice", 150], ["milk", 180], ["syrup", 20]]));
  assert.deepEqual(r.snapshot.slots, []);
});

test("choices for a group the product has no slot for are ignored", () => {
  const r = ok(resolveLine("latte", 1, { slots: [{ groupId: "other", memberId: "x" }] }, [], cat));
  assert.deepEqual(r, ok(resolveLine("latte", 1, undefined, [], cat)));
});

test("slot_add on a product without that slot is ignored; material_add adds the material", () => {
  const c = build();
  c.optionEffects.set("cream", [{ kind: "material_add", materialId: "cream", qty: 30 }]);
  const noSlot = ok(resolveLine("thai_tea", 1, undefined, ["extraShot", "cream"], c));
  assert.deepEqual(noSlot.stock, sorted([["condensed", 40], ["cream", 30]]));
  assert.equal(noSlot.priceDeltaSatang, 0);
});

test("defaultSlotMember follows line default, flagged default, first house, none", () => {
  const g = cat.groups.get("beans")!;
  assert.equal(defaultSlotMember(g, { defaultMemberId: "m_dark" })?.id, "m_dark");
  assert.equal(defaultSlotMember(g, { defaultMemberId: "gone" })?.id, "m_med");
  assert.equal(defaultSlotMember(g, { defaultMemberId: null })?.id, "m_med");
  const noFlag: ChoiceGroup = { ...g, members: g.members.map((m) => ({ ...m, isDefault: false })).reverse() };
  assert.equal(defaultSlotMember(noFlag, { defaultMemberId: null })?.id, "m_light");
  assert.equal(defaultSlotMember({ ...g, members: [] }, { defaultMemberId: null }), null);
});

test("defaultLevel follows product default, shop default, none", () => {
  assert.equal(defaultLevel(cat.levels, { ...cat.productSweetness.get("latte")!, defaultLevelId: "more" })?.id, "more");
  assert.equal(defaultLevel(cat.levels, { ...cat.productSweetness.get("latte")!, defaultLevelId: "gone" })?.id, "normal");
  assert.equal(defaultLevel(cat.levels, undefined)?.id, "normal");
  assert.equal(defaultLevel(cat.levels.map((l) => ({ ...l, isDefault: false })), undefined), null);
});

test("cupPriceDeltaSatang: special once, plus once per matching slot_add; house adds 0", () => {
  const kenya = { groupId: "beans", tier: "special" as const, priceDelta: 20 };
  const house = { groupId: "beans", tier: "house" as const, priceDelta: 0 };
  assert.equal(cupPriceDeltaSatang([kenya], []), 2000);
  assert.equal(cupPriceDeltaSatang([kenya], ["beans"]), 4000);
  assert.equal(cupPriceDeltaSatang([kenya], ["beans", "beans"]), 6000);
  assert.equal(cupPriceDeltaSatang([kenya], ["other"]), 2000);
  assert.equal(cupPriceDeltaSatang([house], ["beans"]), 0);
});
