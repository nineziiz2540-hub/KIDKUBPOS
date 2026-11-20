import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultChoices, isDefaultChoice } from "./pos-choices.ts";
import { resolveLine, type ChoiceGroup, type GroupMember, type LineChoices, type StockCatalog } from "./stock-core.ts";
import type { CartChoices } from "../../types/app.ts";

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
  // a group whose flagged default is a special member
  const beans2: ChoiceGroup = {
    id: "beans2", kind: "bean", name: "เมล็ดพิเศษ",
    members: [
      member("n_house", "beans2", "nhouse", { sortOrder: 1 }),
      member("n_kenya", "beans2", "nkenya", { tier: "special", priceDelta: 20, sortOrder: 2, isDefault: true }),
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
  const sw = (defaultLevelId: string | null) =>
    ({ groupId: "sweet", defaultMemberId: "m_syrup", allowedMemberIds: ["m_condensed", "m_mix"], defaultLevelId, custom: null });
  return {
    recipes: new Map([
      ["latte", [
        { kind: "slot", groupId: "beans", qty: 18, defaultMemberId: "m_med", allowSpecial: true },
        { kind: "fixed", materialId: "milk", qty: 180 },
      ]],
      ["americano", [{ kind: "slot", groupId: "beans", qty: 18, defaultMemberId: "m_dark", allowSpecial: true }]],
      ["house_only", [{ kind: "slot", groupId: "beans2", qty: 18, defaultMemberId: null, allowSpecial: false }]],
      ["special_default", [{ kind: "slot", groupId: "beans2", qty: 18, defaultMemberId: null, allowSpecial: true }]],
      ["dup", [
        { kind: "slot", groupId: "beans", qty: 9, defaultMemberId: "m_light", allowSpecial: true },
        { kind: "slot", groupId: "beans", qty: 9, defaultMemberId: "m_dark", allowSpecial: true },
      ]],
      ["gone_group", [{ kind: "slot", groupId: "nope", qty: 9, defaultMemberId: null, allowSpecial: true }]],
      ["no_sweet", [{ kind: "slot", groupId: "beans", qty: 18, defaultMemberId: "m_med", allowSpecial: true }]],
      ["unsweet", []],
      ["orphan_member", []],
    ]),
    groups: new Map([["beans", beans], ["beans2", beans2], ["sweet", sweet]]),
    levels: [
      { id: "none", name: "ไม่หวาน", isNone: true, isDefault: false, sortOrder: 1 },
      { id: "less", name: "หวานน้อย", isNone: false, isDefault: false, sortOrder: 2 },
      { id: "normal", name: "หวานปกติ", isNone: false, isDefault: true, sortOrder: 3 },
      { id: "more", name: "หวานมาก", isNone: false, isDefault: false, sortOrder: 4 },
    ],
    standardSweetness: new Map([
      ...table("m_syrup", [0, 10, 20, 35]), ...table("m_condensed", [0, 15, 30, 45]), ...table("m_mix", [0, 15, 30, 45]),
    ]),
    productSweetness: new Map([
      ["latte", sw(null)],
      ["americano", sw(null)],
      ["house_only", sw("less")],
      ["special_default", sw(null)],
      ["dup", sw(null)],
      ["unsweet", sw("none")],
      ["orphan_member", { groupId: "sweet", defaultMemberId: "m_gone", allowedMemberIds: [], defaultLevelId: null, custom: null }],
    ]),
    optionEffects: new Map(), packaging: new Map(), packagingSets: new Map(),
  };
}

const catalog = build();
const toIds = (c: CartChoices): LineChoices => ({
  slots: c.slots.map((s) => ({ groupId: s.groupId, memberId: s.memberId })),
  sweetness: c.sweetness ? { levelId: c.sweetness.levelId, memberId: c.sweetness.memberId } : null,
});

test("plain latte: medium beans (house) and normal sweetness with syrup", () => {
  const d = defaultChoices("latte", catalog);
  assert.deepEqual(d.slots, [{ groupId: "beans", memberId: "m_med", label: "med", tier: "house", priceDelta: 0 }]);
  assert.deepEqual(d.slotAddGroupIds, []);
  assert.deepEqual(d.sweetness, { levelId: "normal", levelName: "หวานปกติ", memberId: "m_syrup", memberLabel: "syrup" });
});

test("the menu's own default beats the group default", () => {
  assert.equal(defaultChoices("americano", catalog).slots[0]!.memberId, "m_dark");
});

test("allowSpecial false with a special group default falls back to the first house member", () => {
  const d = defaultChoices("house_only", catalog);
  assert.equal(d.slots[0]!.memberId, "n_house");
  assert.equal(d.slots[0]!.tier, "house");
});

test("product default level 'none' clears the sweetener", () => {
  assert.deepEqual(defaultChoices("unsweet", catalog).sweetness, { levelId: "none", levelName: "ไม่หวาน", memberId: null, memberLabel: null });
});

test("no sweetness config -> null; no recipe -> empty choices", () => {
  assert.equal(defaultChoices("no_sweet", catalog).sweetness, null);
  assert.deepEqual(defaultChoices("missing", catalog), { slots: [], slotAddGroupIds: [], sweetness: null });
});

test("one entry per group (first line wins); a vanished group is skipped; a gone sweetener member keeps its id with a null label", () => {
  assert.deepEqual(defaultChoices("dup", catalog).slots.map((s) => s.memberId), ["m_light"]);
  assert.deepEqual(defaultChoices("gone_group", catalog).slots, []);
  assert.deepEqual(defaultChoices("orphan_member", catalog).sweetness,
    { levelId: "normal", levelName: "หวานปกติ", memberId: "m_gone", memberLabel: null });
});

test("a special default on an allowSpecial line carries priceDelta 20", () => {
  const d = defaultChoices("special_default", catalog);
  assert.equal(d.slots[0]!.memberId, "n_kenya");
  assert.equal(d.slots[0]!.priceDelta, 20);
});

test("INVARIANT: sending the defaults as ids equals sending nothing (snapshot and price)", () => {
  // "dup" (one group on two lines with different defaults) is excluded: the server applies one chosen id to
  // both lines, so no single id can reproduce per-line defaults. Config validation should forbid it.
  for (const p of [...catalog.recipes.keys(), "missing"].filter((k) => k !== "dup")) {
    const withIds = resolveLine(p, 1, toIds(defaultChoices(p, catalog)), [], catalog);
    const none = resolveLine(p, 1, undefined, [], catalog);
    assert.deepEqual(withIds, none, p);
  }
  const sp = resolveLine("special_default", 1, undefined, [], catalog);
  assert.ok(!("error" in sp) && sp.priceDeltaSatang === 2000);
});

test("isDefaultChoice", () => {
  const d = defaultChoices("latte", catalog);
  assert.equal(isDefaultChoice(d, { kind: "slot", groupId: "beans", memberId: "m_med" }), true);
  assert.equal(isDefaultChoice(d, { kind: "slot", groupId: "beans", memberId: "m_dark" }), false);
  assert.equal(isDefaultChoice(d, { kind: "slot", groupId: "other", memberId: "m_med" }), false);
  assert.equal(isDefaultChoice(d, { kind: "level", levelId: "normal" }), true);
  assert.equal(isDefaultChoice(d, { kind: "level", levelId: "less" }), false);
  assert.equal(isDefaultChoice(d, { kind: "sweetener", memberId: "m_syrup" }), true);
  assert.equal(isDefaultChoice(d, { kind: "sweetener", memberId: "m_mix" }), false);
  const noSweet = defaultChoices("no_sweet", catalog);
  assert.equal(isDefaultChoice(noSweet, { kind: "level", levelId: "normal" }), false);
  assert.equal(isDefaultChoice(noSweet, { kind: "sweetener", memberId: null }), false);
});

test("isDefaultChoice: a doubled slot is never the default, even on the default member", () => {
  const d = defaultChoices("latte", catalog);
  assert.equal(isDefaultChoice(d, { kind: "slot", groupId: "beans", memberId: "m_med", count: 1 }), true);
  assert.equal(isDefaultChoice(d, { kind: "slot", groupId: "beans", memberId: "m_med", count: 2 }), false);
  const sp = defaultChoices("special_default", catalog);
  const own = sp.slots[0]!;
  assert.equal(isDefaultChoice(sp, { kind: "slot", groupId: own.groupId, memberId: own.memberId }), true);
  assert.equal(isDefaultChoice(sp, { kind: "slot", groupId: own.groupId, memberId: own.memberId, count: 2 }), false);
});
