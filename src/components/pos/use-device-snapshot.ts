"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { bangkokToday } from "@/lib/bangkok-time";
import { nextDeviceQueue, observeQueue, type QueueState } from "@/lib/offline/device-queue";
import { kvGet, kvSet } from "@/lib/offline/idb";
import type { HeartbeatAnswer } from "./use-heartbeat";

type Snapshot = {
  at: number;
  shiftId: string | null;
  promptpayId: string | null;
  queue: QueueState | null;
};

type Page = {
  at: number;
  shiftId: string | null;
  promptpayId: string | null;
  queue: QueueState;
};

export type DeviceSnapshot = {
  shiftId: string | null;
  promptpayId: string | null;
  queue: QueueState | null;
  /** Raise today's queue to at least n (a number the server handed out). Never throws. */
  observe(n: number): void;
  /** Allocate the next device queue number; resolves only once it is saved on the device. */
  takeNext(): Promise<number>;
};

const key = (tenantId: string) => `snapshot:${tenantId}`;

function isQueue(v: unknown): v is QueueState {
  const q = v as QueueState | null;
  return !!q && typeof q.date === "string" && typeof q.last === "number" && Number.isFinite(q.last);
}

/** Reads what a previous run stored; anything malformed counts as nothing stored. */
function parseStored(v: unknown): Snapshot | null {
  const s = v as Partial<Snapshot> | null | undefined;
  if (!s || typeof s !== "object" || typeof s.at !== "number") return null;
  return {
    at: s.at,
    shiftId: typeof s.shiftId === "string" ? s.shiftId : null,
    promptpayId: typeof s.promptpayId === "string" ? s.promptpayId : null,
    queue: isQueue(s.queue) ? s.queue : null,
  };
}

/** Max of the queue states that are for `today`; a state from another day never wins. */
function mergeQueue(today: string, ...states: (QueueState | null)[]): QueueState | null {
  let out: QueueState | null = null;
  for (const s of states) {
    if (s && s.date === today) out = observeQueue(out, today, s.last);
  }
  return out;
}

/** The larger `at` wins shift and PromptPay; the queue is always merged, never overwritten. */
function mergeSnapshots(a: Snapshot, b: Snapshot | null, today: string): Snapshot {
  const newer = b && b.at > a.at ? b : a;
  return {
    at: newer.at,
    shiftId: newer.shiftId,
    promptpayId: newer.promptpayId,
    queue: mergeQueue(today, a.queue, b?.queue ?? null),
  };
}

/**
 * The device's copy of what an offline sale needs: the latest open shift, today's queue counter
 * and the PromptPay ID. It starts from the page (or what a previous run stored, if newer), follows
 * every heartbeat answer, and is saved in IndexedDB (kv "snapshot:<tenantId>"). Queue writes are
 * serialized, in this tab by a promise chain and across tabs by a Web Lock, and always re-read what
 * is stored first so two tabs never hand out the same number.
 */
export function useDeviceSnapshot({
  tenantId,
  page,
  heartbeat,
}: {
  tenantId: string;
  page: Page;
  heartbeat: { answer: HeartbeatAnswer | null };
}): DeviceSnapshot {
  const [snap, setSnap] = useState<Snapshot>(() => ({ ...page }));
  const snapRef = useRef<Snapshot>(snap);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());

  const apply = useCallback((next: Snapshot) => {
    snapRef.current = next;
    setSnap(next);
  }, []);

  // Runs fn after everything queued before it, holding the cross-tab lock when the browser has one.
  const serialized = useCallback(
    <T,>(fn: () => Promise<T>): Promise<T> => {
      const run = async (): Promise<T> => {
        const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
        if (!locks) return fn();
        return (await locks.request("kidkub-queue:" + tenantId, fn)) as T;
      };
      const result = chainRef.current.then(run, run);
      chainRef.current = result.catch(() => {});
      return result;
    },
    [tenantId],
  );

  // Best-effort save of the in-memory snapshot, merged with whatever is stored now.
  const persist = useCallback(() => {
    void serialized(async () => {
      let stored: Snapshot | null = null;
      try {
        stored = parseStored(await kvGet<unknown>(key(tenantId)));
      } catch {
        stored = null;
      }
      const merged = mergeSnapshots(snapRef.current, stored, bangkokToday(new Date()));
      apply(merged);
      await kvSet(key(tenantId), merged);
    }).catch(() => {
      // storage unusable: keep running on the in-memory copy
    });
  }, [apply, serialized, tenantId]);

  // On load: take the newer of page and stored, merge the queues, and save the result.
  useEffect(() => {
    persist();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);

  // Every online heartbeat answer. A field the server could not read (undefined) changes nothing;
  // null is a real "no open shift".
  const answer = heartbeat.answer;
  useEffect(() => {
    if (!answer) return;
    const cur = snapRef.current;
    const today = bangkokToday(new Date());
    apply({
      at: answer.at,
      shiftId: answer.shiftId !== undefined ? answer.shiftId : cur.shiftId,
      promptpayId: answer.promptpayId !== undefined ? answer.promptpayId : cur.promptpayId,
      queue: mergeQueue(today, cur.queue, answer.queue ?? null),
    });
    persist();
  }, [answer, apply, persist]);

  const observe = useCallback(
    (n: number) => {
      const today = bangkokToday(new Date());
      const cur = snapRef.current;
      apply({ ...cur, queue: observeQueue(mergeQueue(today, cur.queue), today, n) });
      persist();
    },
    [apply, persist],
  );

  const takeNext = useCallback(
    () =>
      serialized(async () => {
        const today = bangkokToday(new Date());
        let stored: Snapshot | null = null;
        try {
          stored = parseStored(await kvGet<unknown>(key(tenantId)));
        } catch {
          // an unreadable store will fail the write below, which is what stops the sale
        }
        const merged = mergeSnapshots(snapRef.current, stored, today);
        const { number, state } = nextDeviceQueue(merged.queue, today);
        const next: Snapshot = { ...merged, queue: state };
        await kvSet(key(tenantId), next); // rejects -> takeNext rejects, state unchanged
        apply(next);
        return number;
      }),
    [apply, serialized, tenantId],
  );

  return {
    shiftId: snap.shiftId,
    promptpayId: snap.promptpayId,
    queue: snap.queue,
    observe,
    takeNext,
  };
}
