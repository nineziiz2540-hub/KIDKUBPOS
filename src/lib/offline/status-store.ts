"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { onOutboxChange, outboxAll } from "./idb";
import { counts } from "./outbox-rules";

// What the app shell needs to know about the POS's connection and the device's unsent bills.
// The POS publishes its heartbeat verdict here; the shell (sidebar, bottom nav) only reads.
// The last value is kept after the POS unmounts; a fresh page load starts as online.

let posOnline = true;
const listeners = new Set<() => void>();

export function setPosOnline(online: boolean): void {
  if (posOnline === online) return;
  posOnline = online;
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function usePosOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => posOnline,
    () => true,
  );
}

/**
 * Unsent bills on this device (pending = waiting to send, review = refused, cash still in the
 * drawer), live across tabs. With a tenantId only that shop's bills count. When the device
 * store is unavailable it reports zero rather than crashing the shell.
 */
export function usePendingCount(tenantId?: string): { pending: number; review: number } {
  const [state, setState] = useState({ pending: 0, review: 0 });
  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const entries = await outboxAll();
        const next =
          tenantId === undefined
            ? countAll(entries)
            : (({ pending, review }) => ({ pending, review }))(counts(entries, tenantId));
        if (alive) {
          setState((prev) =>
            prev.pending === next.pending && prev.review === next.review ? prev : next,
          );
        }
      } catch {
        if (alive) setState((prev) => (prev.pending === 0 && prev.review === 0 ? prev : { pending: 0, review: 0 }));
      }
    }
    void refresh();
    let unsubscribe: () => void = () => {};
    try {
      unsubscribe = onOutboxChange(() => void refresh());
    } catch {
      // cross-tab refresh is best-effort
    }
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [tenantId]);
  return state;
}

function countAll(entries: { state: string }[]) {
  return {
    pending: entries.filter((e) => e.state === "pending").length,
    review: entries.filter((e) => e.state === "review").length,
  };
}
