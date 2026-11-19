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

test("kenya, less sweet, milk mix, extra shot (spec 6.4 example): the shot uses the menu's house bean", () => {
  const r = ok(resolveLine("latte", 1,
    { slots: [{ groupId: "beans", memberId: "m_kenya" }], sweetness: { levelId: "less", memberId: "m_mix" } },
    ["extraShot"], cat));
  assert.deepEqual(r.stock, sorted([["ice", 150], ["kenya", 18], ["med", 9], ["milk", 180], ["mix", 15]]));
  assert.equal(r.priceDeltaSatang, 2000);
  assert.deepEqual(r.snapshot.slots, [
    {
      groupId: "beans", memberId: "m_kenya", materialId: "kenya", label: "kenya", tier: "special", priceDelta: 20,
      shot: { memberId: "m_med", materialId: "med", label: "med", optionIds: ["extraShot"] },
    },
  ]);
  assert.deepEqual(r.snapshot.slotAddGroupIds, ["beans"]);
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

test("an unknown member or level falls back to the defaults", () => {
  const plain = ok(resolveLine("latte", 1, undefined, [], cat));
  const r = ok(resolveLine("latte", 1, {
    slots: [{ groupId: "beans", memberId: "nope" }], sweetness: { levelId: "nope", memberId: null },
  }, [], cat));
  assert.deepEqual(r.stock, plain.stock);
  assert.equal(r.priceDeltaSatang, 0);
});

test("a sweetener member that is not allowed for the menu falls back to its default, never stale", () => {
  const r = ok(resolveLine("thai_tea", 1, { sweetness: { levelId: "less", memberId: "m_mix" } }, [], cat));
  assert.equal(r.snapshot.sweetness?.memberId, "m_condensed");
  assert.deepEqual(r.stock, sorted([["condensed", 20]]));
});

test("a vanished sweetener member or group skips the sweetener, never refuses", () => {
  const noMember = build();
  noMember.groups.get("sweet")!.members = noMember.groups.get("sweet")!.members.filter((m) => m.id !== "m_syrup");
  const a = ok(resolveLine("latte", 1, undefined, [], noMember));
  assert.deepEqual(a.stock, sorted([["ice", 150], ["med", 18], ["milk", 180]]));
  assert.deepEqual(a.snapshot.sweetness, { levelId: "normal", levelName: "หวานปกติ", memberId: "m_syrup", label: null });
  const noGroup = build();
  noGroup.groups.delete("sweet");
  const b = ok(resolveLine("latte", 1, undefined, [], noGroup));
  assert.deepEqual(b.stock, sorted([["ice", 150], ["med", 18], ["milk", 180]]));
});

test("a no-special menu never defaults to a special bean", () => {
  const c = build();
  const g = c.groups.get("beans")!;
  g.members = g.members.map((m) => ({ ...m, isDefault: m.id === "m_kenya" }));
  c.recipes.set("espresso_house", [
    { kind: "slot", groupId: "beans", qty: 18, defaultMemberId: "m_kenya", allowSpecial: false },
  ]);
  const r = ok(resolveLine("espresso_house", 1, undefined, [], c));
  assert.deepEqual(r.stock, sorted([["light", 18]]));
  assert.equal(r.priceDeltaSatang, 0);
  assert.equal(defaultSlotMember(g, { defaultMemberId: "m_kenya", allowSpecial: false })?.id, "m_light");
});

test("a no-special menu accepts a chosen house bean", () => {
  const r = ok(resolveLine("espresso_house", 1, { slots: [{ groupId: "beans", memberId: "m_dark" }] }, [], cat));
  assert.deepEqual(r.stock, sorted([["dark", 18]]));
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

test("cupPriceDeltaSatang: each special once, twice when doubled; house adds 0 even when doubled", () => {
  const kenya = { tier: "special" as const, priceDelta: 20 };
  const house = { tier: "house" as const, priceDelta: 0 };
  assert.equal(cupPriceDeltaSatang([kenya]), 2000);
  assert.equal(cupPriceDeltaSatang([{ ...kenya, count: 2 }]), 4000);
  assert.equal(cupPriceDeltaSatang([{ ...kenya, count: 1 }]), 2000);
  assert.equal(cupPriceDeltaSatang([{ ...kenya, count: 3 }]), 2000);
  assert.equal(cupPriceDeltaSatang([house, { ...house, count: 2 }]), 0);
  assert.equal(cupPriceDeltaSatang([kenya, { tier: "special", priceDelta: 12.5, count: 2 }]), 4500);
  assert.equal(cupPriceDeltaSatang([]), 0);
});

// ---- extra shot uses a house bean; a special can be doubled (owner 2026-11-19) ----

/** The test catalog with Thai labels, the shot at 18 g, and a matcha group without a house member. */
function shotCat(): StockCatalog {
  const c = build();
  const labels: Record<string, string> = { m_light: "คั่วอ่อน", m_med: "คั่วกลาง", m_dark: "คั่วเข้ม", m_kenya: "เคนยา" };
  const beans = c.groups.get("beans")!;
  beans.members = [
    ...beans.members.map((m) => ({ ...m, label: labels[m.id] ?? m.label })),
    member("m_eth", "beans", "eth", { label: "เอธิโอเปีย", tier: "special", priceDelta: 30, sortOrder: 5 }),
  ];
  c.optionEffects.set("extraShot", [{ kind: "slot_add", groupId: "beans", qty: 18 }]);
  c.groups.set("gyokuro", {
    id: "gyokuro", kind: "matcha", name: "มัทฉะ",
    members: [member("t_cer", "gyokuro", "ceremony", { label: "Ceremonial", tier: "special", priceDelta: 40, sortOrder: 1 })],
  });
  c.recipes.set("special_only", [{ kind: "slot", groupId: "gyokuro", qty: 4, defaultMemberId: "t_cer", allowSpecial: true }]);
  c.optionEffects.set("matchaShot", [{ kind: "slot_add", groupId: "gyokuro", qty: 4 }]);
  return c;
}
const kenyaPick = (o: { count?: number; shotMemberId?: string } = {}) => ({ slots: [{ groupId: "beans", memberId: "m_kenya", ...o }] });
const beanStock = (r: ResolvedLine) => r.stock.filter((l) => !["ice", "milk", "syrup"].includes(l.materialId));

test("Kenya + shot with a house pick: the shot uses คั่วเข้ม, only the cup pays the specialty", () => {
  const r = ok(resolveLine("latte", 1, kenyaPick({ shotMemberId: "m_dark" }), ["extraShot"], shotCat()));
  assert.equal(r.priceDeltaSatang, 2000);
  assert.deepEqual(beanStock(r), sorted([["dark", 18], ["kenya", 18]]));
  assert.deepEqual(r.snapshot.slots[0]!.shot, { memberId: "m_dark", materialId: "dark", label: "คั่วเข้ม", optionIds: ["extraShot"] });
  assert.equal("count" in r.snapshot.slots[0]!, false);
  assert.deepEqual(r.snapshot.slotAddGroupIds, ["beans"]);
});

test("Kenya + shot with no shot pick: the shot uses the line's house default (คั่วกลาง)", () => {
  const r = ok(resolveLine("latte", 1, kenyaPick(), ["extraShot"], shotCat()));
  assert.equal(r.priceDeltaSatang, 2000);
  assert.deepEqual(beanStock(r), sorted([["kenya", 18], ["med", 18]]));
  assert.equal(r.snapshot.slots[0]!.shot?.label, "คั่วกลาง");
  // the line's own default wins over the group's flagged default
  const c = shotCat();
  c.recipes.set("latte", [{ kind: "slot", groupId: "beans", qty: 18, defaultMemberId: "m_light", allowSpecial: true }]);
  assert.equal(ok(resolveLine("latte", 1, kenyaPick(), ["extraShot"], c)).snapshot.slots[0]!.shot?.memberId, "m_light");
  // a menu whose own default is a special: the shot still uses a house bean
  c.recipes.set("latte", [{ kind: "slot", groupId: "beans", qty: 18, defaultMemberId: "m_kenya", allowSpecial: true }]);
  const own = ok(resolveLine("latte", 1, undefined, ["extraShot"], c));
  assert.equal(own.snapshot.slots[0]!.memberId, "m_kenya");
  assert.equal(own.snapshot.slots[0]!.shot?.memberId, "m_med");
  assert.equal(own.priceDeltaSatang, 2000);
});

test("Kenya + shot whose shot pick is a special or unknown member: the house default, never a special", () => {
  for (const shotMemberId of ["m_eth", "m_kenya", "nope"]) {
    const r = ok(resolveLine("latte", 1, kenyaPick({ shotMemberId }), ["extraShot"], shotCat()));
    assert.equal(r.priceDeltaSatang, 2000, shotMemberId);
    assert.deepEqual(beanStock(r), sorted([["kenya", 18], ["med", 18]]), shotMemberId);
    assert.equal(r.snapshot.slots[0]!.shot?.memberId, "m_med", shotMemberId);
  }
});

test("Kenya ×2: two doses and the specialty twice; with a shot 36 + 18 house; a house ×2 is ×1", () => {
  const two = ok(resolveLine("latte", 1, kenyaPick({ count: 2 }), [], shotCat()));
  assert.deepEqual(beanStock(two), sorted([["kenya", 36]]));
  assert.equal(two.priceDeltaSatang, 4000);
  assert.equal(two.snapshot.slots[0]!.count, 2);
  assert.equal("shot" in two.snapshot.slots[0]!, false);

  const twoShot = ok(resolveLine("latte", 1, kenyaPick({ count: 2, shotMemberId: "m_dark" }), ["extraShot"], shotCat()));
  assert.deepEqual(beanStock(twoShot), sorted([["dark", 18], ["kenya", 36]]));
  assert.equal(twoShot.priceDeltaSatang, 4000);
  assert.equal(twoShot.snapshot.slots[0]!.count, 2);
  assert.equal(twoShot.snapshot.slots[0]!.shot?.memberId, "m_dark");

  // quantity multiplies the doubled dose too
  assert.deepEqual(beanStock(ok(resolveLine("latte", 3, kenyaPick({ count: 2 }), [], shotCat()))), sorted([["kenya", 108]]));

  const house = ok(resolveLine("latte", 1, { slots: [{ groupId: "beans", memberId: "m_dark", count: 2 }] }, [], shotCat()));
  assert.deepEqual(beanStock(house), sorted([["dark", 18]]));
  assert.equal(house.priceDeltaSatang, 0);
  assert.deepEqual(house.snapshot.slots, [
    { groupId: "beans", memberId: "m_dark", materialId: "dark", label: "คั่วเข้ม", tier: "house", priceDelta: 0 },
  ]);
  // count 1 (or anything but 2) is a single dose with no count key
  const one = ok(resolveLine("latte", 1, kenyaPick({ count: 1 }), [], shotCat()));
  assert.equal(one.priceDeltaSatang, 2000);
  assert.equal("count" in one.snapshot.slots[0]!, false);
});

test("a house cup + shot uses the same member, no shot key (today's behaviour)", () => {
  const r = ok(resolveLine("latte", 1, { slots: [{ groupId: "beans", memberId: "m_dark", shotMemberId: "m_light" }] }, ["extraShot"], shotCat()));
  assert.deepEqual(beanStock(r), sorted([["dark", 36]]));
  assert.equal(r.priceDeltaSatang, 0);
  assert.deepEqual(r.snapshot.slots, [
    { groupId: "beans", memberId: "m_dark", materialId: "dark", label: "คั่วเข้ม", tier: "house", priceDelta: 0 },
  ]);
  assert.deepEqual(r.snapshot.slotAddGroupIds, ["beans"]);
});

test("a group with no house member: special + shot deducts the special itself, no surcharge", () => {
  const r = ok(resolveLine("special_only", 1, { slots: [{ groupId: "gyokuro", memberId: "t_cer", shotMemberId: "t_cer" }] }, ["matchaShot"], shotCat()));
  assert.deepEqual(r.stock, [{ materialId: "ceremony", qty: 8 }]);
  assert.equal(r.priceDeltaSatang, 4000);
  assert.deepEqual(r.snapshot.slots[0]!.shot, { memberId: "t_cer", materialId: "ceremony", label: "Ceremonial", optionIds: ["matchaShot"] });
});

test("shot optionIds: every shot-adding option on the group, in option order, once each", () => {
  const c = shotCat();
  c.optionEffects.set("doubleShot", [
    { kind: "slot_add", groupId: "beans", qty: 18 },
    { kind: "slot_add", groupId: "beans", qty: 9 },
  ]);
  const r = ok(resolveLine("latte", 1, kenyaPick({ shotMemberId: "m_light" }), ["doubleShot", "extraShot"], c));
  assert.deepEqual(r.snapshot.slots[0]!.shot?.optionIds, ["doubleShot", "extraShot"]);
  assert.deepEqual(beanStock(r), sorted([["kenya", 18], ["light", 45]]));
  assert.equal(r.priceDeltaSatang, 2000);
  assert.deepEqual(r.snapshot.slotAddGroupIds, ["beans", "beans", "beans"]);
});

test("one option adding to two groups: each special slot gets its own shot listing that option", () => {
  const c = shotCat();
  c.recipes.set("dirty_matcha", [
    { kind: "slot", groupId: "beans", qty: 18, defaultMemberId: "m_med", allowSpecial: true },
    { kind: "slot", groupId: "gyokuro", qty: 4, defaultMemberId: "t_cer", allowSpecial: true },
  ]);
  c.optionEffects.set("both", [
    { kind: "slot_add", groupId: "beans", qty: 18 },
    { kind: "slot_add", groupId: "gyokuro", qty: 4 },
  ]);
  const r = ok(resolveLine("dirty_matcha", 1, kenyaPick(), ["both"], c));
  assert.deepEqual(r.snapshot.slots.map((s) => s.shot), [
    { memberId: "m_med", materialId: "med", label: "คั่วกลาง", optionIds: ["both"] },
    { memberId: "t_cer", materialId: "ceremony", label: "Ceremonial", optionIds: ["both"] },
  ]);
  assert.equal(r.priceDeltaSatang, 2000 + 4000);
});
