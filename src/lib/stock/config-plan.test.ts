import { test } from "node:test";
import assert from "node:assert/strict";
import {
  missingSeedGroups, missingSeedLevels, planDefaultSwitch, moveId, parseAmountText,
  buildGrid, gridToCells, gridKey, tierWord,
} from "./config-plan.ts";

test("missingSeedGroups: empty shop gets all three; second press gets none", () => {
  const first = missingSeedGroups([]);
  assert.deepEqual(first.map((g) => g.kind), ["bean", "matcha", "sweetener"]);
  assert.deepEqual(first.map((g) => g.name), ["เมล็ด", "มัทฉะ", "ความหวาน"]);
  const again = missingSeedGroups(first.map((g) => ({ kind: g.kind, sort_order: g.sortOrder })));
  assert.deepEqual(again, []);
});

test("missingSeedGroups: only the missing kind is created, after the existing order", () => {
  const out = missingSeedGroups([{ kind: "bean", sort_order: 4 }]);
  assert.deepEqual(out.map((g) => g.kind), ["matcha", "sweetener"]);
  assert.deepEqual(out.map((g) => g.sortOrder), [5, 6]);
});

test("missingSeedLevels: empty shop gets the four levels, หวานปกติ default, ไม่หวาน none", () => {
  const out = missingSeedLevels([]);
  assert.deepEqual(out.map((l) => l.name), ["ไม่หวาน", "หวานน้อย", "หวานปกติ", "หวานมาก"]);
  assert.deepEqual(out.map((l) => l.isNone), [true, false, false, false]);
  assert.deepEqual(out.map((l) => l.isDefault), [false, false, true, false]);
  assert.deepEqual(out.map((l) => l.sortOrder), [0, 1, 2, 3]);
});

test("missingSeedLevels: idempotent, names compared trimmed + case-insensitive", () => {
  const first = missingSeedLevels([]);
  const existing = first.map((l) => ({ name: ` ${l.name} `, is_none: l.isNone, is_default: l.isDefault, sort_order: l.sortOrder }));
  assert.deepEqual(missingSeedLevels(existing), []);
});

test("missingSeedLevels: never a second default or second ไม่หวาน", () => {
  const out = missingSeedLevels([
    { name: "ศูนย์", is_none: true, is_default: true, sort_order: 0 },
  ]);
  assert.deepEqual(out.map((l) => l.name), ["หวานน้อย", "หวานปกติ", "หวานมาก"]);
  assert.ok(out.every((l) => !l.isDefault && !l.isNone));
  assert.deepEqual(out.map((l) => l.sortOrder), [1, 2, 3]);
});

test("planDefaultSwitch: clears the old default first, then sets the new one", () => {
  const items = [{ id: "a", isDefault: true }, { id: "b", isDefault: false }];
  assert.deepEqual(planDefaultSwitch(items, "b"), { clearIds: ["a"], setId: "b" });
});

test("planDefaultSwitch: already the only default → nothing to do; unknown id → null", () => {
  const items = [{ id: "a", isDefault: true }, { id: "b", isDefault: false }];
  assert.deepEqual(planDefaultSwitch(items, "a"), { clearIds: [], setId: null });
  assert.equal(planDefaultSwitch(items, "zzz"), null);
});

test("moveId: swaps with neighbour, no-op at the edges", () => {
  assert.deepEqual(moveId(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveId(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
  assert.deepEqual(moveId(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
  assert.deepEqual(moveId(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
  assert.deepEqual(moveId(["a", "b"], "x", 1), ["a", "b"]);
});

test("parseAmountText: accepts 0..10,000 with up to 3 decimals", () => {
  assert.deepEqual(parseAmountText("0"), { value: 0 });
  assert.deepEqual(parseAmountText(" 35 "), { value: 35 });
  assert.deepEqual(parseAmountText("12.125"), { value: 12.125 });
  assert.deepEqual(parseAmountText("10000"), { value: 10000 });
});

test("parseAmountText: rejects blank, negative, too many decimals, too big, junk", () => {
  for (const bad of ["", "  ", "-1", "1.2345", "10000.001", "10001", "abc", "1e3", "1,5"]) {
    const r = parseAmountText(bad);
    assert.ok("error" in r, `expected error for "${bad}"`);
  }
});

const members = [{ id: "syrup" }, { id: "cond" }];
const levels = [
  { id: "n", isNone: true }, { id: "l", isNone: false }, { id: "r", isNone: false }, { id: "m", isNone: false },
];

test("buildGrid: fills from saved rows; none column fixed 0; missing cell blank", () => {
  const grid = buildGrid(members, levels, [
    { member_id: "syrup", level_id: "l", amount: 10 },
    { member_id: "syrup", level_id: "r", amount: 20 },
    { member_id: "syrup", level_id: "m", amount: 35.5 },
  ]);
  assert.equal(grid[gridKey("syrup", "n")], "0");
  assert.equal(grid[gridKey("syrup", "l")], "10");
  assert.equal(grid[gridKey("syrup", "m")], "35.5");
  assert.equal(grid[gridKey("cond", "l")], "");
  assert.equal(grid[gridKey("cond", "n")], "0");
});

test("gridToCells: the owner's example 0/10/20/35 maps to rows", () => {
  const grid = buildGrid(members, levels, []);
  grid[gridKey("syrup", "l")] = "10";
  grid[gridKey("syrup", "r")] = "20";
  grid[gridKey("syrup", "m")] = "35";
  for (const lv of ["l", "r", "m"]) grid[gridKey("cond", lv)] = "0";
  const out = gridToCells(members, levels, grid);
  assert.ok("cells" in out);
  if ("cells" in out) {
    assert.equal(out.cells.length, 8);
    const s = out.cells.filter((c) => c.memberId === "syrup").map((c) => c.amount);
    assert.deepEqual(s, [0, 10, 20, 35]);
  }
});

test("gridToCells: blank or invalid cell stops with an error naming nothing silently", () => {
  const grid = buildGrid(members, levels, []);
  const out = gridToCells(members, levels, grid);
  assert.ok("error" in out);
  grid[gridKey("syrup", "l")] = "-3";
  assert.ok("error" in gridToCells(members, levels, grid));
});

test("gridToCells: a tampered ไม่หวาน cell is ignored and written as 0", () => {
  const grid = buildGrid(members, levels, []);
  for (const m of members) for (const lv of ["l", "r", "m"]) grid[gridKey(m.id, lv)] = "1";
  grid[gridKey("syrup", "n")] = "99";
  const out = gridToCells(members, levels, grid);
  assert.ok("cells" in out);
  if ("cells" in out) assert.equal(out.cells.find((c) => c.memberId === "syrup" && c.levelId === "n")!.amount, 0);
});

test("tierWord: house/special words per group kind", () => {
  assert.equal(tierWord("bean", "house"), "เมล็ดร้าน");
  assert.equal(tierWord("bean", "special"), "เมล็ดพิเศษ");
  assert.equal(tierWord("matcha", "house"), "มัทฉะร้าน");
  assert.equal(tierWord("matcha", "special"), "มัทฉะพิเศษ");
});
