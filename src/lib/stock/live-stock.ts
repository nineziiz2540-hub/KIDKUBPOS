// Live stock on the POS (round D2a): the levels and paused menus the heartbeat brings every 30 s,
// how a newer answer replaces the old one, and what this device's queued bills take off it while
// offline. Pure apart from readLiveStock (one read against a Supabase client); no React. Hints only:
// nothing here ever blocks or slows a sale.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { levelsAfter, type Levels } from "./availability.ts";
import { resolveLine, type StockCatalog, type StockLine } from "./stock-core.ts";
import { toLineChoices } from "../order-pricing-core.ts";
import type { OutboxEntry } from "../offline/outbox-rules.ts";

/** What /api/heartbeat sends: materialId → level (tracked, non-archived), and the paused menu ids. */
export type StockAnswer = { levels: Record<string, number>; paused: string[] };

/** The POS's live copy. `at` is when it was read (device clock for an answer, server clock for the page). */
export type LiveStock = { levels: Levels; paused: Set<string>; at: number };

/** The JSON-safe form kept in the device snapshot. */
export type StoredLiveStock = { at: number; levels: Record<string, number>; paused: string[] };

/** Number() every level and drop what is not a finite number: NaN never reaches `Levels`. */
export function levelsFromRecord(record: Record<string, unknown>): Levels {
  const out: Levels = new Map();
  for (const [id, raw] of Object.entries(record)) {
    if (raw === null || raw === "" || typeof raw === "boolean") continue; // Number(null) is 0, not a level
    const n = Number(raw);
    if (Number.isFinite(n)) out.set(id, n);
  }
  return out;
}

function recordFromLevels(levels: Levels): Record<string, number> {
  return Object.fromEntries(levels);
}

/** The newer `at` wins; an older (or equal) answer is ignored. When newer, levels and paused are replaced, not merged. */
export function mergeLiveStock(prev: LiveStock, answer: StockAnswer, at: number): LiveStock {
  if (!(at > prev.at)) return prev;
  return { levels: levelsFromRecord(answer.levels), paused: new Set(answer.paused), at };
}

/** The heartbeat body's `stock`, or undefined when absent or malformed (the POS then keeps what it has). */
export function parseStockAnswer(body: unknown): StockAnswer | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const stock = (body as { stock?: unknown }).stock;
  if (typeof stock !== "object" || stock === null) return undefined;
  const { levels, paused } = stock as { levels?: unknown; paused?: unknown };
  if (typeof levels !== "object" || levels === null || Array.isArray(levels) || !Array.isArray(paused)) return undefined;
  return {
    levels: recordFromLevels(levelsFromRecord(levels as Record<string, unknown>)),
    paused: paused.filter((p): p is string => typeof p === "string"),
  };
}

export function liveStockToStored(live: LiveStock): StoredLiveStock {
  return { at: live.at, levels: recordFromLevels(live.levels), paused: [...live.paused] };
}

/** Reads what a previous run stored; anything malformed counts as nothing stored. */
export function liveStockFromStored(v: unknown): LiveStock | null {
  const s = v as Partial<StoredLiveStock> | null | undefined;
  if (!s || typeof s !== "object" || typeof s.at !== "number" || !Number.isFinite(s.at)) return null;
  if (typeof s.levels !== "object" || s.levels === null || Array.isArray(s.levels) || !Array.isArray(s.paused)) return null;
  return {
    at: s.at,
    levels: levelsFromRecord(s.levels as Record<string, unknown>),
    paused: new Set(s.paused.filter((p): p is string => typeof p === "string")),
  };
}

/**
 * Stock lines of this device's bills that the server has not deducted yet: this shop's entries still
 * waiting to be sent (`pending`) or held for the manager (`review`: the cups were made, the bill is not
 * recorded). `attempt` and `check-only` entries are online sales whose answer was lost: they may already
 * be on the server, so the next heartbeat's levels already include them (counting them here could
 * subtract twice). Each item goes through resolveLine like the server's sale path; an item it cannot
 * resolve is skipped. Bag lines are never counted: bags never make a menu out.
 */
export function queuedStockLines(entries: OutboxEntry[], tenantId: string, catalog: StockCatalog): StockLine[][] {
  const bills: StockLine[][] = [];
  for (const e of entries) {
    if (e.tenantId !== tenantId || (e.state !== "pending" && e.state !== "review")) continue;
    const lines: StockLine[] = [];
    for (const item of e.input.items ?? []) {
      const optionIds = (item.selectedModifiers ?? []).map((s) => s.optionId);
      const resolved = resolveLine(item.productId, item.quantity, toLineChoices(item), optionIds, catalog);
      if ("error" in resolved) continue;
      lines.push(...resolved.stock);
    }
    bills.push(lines);
  }
  return bills;
}

/** The levels the POS shows: the last known levels minus this device's queued bills. */
export function effectiveLevels(levels: Levels, entries: OutboxEntry[], tenantId: string, catalog: StockCatalog): Levels {
  return levelsAfter(levels, queuedStockLines(entries, tenantId, catalog));
}

/**
 * One cheap read for the heartbeat and the POS page: the tracked materials' levels and the paused
 * menus, with the signed-in user's client (staff-readable columns only, never a cost column). null =
 * a read failed, so the caller leaves `stock` out rather than say "nothing is paused".
 */
export async function readLiveStock(supabase: SupabaseClient<Database>, tenantId: string): Promise<StockAnswer | null> {
  try {
    const [materials, paused] = await Promise.all([
      supabase.from("raw_materials").select("id, current_stock").eq("tenant_id", tenantId).eq("track_stock", true).is("archived_at", null),
      supabase.from("products").select("id").eq("tenant_id", tenantId).not("paused_at", "is", null),
    ]);
    if (materials.error || paused.error) return null;
    const levels: Record<string, number> = {};
    for (const m of materials.data ?? []) {
      const n = Number(m.current_stock);
      if (Number.isFinite(n)) levels[m.id] = n;
    }
    return { levels, paused: (paused.data ?? []).map((p) => p.id) };
  } catch {
    return null;
  }
}
