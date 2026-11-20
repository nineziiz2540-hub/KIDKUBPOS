import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asksFirst, lowWord, materialLabel, parseSuppressed, pausedMenus, suppressedMaterials, suppressionStorageKey,
  suppressMaterial, tileState,
} from "./pos-states.ts";
import type { Levels } from "./availability.ts";
import type { LiveStock } from "./live-stock.ts";
import type { ChoiceGroup, GroupMember, StockCatalog } from "./stock-core.ts";
import { HEARTBEAT_TIMEOUT_MS } from "../connectivity.ts";

function member(id: string, groupId: string, materialId: string, o: Partial<GroupMember> = {}): GroupMember {
  return { id, groupId, materialId, label: materialId, tier: "house", priceDelta: 0, isDefault: false, sortOrder: 0, ...o };
}

// ลาเต้: a bean slot (house คั่วอ่อน/คั่วกลาง/คั่วเข้ม + special เคนยา), milk 180 + ice 150, syrup, cup and lid.
function build(): StockCatalog {
  const beans: ChoiceGroup = {
    id: "beans", kind: "bean", name: "เมล็ด",
    members: [
      member("m_light", "beans", "light", { sortOrder: 1, label: "คั่วอ่อน" }),
      member("m_med", "beans", "med", { sortOrder: 2, isDefault: true, label: "คั่วกลาง" }),
      member("m_dark", "beans", "dark", { sortOrder: 3, label: "คั่วเข้ม" }),
      member("m_kenya", "beans", "kenya", { tier: "special", priceDelta: 20, sortOrder: 4, label: "เคนยา" }),
    ],
  };
  const sweet: ChoiceGroup = {
    id: "sweet", kind: "sweetener", name: "ความหวาน",
    members: [member("m_syrup", "sweet", "syrup", { isDefault: true, sortOrder: 1, label: "ไซรัป" })],
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

function live(levels: Levels, paused: string[] = [], at = 1000): LiveStock {
  return { levels, paused: new Set(paused), at };
}

const TODAY = "2026-11-21";

test("tileState paused beats out", () => {
  const levels = plenty();
  levels.set("milk", 0);
  assert.deepEqual(tileState("latte", build(), live(levels, ["latte"]), new Set()), { kind: "paused" });
  // a paused menu with plenty of stock is paused too
  assert.deepEqual(tileState("latte", build(), live(plenty(), ["latte"]), new Set()), { kind: "paused" });
});

test("tileState out names the limiting material", () => {
  const levels = plenty();
  levels.set("milk", 150); // less than one cup of 180 ml
  assert.deepEqual(tileState("latte", build(), live(levels), new Set()), { kind: "out", materialId: "milk" });
  const noLid = plenty();
  noLid.set("lid", 0);
  assert.deepEqual(tileState("latte", build(), live(noLid), new Set()), { kind: "out", materialId: "lid" });
});

test("tileState low gives cups left", () => {
  const levels = plenty();
  levels.set("milk", 1000); // 5 cups of 180 ml
  assert.deepEqual(tileState("latte", build(), live(levels), new Set()), { kind: "low", cupsLeft: 5 });
  assert.equal(lowWord(5), "เหลือ ~5 แก้ว");
  assert.deepEqual(tileState("latte", build(), live(plenty()), new Set()), { kind: "ok" });
  // no stock read yet: nothing is out
  assert.deepEqual(tileState("latte", build(), live(new Map()), new Set()), { kind: "ok" });
});

test("suppressed material no longer makes the tile out", () => {
  const levels = plenty();
  levels.set("milk", 150);
  const store = suppressMaterial({}, "milk", 150, TODAY);
  const suppressed = suppressedMaterials(store, levels, TODAY);
  assert.deepEqual([...suppressed], ["milk"]);
  assert.deepEqual(tileState("latte", build(), live(levels), suppressed), { kind: "ok" });
  // another material running out still shows
  levels.set("ice", 0);
  assert.deepEqual(tileState("latte", build(), live(levels), suppressed), { kind: "out", materialId: "ice" });
});

test("suppression survives sales that lower the level", () => {
  const store = suppressMaterial({}, "milk", 150, TODAY);
  assert.ok(suppressedMaterials(store, new Map([["milk", 150]]), TODAY).has("milk"));
  // two lattes later (online heartbeat or this iPad's queued bills): still silent
  assert.ok(suppressedMaterials(store, new Map([["milk", -210]]), TODAY).has("milk"));
  // a reload reads the same store back
  const back = parseSuppressed(JSON.stringify(store));
  assert.ok(suppressedMaterials(back, new Map([["milk", -210]]), TODAY).has("milk"));
});

test("a receive (level rises) ends suppression", () => {
  const store = suppressMaterial({}, "milk", 150, TODAY);
  assert.ok(suppressedMaterials(store, new Map([["milk", 150]]), TODAY).has("milk"));
  assert.equal(suppressedMaterials(store, new Map([["milk", 2150]]), TODAY).has("milk"), false);
  // the tile reads the received level: ok again, and a later "หมด?" asks again
  const levels = plenty();
  levels.set("milk", 2150);
  const suppressed = suppressedMaterials(store, levels, TODAY);
  assert.deepEqual(tileState("latte", build(), live(levels), suppressed), { kind: "ok" });
});

test("a new business day ends suppression", () => {
  const store = suppressMaterial({}, "milk", 150, TODAY);
  assert.ok(suppressedMaterials(store, new Map([["milk", 0]]), TODAY).has("milk"));
  assert.equal(suppressedMaterials(store, new Map([["milk", 0]]), "2026-11-22").has("milk"), false);
  // a new tap writes today's date and drops yesterday's entries
  const next = suppressMaterial(store, "ice", 0, "2026-11-22");
  assert.deepEqual(next, { ice: { level: 0, date: "2026-11-22" } });
});

test("a suppression store that cannot be read counts as empty", () => {
  assert.deepEqual(parseSuppressed(null), {});
  assert.deepEqual(parseSuppressed("not json"), {});
  assert.deepEqual(parseSuppressed("[1,2]"), {});
  assert.deepEqual(
    parseSuppressed(JSON.stringify({ milk: { level: 150, date: TODAY }, bad: { level: "x", date: TODAY }, odd: 3 })),
    { milk: { level: 150, date: TODAY } }
  );
  assert.equal(suppressionStorageKey("t1"), "kidkub-suppressed:t1");
});

test("tile and chip taps ask first only when out or paused", () => {
  assert.equal(asksFirst({ kind: "out", materialId: "milk" }), true);
  assert.equal(asksFirst({ kind: "paused" }), true);
  assert.equal(asksFirst({ kind: "low", cupsLeft: 3 }), false);
  assert.equal(asksFirst({ kind: "ok" }), false);
  assert.equal(asksFirst(undefined), false);
});

test("a pause shows at once and a heartbeat read before it never undoes it", () => {
  const at = 50_000;
  const overrides = { latte: { paused: true, at } };
  // the heartbeat answer that was in flight during the tap still says "not paused"
  assert.ok(pausedMenus(live(plenty(), [], at + 800), overrides).has("latte"));
  // nothing read yet on this page
  assert.ok(pausedMenus(null, overrides).has("latte"));
  // an answer surely read after the change wins (another iPad may have reopened it)
  assert.equal(pausedMenus(live(plenty(), [], at + HEARTBEAT_TIMEOUT_MS + 1), overrides).has("latte"), false);
  // a reopen hides the server's pause until then
  assert.equal(pausedMenus(live(plenty(), ["latte"], at + 100), { latte: { paused: false, at } }).has("latte"), false);
});

test("the dialog names a material by its chip word, else its stock name", () => {
  const cat = build();
  assert.equal(materialLabel("med", { med: "เมล็ดคั่วกลาง" }, cat), "คั่วกลาง");
  assert.equal(materialLabel("milk", { milk: "นมสด" }, cat), "นมสด");
  assert.equal(materialLabel("unknown", {}, cat), "วัตถุดิบ");
});
