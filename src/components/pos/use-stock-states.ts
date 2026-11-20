"use client";
// The POS's stock states (round D2a): each menu tile's "ปิดขาย / หมด? / เหลือ ~N แก้ว", the view the
// option window's chips read, the "ยังมีของ ขายต่อ" memory of this iPad (R-D2a-21) and the pause or
// reopen this iPad just made. The rules are in src/lib/stock/pos-states.ts (pure, tested); this hook
// only holds the device state: localStorage (every access in try/catch, else memory only), today's
// Bangkok date, and the optimistic pause changes.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { bangkokToday } from "@/lib/bangkok-time";
import type { LiveStock } from "@/lib/stock/live-stock";
import type { StockCatalog } from "@/lib/stock/stock-core";
import {
  parseSuppressed, pausedMenus, suppressedMaterials, suppressionStorageKey, suppressMaterial, tileState,
  type PauseOverride, type StockView, type TileState,
} from "@/lib/stock/pos-states";

/** How often the business date is re-read, so a page left open past midnight stops suppressing. */
const TODAY_CHECK_MS = 60_000;

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
  catalog,
  productIds,
}: {
  tenantId: string;
  /** Server Date.now() when the page was rendered: today's date before the first clock tick. */
  renderedAt: number;
  /** The effective live stock (levels minus this iPad's queued bills); null = never read. */
  liveStock: LiveStock | null;
  catalog: StockCatalog;
  productIds: string[];
}): {
  /** Each menu's state; a menu missing here is "ok". */
  tileStates: Map<string, TileState>;
  /** A menu's state as if it were not paused (after "เปิดขายแล้วสั่ง" / "ขายแก้วนี้"). */
  stateIgnoringPause: (productId: string) => TileState;
  /** What the option window's chips read; null = no stock data (every chip looks as before). */
  view: StockView | null;
  /** "ยังมีของ ขายต่อ": stop asking about this material on this iPad until its level rises or the day ends. */
  suppress: (materialId: string) => void;
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

  const levels = liveStock?.levels;
  const suppressed = useMemo(
    () => (levels ? suppressedMaterials(store, levels, today) : new Set<string>()),
    [store, levels, today]
  );
  const shown: LiveStock = useMemo(
    () => ({ levels: levels ?? new Map(), paused: pausedMenus(liveStock, overrides), at: liveStock?.at ?? 0 }),
    [levels, liveStock, overrides]
  );
  const tileStates = useMemo(
    () => new Map(productIds.map((id) => [id, tileState(id, catalog, shown, suppressed)])),
    [productIds, catalog, shown, suppressed]
  );
  const stateIgnoringPause = useCallback(
    (productId: string) => tileState(productId, catalog, { ...shown, paused: new Set() }, suppressed),
    [catalog, shown, suppressed]
  );
  const view = useMemo(() => (levels ? { levels, suppressed } : null), [levels, suppressed]);

  const suppress = useCallback(
    (materialId: string) => {
      const level = levels?.get(materialId);
      if (level === undefined) return; // untracked: never "หมด?" in the first place
      writeRaw(key, JSON.stringify(suppressMaterial(parseSuppressed(readRaw(key)), materialId, level, today)));
    },
    [key, levels, today]
  );

  const markPaused = useCallback((productId: string, paused: boolean) => {
    const at = Date.now();
    setOverrides((prev) => ({ ...prev, [productId]: { paused, at } }));
  }, []);

  return { tileStates, stateIgnoringPause, view, suppress, markPaused };
}
