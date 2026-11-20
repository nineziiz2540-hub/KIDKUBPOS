// What the POS shows for stock on its menu tiles and option chips (round D2a): "ปิดขาย", "หมด?",
// "เหลือ ~N แก้ว", which "หมด?" this iPad has stopped asking about, and the pause the cashier just
// set. Pure — no React, no storage, no clock: the POS hands in the levels, the stored map and today's
// Bangkok date. Hints only: every state can be passed with one tap, and nothing here refuses a sale.
import { menuAvailability, needsAvailability, type Availability, type Levels } from "./availability.ts";
import type { LiveStock } from "./live-stock.ts";
import type { StockCatalog } from "./stock-core.ts";
import { HEARTBEAT_TIMEOUT_MS } from "../connectivity.ts";

export type TileState = { kind: "paused" } | { kind: "out"; materialId: string } | { kind: "low"; cupsLeft: number } | { kind: "ok" };

/** A chip's stock word; absent (undefined) = nothing to say, the chip looks as before. */
export type ChipStock = { kind: "low"; cupsLeft: number } | { kind: "out"; materialId: string };

/** The levels the POS shows (live minus this iPad's queued bills) and the materials it stopped asking about. */
export type StockView = { levels: Levels; suppressed: Set<string> };

export const PAUSED_WORD = "ปิดขาย";
export const OUT_WORD = "หมด?";

/** "เหลือ ~5 แก้ว" (shown for 1–10 cups, NEAR_OUT_CUPS). */
export function lowWord(cupsLeft: number): string {
  return `เหลือ ~${cupsLeft} แก้ว`;
}

/** A suppressed material is treated as untracked: it never makes anything "หมด?" or "เหลือ ~N". */
function withoutSuppressed(levels: Levels, suppressed: Set<string>): Levels {
  if (suppressed.size === 0) return levels;
  const out: Levels = new Map(levels);
  for (const id of suppressed) out.delete(id);
  return out;
}

function chipStockOf(a: Availability): ChipStock | undefined {
  if (a.state === "out" && a.limitingMaterialId !== null) return { kind: "out", materialId: a.limitingMaterialId };
  if (a.state === "low" && a.cupsLeft !== null) return { kind: "low", cupsLeft: a.cupsLeft };
  return undefined;
}

/** A chip's word from its per-cup needs; nothing when the POS has no stock data. */
export function needsStock(needs: { materialId: string; qty: number }[], view: StockView | null | undefined): ChipStock | undefined {
  if (!view) return undefined;
  return chipStockOf(needsAvailability(needs.filter((n) => !view.suppressed.has(n.materialId)), view.levels));
}

/**
 * A menu tile: "ปิดขาย" wins over everything; else the menu's availability (D2-4: fixed lines, its
 * packaging, or every house member of a slot group out) with the suppressed materials left out.
 */
export function tileState(productId: string, catalog: StockCatalog, live: LiveStock, suppressed: Set<string>): TileState {
  if (live.paused.has(productId)) return { kind: "paused" };
  const s = chipStockOf(menuAvailability(productId, catalog, withoutSuppressed(live.levels, suppressed)));
  return s ?? { kind: "ok" };
}

/** A tap on a tile or chip asks first only when it shows "หมด?" or "ปิดขาย"; anything else goes on as before. */
export function asksFirst(state: TileState | ChipStock | undefined): boolean {
  return state?.kind === "out" || state?.kind === "paused";
}

/**
 * The material's word in "ระบบคิดว่า…หมด": its chip word when it is a bean/matcha/sweetener choice
 * (the word the cashier knows), else its stock name, else a plain "วัตถุดิบ". Never an id.
 */
export function materialLabel(materialId: string, names: Record<string, string>, catalog: StockCatalog): string {
  for (const group of catalog.groups.values()) {
    const m = group.members.find((x) => x.materialId === materialId);
    if (m) return m.label;
  }
  return names[materialId] ?? "วัตถุดิบ";
}

// ── "ยังมีของ ขายต่อ": stop asking on this iPad (R-D2a-21) ──────────────────────

/** materialId → the effective level when the cashier said there is still some, and that business day. */
export type SuppressedStore = Record<string, { level: number; date: string }>;

/** One map per shop on this device. */
export function suppressionStorageKey(tenantId: string): string {
  return `kidkub-suppressed:${tenantId}`;
}

/** The stored JSON; anything unreadable or malformed counts as nothing stored. */
export function parseSuppressed(raw: string | null): SuppressedStore {
  if (raw === null) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: SuppressedStore = {};
  for (const [id, e] of Object.entries(v as Record<string, unknown>)) {
    const { level, date } = (e ?? {}) as { level?: unknown; date?: unknown };
    if (typeof level === "number" && Number.isFinite(level) && typeof date === "string") out[id] = { level, date };
  }
  return out;
}

/** The cashier tapped "ยังมีของ ขายต่อ": remember the level now; other days' entries are dropped. */
export function suppressMaterial(store: SuppressedStore, materialId: string, level: number, today: string): SuppressedStore {
  const out: SuppressedStore = {};
  for (const [id, e] of Object.entries(store)) if (e.date === today) out[id] = e;
  out[materialId] = { level, date: today };
  return out;
}

/**
 * The materials this iPad does not ask about: stored today, and the level has not risen above the
 * stored one. Sales only lower it, so they never end it; a receive, a count up or an adjust up does,
 * and so does a new business day.
 */
export function suppressedMaterials(store: SuppressedStore, levels: Levels, today: string): Set<string> {
  const out = new Set<string>();
  for (const [id, e] of Object.entries(store)) {
    const level = levels.get(id);
    if (e.date === today && level !== undefined && level <= e.level) out.add(id);
  }
  return out;
}

// ── a pause or reopen the cashier just made ──────────────────────────────────

/** This iPad's own change, shown at once; `at` = device time when the server accepted it. */
export type PauseOverride = { paused: boolean; at: number };

/**
 * The paused menus the tiles show: the live set, with this iPad's own recent changes on top. A
 * heartbeat answer that arrived within HEARTBEAT_TIMEOUT_MS of the change may have been read before
 * it, so it never undoes it; a later answer is the truth (another iPad may have changed it since).
 */
export function pausedMenus(live: LiveStock | null, overrides: Record<string, PauseOverride>): Set<string> {
  const out = new Set(live?.paused ?? []);
  const liveAt = live?.at ?? 0;
  for (const [productId, o] of Object.entries(overrides)) {
    if (liveAt > o.at + HEARTBEAT_TIMEOUT_MS) continue;
    if (o.paused) out.add(productId);
    else out.delete(productId);
  }
  return out;
}
