// What the POS shows for stock on its menu tiles and option chips (round D2a): "ปิดขาย", "หมด?",
// "เหลือ ~N แก้ว", which "หมด?" this iPad has stopped asking about, and the pause the cashier just
// set. Pure — no React, no storage, no clock: the POS hands in the levels, the stored map and today's
// Bangkok date. Hints only: every state can be passed with one tap, and nothing here refuses a sale.
import { menuAvailability, needsAvailability, type Availability, type Levels } from "./availability.ts";
import type { LiveStock } from "./live-stock.ts";
import type { StockCatalog } from "./stock-core.ts";
import { HEARTBEAT_TIMEOUT_MS } from "../connectivity.ts";
import { withDeadline } from "../payment-attempt.ts";

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

/**
 * materialId → the RAW level (the server's last known number, before this iPad's queued bills are taken
 * off) when the cashier said there is still some, and that business day. Raw, not the shown level: a
 * queued bill leaving the outbox raises the shown level back up, and that must never look like a
 * receive (final review I2). Raw levels rise only from a receive, a count or an adjust up (or a void).
 */
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
 * One "ยังมีของ ขายต่อ" tap for every material it covers (a packaging set at 0 can be cup, lid and straw
 * at once; final review I1, R-D2a-23), each at its RAW level. A material missing from `rawLevels` is
 * untracked (never "หมด?"): nothing is stored for it. Nothing stored → the same map back.
 */
export function suppressMaterials(store: SuppressedStore, materialIds: string[], rawLevels: Levels, today: string): SuppressedStore {
  let out = store;
  for (const id of materialIds) {
    const level = rawLevels.get(id);
    if (level !== undefined) out = suppressMaterial(out, id, level, today);
  }
  return out;
}

/**
 * The map without the suppressions that have ended, so an ended one stays ended: a material whose
 * raw level is above its stored level (a receive, a count up, an adjust up), and entries of an earlier
 * day. `levels` are the raw levels (SuppressedStore), never the shown ones. A material missing from
 * `levels` is kept (nothing known). An entry dated after `today` is kept too (`today` may come from a
 * page rendered yesterday). Nothing ended → the same map back.
 */
export function pruneSuppressed(store: SuppressedStore, levels: Levels, today: string): SuppressedStore {
  const out: SuppressedStore = {};
  let dropped = false;
  for (const [id, e] of Object.entries(store)) {
    const level = levels.get(id);
    if (e.date < today || (level !== undefined && level > e.level)) dropped = true;
    else out[id] = e;
  }
  return dropped ? out : store;
}

/**
 * The materials this iPad does not ask about: stored today, and the raw level has not risen above the
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

/** How long "ไม่มีแล้ว ปิดขาย" / "เปิดขายแล้วสั่ง" wait for the server before counting as no answer. */
export const PAUSE_DEADLINE_MS = 5_000;

/** What a pause/reopen call came back with: done, the server's Thai error, or no answer (network or too slow). */
export type PauseResult = { ok: true } | { error: string } | { offline: true };

/**
 * The pause/reopen call, bounded: server actions run one at a time, so it can sit behind a stalled
 * payment or the outbox catching up while the heartbeat still says online. After PAUSE_DEADLINE_MS it
 * counts as offline (the dialog then offers "ขายแก้วนี้"), so the POS is never stuck in a dialog.
 */
export async function settlePauseCall(call: Promise<{ error?: string }>, ms = PAUSE_DEADLINE_MS): Promise<PauseResult> {
  try {
    const res = await withDeadline(call, ms);
    return res.error ? { error: res.error } : { ok: true };
  } catch {
    return { offline: true };
  }
}

/**
 * Every material that makes the menu "หมด?" now (paused or not), the scarcest first: after
 * "เปิดขายแล้วสั่ง" / "ขายแก้วนี้" they are all treated as "ยังมีของ ขายต่อ" (R-D2a-23), so the cashier
 * is asked once, not twice. Each found material is set aside before looking again, so it ends.
 */
export function outMaterials(productId: string, catalog: StockCatalog, levels: Levels, suppressed: Set<string>): string[] {
  const aside = new Set(suppressed);
  const found: string[] = [];
  for (;;) {
    const a = menuAvailability(productId, catalog, withoutSuppressed(levels, aside));
    if (a.state !== "out" || a.limitingMaterialId === null || aside.has(a.limitingMaterialId)) return found;
    found.push(a.limitingMaterialId);
    aside.add(a.limitingMaterialId);
  }
}
