import { test } from "node:test";
import assert from "node:assert/strict";
import {
  levelsFromRecord, mergeLiveStock, parseStockAnswer, queuedStockLines, effectiveLevels,
  liveStockFromStored, liveStockToStored, type LiveStock,
} from "./live-stock.ts";
import { emptyStockCatalog, type StockCatalog } from "./stock-core.ts";
import type { OutboxEntry, OutboxState } from "../offline/outbox-rules.ts";
import type { CartItem } from "../../types/app.ts";

const live = (at: number, levels: [string, number][], paused: string[]): LiveStock => ({
  at, levels: new Map(levels), paused: new Set(paused),
});

test("mergeLiveStock: the newer answer replaces levels and paused", () => {
  const prev = live(100, [["milk", 1000], ["ice", 500]], ["a", "b"]);
  const next = mergeLiveStock(prev, { levels: { milk: 640 }, paused: ["c"] }, 200);
  assert.equal(next.at, 200);
  assert.deepEqual([...next.levels], [["milk", 640]]); // replaced, not merged: ice is gone
  assert.deepEqual([...next.paused], ["c"]); // the paused set is replaced
});

test("mergeLiveStock: an older (or same-time) answer is ignored", () => {
  const prev = live(200, [["milk", 1000]], ["a"]);
  assert.equal(mergeLiveStock(prev, { levels: { milk: 1 }, paused: [] }, 100), prev);
  assert.equal(mergeLiveStock(prev, { levels: { milk: 1 }, paused: [] }, 200), prev);
});

test("mergeLiveStock: an empty paused list un-pauses everything", () => {
  const prev = live(100, [], ["a", "b"]);
  assert.equal(mergeLiveStock(prev, { levels: {}, paused: [] }, 101).paused.size, 0);
});

test("levels from an answer or the device are coerced with Number and non-finite values are dropped", () => {
  const levels = levelsFromRecord({ ok: 5, str: "7.5" as unknown as number, nan: NaN, inf: Infinity, ninf: -Infinity, junk: "x" as unknown as number, nul: null as unknown as number });
  assert.deepEqual([...levels].sort(), [["ok", 5], ["str", 7.5]].sort());
  const merged = mergeLiveStock(live(1, [], []), { levels: { a: NaN, b: 2 }, paused: [] }, 2);
  assert.deepEqual([...merged.levels], [["b", 2]]);
});

test("parseStockAnswer: absent or malformed stock is undefined; good stock is coerced", () => {
  assert.equal(parseStockAnswer({}), undefined);
  assert.equal(parseStockAnswer({ stock: null }), undefined);
  assert.equal(parseStockAnswer({ stock: { levels: [], paused: [] } }), undefined);
  assert.equal(parseStockAnswer({ stock: { levels: {}, paused: "x" } }), undefined);
  assert.deepEqual(parseStockAnswer({ stock: { levels: { m: 3, bad: NaN }, paused: ["p", 4] } }), {
    levels: { m: 3 }, paused: ["p"],
  });
  // JSON turns NaN into null; that is dropped too
  assert.deepEqual(parseStockAnswer({ stock: { levels: { m: null, n: 2 }, paused: [] } }), { levels: { n: 2 }, paused: [] });
});

test("the stored form round-trips and survives garbage", () => {
  const l = live(5, [["m", 2]], ["p"]);
  const back = liveStockFromStored(liveStockToStored(l));
  assert.equal(back?.at, 5);
  assert.deepEqual([...back!.levels], [["m", 2]]);
  assert.deepEqual([...back!.paused], ["p"]);
  assert.equal(liveStockFromStored(null), null);
  assert.equal(liveStockFromStored({ at: "x", levels: {}, paused: [] }), null);
  assert.deepEqual([...liveStockFromStored({ at: 1, levels: { a: NaN, b: 1 }, paused: ["p"] })!.levels], [["b", 1]]);
});

// --- offline: levels minus this device's queued bills ---

function catalog(): StockCatalog {
  const c = emptyStockCatalog();
  c.recipes.set("latte", [
    { kind: "fixed", materialId: "milk", qty: 180 },
    { kind: "fixed", materialId: "ice", qty: 150 },
  ]);
  // a menu that does not allow a special bean: choosing one makes resolveLine answer { error }
  c.recipes.set("house-only", [{ kind: "slot", groupId: "beans", qty: 18, defaultMemberId: "h", allowSpecial: false }]);
  const m = (id: string, tier: "house" | "special") =>
    ({ id, groupId: "beans", materialId: id, label: id, tier, priceDelta: 0, isDefault: id === "h", sortOrder: 0 });
  c.groups.set("beans", { id: "beans", kind: "bean", name: "b", members: [m("h", "house"), m("s", "special")] });
  return c;
}

const item = (productId: string, quantity: number): CartItem => ({
  cartItemKey: productId, productId, name: productId, basePrice: 60, quantity,
  selectedModifiers: [], totalPrice: 60 * quantity, note: null,
});

function bill(clientRef: string, state: OutboxState, items: CartItem[], over: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    clientRef, tenantId: "t1", sellerId: "u", state, createdAt: 1,
    input: { items, paymentMethod: "cash", orderType: "dine_in", clientRef, bags: 3 } as unknown as OutboxEntry["input"],
    offline: null,
    display: { total: 0, itemCount: 0, itemsText: "", paymentMethod: "cash", queueNumber: null, cashReceived: null, changeAmount: null },
    tries: 0, nextTryAt: 0, lastError: null, reviewCode: null, serverQueueNumber: null,
    ...over,
  };
}

test("levels from queued outbox bills", () => {
  const entries = [bill("a", "pending", [item("latte", 1)]), bill("b", "pending", [item("latte", 1)])];
  const levels = effectiveLevels(new Map([["milk", 1000], ["ice", 1000], ["untracked-here", 5]]), entries, "t1", catalog());
  assert.equal(levels.get("milk"), 640); // two lattes, 180 each
  assert.equal(levels.get("ice"), 700);
  assert.equal(levels.get("untracked-here"), 5);
  assert.equal(levels.has("bags"), false); // bag lines are never subtracted (bags never make a menu out)
});

test("queued stock: only this shop's pending and review bills count", () => {
  const items = [item("latte", 1)];
  const entries = [
    bill("p", "pending", items),
    bill("r", "review", items),
    bill("att", "attempt", items), // may already be on the server: counted there, not here
    bill("chk", "check-only", items),
    bill("other", "pending", items, { tenantId: "t2" }),
  ];
  assert.equal(queuedStockLines(entries, "t1", catalog()).length, 2);
});

test("queued stock: an item that cannot be resolved is skipped, the rest of the bill still counts", () => {
  const c = catalog();
  const bad = {
    ...item("house-only", 1),
    choices: { slots: [{ groupId: "beans", memberId: "s" }], slotAddGroupIds: [], sweetness: null },
  } as unknown as CartItem;
  const entries = [bill("a", "pending", [bad, item("latte", 2)])];
  const lines = queuedStockLines(entries, "t1", c);
  assert.equal(lines.length, 1);
  assert.deepEqual([...lines[0]!].sort((a, b) => a.materialId.localeCompare(b.materialId)), [
    { materialId: "ice", qty: 300 }, { materialId: "milk", qty: 360 },
  ]);
});

test("effectiveLevels with nothing queued is the levels as they are", () => {
  const base = new Map([["milk", 10]]);
  assert.deepEqual([...effectiveLevels(base, [], "t1", catalog())], [["milk", 10]]);
});
