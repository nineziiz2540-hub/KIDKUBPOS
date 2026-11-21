"use client";
// The POS's stock states (round D2a): each menu tile's "ปิดขาย / หมด? / เหลือ ~N แก้ว", the view the
// option window's chips read, the "ยังมีของ ขายต่อ" memory of this iPad (R-D2a-21) and the pause or
// reopen this iPad just made. The rules are in src/lib/stock/pos-states.ts (pure, tested); this hook
// only holds the device state: localStorage (every access in try/catch, else memory only), today's
// Bangkok date, and the optimistic pause changes.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { bangkokToday } from "@/lib/bangkok-time";
import { HEARTBEAT_INTERVAL_MS } from "@/lib/connectivity";
import type { Levels } from "@/lib/stock/availability";
import type { LiveStock } from "@/lib/stock/live-stock";
import type { StockCatalog } from "@/lib/stock/stock-core";
import {
  outMaterials, parseSuppressed, pausedMenus, pruneSuppressed, suppressedMaterials, suppressionStorageKey,
  suppressMaterials, tileState,
  type PauseOverride, type StockView, type TileState,
} from "@/lib/stock/pos-states";

/** How often the business date is re-read, so a page left open past midnight stops suppressing. */
const TODAY_CHECK_MS = 60_000;
/** Levels read within this long (two heartbeats) may end a suppression for good. */
const FRESH_LEVELS_MS = 2 * HEARTBEAT_INTERVAL_MS;

// The stored map per key. `memory` holds what this page wrote last (also when localStorage refuses it:
// private mode, quota, blocked site data), so a write always takes effect on this page.
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function readRaw(key: string): string | null {
  const mem = memory.get(key);
  if (mem !== undefined) return mem;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // kept in memory only: this page still stops asking; a reload asks again
  }
  for (const l of listeners) l();
}

export function useStockStates({
  tenantId,
  renderedAt,
  liveStock,
  shownLevels,
  catalog,
  productIds,
}: {
  tenantId: string;
  /** Server Date.now() when the page was rendered: today's date before the first clock tick. */
  renderedAt: number;
  /**
   * The live stock as the server sent it (page or heartbeat, the device snapshot); null = never read.
   * Its RAW levels are what suppressions are stored and ended against (final review I2): a queued bill
   * syncing never moves them, only a receive, count or adjust does.
   */
  liveStock: LiveStock | null;
  /** The levels the tiles and chips show: liveStock's minus this iPad's queued bills; null = no stock data. */
  shownLevels: Levels | null;
  catalog: StockCatalog;
  productIds: string[];
}): {
  /** Each menu's state; a menu missing here is "ok". */
  tileStates: Map<string, TileState>;
  /** Every material that makes this menu "หมด?" now, paused or not (for "เปิดขายแล้วสั่ง" / "ขายแก้วนี้", R-D2a-23). */
  outMaterialsOf: (productId: string) => string[];
  /** What the option window's chips read; null = no stock data (every chip looks as before). */
  view: StockView | null;
  /** "ยังมีของ ขายต่อ": stop asking about these materials on this iPad until their level rises or the day ends. */
  suppress: (materialIds: string[]) => void;
  /** The server accepted a pause or reopen made on this iPad: show it now, before the heartbeat does. */
  markPaused: (productId: string, paused: boolean) => void;
} {
  const key = suppressionStorageKey(tenantId);
  // The server has no localStorage: the first render shows nothing suppressed, then the stored map.
  const raw = useSyncExternalStore(subscribe, () => readRaw(key), () => null);
  const store = useMemo(() => parseSuppressed(raw), [raw]);

  const [today, setToday] = useState(() => bangkokToday(new Date(renderedAt)));
  useEffect(() => {
    const timer = setInterval(() => setToday(bangkokToday(new Date())), TODAY_CHECK_MS);
    return () => clearInterval(timer);
  }, []);

  const [overrides, setOverrides] = useState<Record<string, PauseOverride>>({});

  const rawLevels = liveStock?.levels;
  const suppressed = useMemo(
    () => (rawLevels ? suppressedMaterials(store, rawLevels, today) : new Set<string>()),
    [store, rawLevels, today]
  );
  const shown: LiveStock = useMemo(
    () => ({ levels: shownLevels ?? new Map(), paused: pausedMenus(liveStock, overrides), at: liveStock?.at ?? 0 }),
    [shownLevels, liveStock, overrides]
  );
  const tileStates = useMemo(
    () => new Map(productIds.map((id) => [id, tileState(id, catalog, shown, suppressed)])),
    [productIds, catalog, shown, suppressed]
  );
  const outMaterialsOf = useCallback(
    (productId: string) => outMaterials(productId, catalog, shown.levels, suppressed),
    [catalog, shown, suppressed]
  );
  const view = useMemo(() => (shownLevels ? { levels: shownLevels, suppressed } : null), [shownLevels, suppressed]);

  // An ended suppression stays ended (R-D2a-21): once a level rises above its stored level, or the day
  // has passed, the entry is dropped from the device, so selling back down never silences it again.
  // Dropping is for good, so only on levels read moments ago: a /pos page the service worker serves
  // from its cache offline carries the old (higher) levels of when it was cached. Raw levels only: the
  // outbox sending this iPad's queued bills raises the shown levels, never the raw ones (I2).
  const liveAt = liveStock?.at;
  useEffect(() => {
    if (!rawLevels || liveAt === undefined || Date.now() - liveAt > FRESH_LEVELS_MS) return;
    const pruned = pruneSuppressed(store, rawLevels, today);
    if (pruned !== store) writeRaw(key, JSON.stringify(pruned));
  }, [key, store, rawLevels, liveAt, today]);

  const suppress = useCallback(
    (materialIds: string[]) => {
      if (!rawLevels) return;
      const before = parseSuppressed(readRaw(key));
      // each at its raw level; an untracked material (no level) is never "หมด?" and is not stored
      const next = suppressMaterials(before, materialIds, rawLevels, today);
      if (next !== before) writeRaw(key, JSON.stringify(next));
    },
    [key, rawLevels, today]
  );

  const markPaused = useCallback((productId: string, paused: boolean) => {
    const at = Date.now();
    setOverrides((prev) => ({ ...prev, [productId]: { paused, at } }));
  }, []);

  return { tileStates, outMaterialsOf, view, suppress, markPaused };
}
