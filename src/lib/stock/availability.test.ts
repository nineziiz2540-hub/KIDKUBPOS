import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fallbackDefaults, levelsAfter, menuAvailability, needsAvailability, suppressionKey, NEAR_OUT_CUPS,
  type Levels,
} from "./availability.ts";
import { resolveLine, type ChoiceGroup, type GroupMember, type StockCatalog } from "./stock-core.ts";

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
    members: [member("m_syrup", "sweet", "syrup", { isDefault: true, sortOrder: 1 })],
  };
  return {
    recipes: new Map([
      ["latte", [
        { kind: "slot", groupId: "beans", qty: 18, defaultMemberId: "m_med", allowSpecial: true },
        { kind: "fixed", materialId: "milk", qty: 180 },
        { kind: "fixed", materialId: "ice", qty: 150 },
      ]],
    ]),
    groups: new Map([["beans", beans], ["sweet", sweet]]),
    levels: [{ id: "normal", name: "หวานปกติ", isNone: false, isDefault: true, sortOrder: 1 }],
    standardSweetness: new Map([["m_syrup:normal", 20]]),
    productSweetness: new Map([
      ["latte", { groupId: "sweet", defaultMemberId: "m_syrup", allowedMemberIds: [], defaultLevelId: null, custom: null }],
    ]),
    optionEffects: new Map(),
    packaging: new Map([["latte", { setId: "set16", houseGlassDefault: false }]]),
    packagingSets: new Map([["set16", { name: "แก้ว 16", items: [{ materialId: "cup16", qty: 1 }, { materialId: "lid", qty: 1 }] }]]),
  };
}

const plenty = (): Levels => new Map([
  ["light", 5000], ["med", 5000], ["dark", 5000], ["kenya", 5000], ["milk", 50000], ["ice", 50000],
  ["syrup", 50000], ["cup16", 500], ["lid", 500],
]);

test("menu ok when every material covers more than 10 cups", () => {
  const a = menuAvailability("latte", build(), plenty());
  assert.equal(a.state, "ok");
  assert.ok((a.cupsLeft ?? 0) > NEAR_OUT_CUPS);
});

test("menu low shows cups left from the scarcest material", () => {
  const levels = plenty();
  levels.set("milk", 1000);
  assert.deepEqual(menuAvailability("latte", build(), levels), { state: "low", cupsLeft: 5, limitingMaterialId: "milk" });
});

test("menu out under one cup", () => {
  const levels = plenty();
  levels.set("milk", 150);
  const a = menuAvailability("latte", build(), levels);
  assert.equal(a.state, "out");
  assert.equal(a.cupsLeft, 0);
});

test("negative level counts as zero", () => {
  const levels = plenty();
  levels.set("milk", -40);
  const a = menuAvailability("latte", build(), levels);
  assert.equal(a.state, "out");
  assert.equal(a.cupsLeft, 0);
});

test("untracked material never limits", () => {
  const levels = plenty();
  levels.delete("ice");
  assert.equal(menuAvailability("latte", build(), levels).state, "ok");
  assert.deepEqual(menuAvailability("latte", build(), new Map()), { state: "ok", cupsLeft: null, limitingMaterialId: null });
});

test("missing level is ignored, never out", () => {
  const levels = plenty();
  levels.delete("milk");
  const a = menuAvailability("latte", build(), levels);
  assert.equal(a.state, "ok");
  assert.notEqual(a.limitingMaterialId, "milk");
});

test("packaging set item can make the menu out", () => {
  const levels = plenty();
  levels.set("cup16", 0);
  const a = menuAvailability("latte", build(), levels);
  assert.equal(a.state, "out");
  assert.equal(a.limitingMaterialId, "cup16");
});

test("house group: menu out only when all house members are out", () => {
  const levels = plenty();
  levels.set("med", 0);
  levels.set("light", 0);
  assert.equal(menuAvailability("latte", build(), levels).state, "ok");
  levels.set("dark", 0);
  const a = menuAvailability("latte", build(), levels);
  assert.equal(a.state, "out");
  assert.equal(a.cupsLeft, 0);
  assert.ok(["light", "med", "dark"].includes(a.limitingMaterialId ?? ""));
});

test("special out does not make the menu out", () => {
  const levels = plenty();
  levels.set("kenya", 0);
  assert.equal(menuAvailability("latte", build(), levels).state, "ok");
});

test("sweetener out does not make the menu out", () => {
  const levels = plenty();
  levels.set("syrup", 0);
  assert.notEqual(menuAvailability("latte", build(), levels).state, "out");
});

test("fallback default skips an out house default to the next house member", () => {
  const levels = plenty();
  levels.set("med", 0);
  assert.deepEqual(fallbackDefaults("latte", build(), levels, () => false), { beans: "m_light" });
  levels.set("light", 0);
  assert.deepEqual(fallbackDefaults("latte", build(), levels, () => false), { beans: "m_dark" });
});

test("fallback keeps the default when it is suppressed", () => {
  const levels = plenty();
  levels.set("med", 0);
  assert.deepEqual(fallbackDefaults("latte", build(), levels, (id) => id === "med"), { beans: "m_med" });
});

test("fallback keeps the default when every house member is out", () => {
  const levels = plenty();
  for (const id of ["light", "med", "dark"]) levels.set(id, 0);
  assert.deepEqual(fallbackDefaults("latte", build(), levels, () => false), { beans: "m_med" });
});

test("levelsAfter subtracts queued bills", () => {
  const cat = build();
  const line = resolveLine("latte", 1, undefined, [], cat);
  assert.ok(!("error" in line));
  const after = levelsAfter(new Map([["milk", 1000]]), [line.stock, line.stock]);
  assert.equal(after.get("milk"), 640);
  assert.equal(after.has("ice"), false);
});

test("suppression ends when the level changes", () => {
  assert.notEqual(suppressionKey("milk", 150), suppressionKey("milk", 2150));
});

test("needsAvailability uses the scarcest need", () => {
  const a = needsAvailability([{ materialId: "a", qty: 10 }, { materialId: "b", qty: 1 }], new Map([["a", 55], ["b", 500]]));
  assert.deepEqual(a, { state: "low", cupsLeft: 5, limitingMaterialId: "a" });
});
