"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkOrderSaved, createOrder, raiseQueueCounter } from "@/app/actions/orders";
import { PAYMENT_DEADLINE_MS, withDeadline } from "@/lib/payment-attempt";
import { onOutboxChange, outboxAll, outboxDelete, outboxPut } from "@/lib/offline/idb";
import {
  afterFailure,
  counts as countEntries,
  deviceNumberedMode,
  hasSenderWork,
  missingOfflineToReview,
  nextWork,
  recoverOrphans,
  saleBusinessDate,
  type OutboxEntry,
} from "@/lib/offline/outbox-rules";
import type { OfflineSale, SavedOrder } from "@/types/app";

const LOCK_NAME = "kidkub-outbox-sender";
const INTERVAL_MS = 5000;
const JUST_FINISHED_MS = 5000;
const ENTRY_MISSING = "outbox_entry_missing";

type Options = {
  tenantId: string;
  online: boolean;
  /** True while a payment window is open: sending never competes with the cashier's payment. */
  paused: boolean;
  /** useHeartbeat's lastSuccessAt: every new value wakes the sender (restarts retries). */
  wakeAt: number | null;
  /**
   * A bill reached the server (created or replayed) and left the outbox. `e.serverQueueNumber`
   * is set when the server kept a different queue number than the device's (spec call 15).
   */
  onSynced(e: OutboxEntry, saved: SavedOrder): void;
  /**
   * A check-only entry was answered and left the outbox: saved (checkOrderSaved does not return
   * the order id, so `saved.orderId` is "") or not saved (null).
   */
  onChecked(clientRef: string, saved: SavedOrder | null): void;
};

export type UseOutbox = {
  /** Every entry on the device (all shops), oldest first. counts/deviceNumbered are this shop's. */
  entries: OutboxEntry[];
  counts: { pending: number; review: number; checkOnly: number };
  deviceNumbered: boolean;
  /** Bills sent in this burst against the pending total; null when this tab isn't sending. */
  progress: { sent: number; total: number } | null;
  /** Bills sent since pending was last empty, for the green bar; null again after 5 s. */
  justFinished: number | null;
  put(e: OutboxEntry): Promise<void>;
  remove(clientRef: string): Promise<void>;
  markCheckOnly(clientRef: string): Promise<void>;
  finalize(clientRef: string, offline: OfflineSale): Promise<void>;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function findEntry(clientRef: string): Promise<OutboxEntry | undefined> {
  return (await outboxAll()).find((e) => e.clientRef === clientRef);
}

/**
 * Writes `fn(current)` only if the entry is still in the store (read just before), so a bill
 * another tab removed meanwhile is never brought back.
 */
async function updateIfPresent(
  clientRef: string,
  fn: (e: OutboxEntry) => OutboxEntry | null,
): Promise<OutboxEntry | null> {
  const cur = await findEntry(clientRef);
  if (!cur) return null;
  const next = fn(cur);
  if (next === null) return null;
  await outboxPut(next);
  return next;
}

/**
 * The device's outbox and its one sender (round C2, spec calls 1, 2, 8, 12, 15). Pending bills of
 * this shop are sent oldest first, one at a time, by whichever POS tab holds the cross-tab lock;
 * check-only entries are only ever asked about; refused bills go to review and raise the day's
 * queue counter past their device number.
 */
export function useOutbox({
  tenantId,
  online,
  paused,
  wakeAt,
  onSynced,
  onChecked,
}: Options): UseOutbox {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [justFinished, setJustFinished] = useState<number | null>(null);

  // Everything the sender reads lives in refs, so its callbacks keep one identity.
  const tenantRef = useRef(tenantId);
  const onlineRef = useRef(online);
  const pausedRef = useRef(paused);
  const onSyncedRef = useRef(onSynced);
  const onCheckedRef = useRef(onChecked);
  const mountedRef = useRef(false);
  /** Bumped whenever online/paused/tenant change or on unmount: a running burst then stops. */
  const genRef = useRef(0);
  const runningRef = useRef(false);
  const rerunRef = useRef(false);
  const refreshSeqRef = useRef(0);
  /** Bills sent since pending was last empty (summed over bursts) for justFinished. */
  const cycleSentRef = useRef(0);
  const finishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onSyncedRef.current = onSynced;
    onCheckedRef.current = onChecked;
  });

  const refresh = useCallback(async () => {
    const seq = ++refreshSeqRef.current;
    let all: OutboxEntry[];
    try {
      all = await outboxAll();
    } catch {
      all = [];
    }
    if (seq !== refreshSeqRef.current || !mountedRef.current) return;
    setEntries([...all].sort((a, b) => a.createdAt - b.createdAt));
  }, []);

  /** Orphaned attempts of this shop → check-only (R15: young ones may be another tab's payment). */
  const recover = useCallback(async () => {
    const changed = recoverOrphans(await outboxAll(), Date.now(), tenantRef.current);
    for (const e of changed) {
      await updateIfPresent(e.clientRef, (cur) =>
        cur.state === "attempt" ? { ...cur, state: "check-only" } : null,
      );
    }
  }, []);

  const shouldRun = useCallback(
    () => mountedRef.current && onlineRef.current && !pausedRef.current,
    [],
  );

  const raiseCounter = useCallback(async (e: OutboxEntry): Promise<void> => {
    if (!e.offline) return;
    let res: Awaited<ReturnType<typeof raiseQueueCounter>>;
    try {
      res = await withDeadline(
        raiseQueueCounter(saleBusinessDate(e), e.offline.queueNumber),
        PAYMENT_DEADLINE_MS,
      );
    } catch {
      return; // retried on a later burst (the entry still has no marker)
    }
    if (!("ok" in res)) return;
    await updateIfPresent(e.clientRef, (cur) =>
      cur.state === "review" ? { ...cur, counterRaised: true } : null,
    );
  }, []);

  /** One burst: what is due now, one job at a time, re-reading the store before each. */
  const burst = useCallback(async (gen: number) => {
    const tenant = tenantRef.current;
    const tried = new Set<string>();
    const live = () => shouldRun() && genRef.current === gen;
    let sent = 0;
    let total = 0;
    try {
      while (live()) {
        const all = await outboxAll();
        const work = nextWork(all, Date.now(), tenant, tried);
        if (!work) break;
        const e = work.entry;

        if (work.kind === "send") {
          if (!e.offline) {
            // Should not exist: never send a bill without its device data.
            await updateIfPresent(e.clientRef, (cur) =>
              cur.state === "pending" ? missingOfflineToReview(cur) : null,
            );
            continue;
          }
          const pendingNow = countEntries(all, tenant).pending;
          total = Math.max(total, sent + pendingNow);
          setProgress({ sent, total });

          let res: Awaited<ReturnType<typeof createOrder>>;
          let threw = false;
          try {
            res = await withDeadline(
              createOrder({ ...e.input, clientRef: e.clientRef, offline: e.offline }),
              PAYMENT_DEADLINE_MS,
            );
          } catch (err) {
            threw = true;
            res = { outcome: "retry", error: errorMessage(err) };
          }

          if (!("error" in res)) {
            const saved = res;
            await outboxDelete(e.clientRef);
            sent += 1;
            cycleSentRef.current += 1;
            setProgress({ sent, total });
            const synced =
              saved.queueNumber !== e.offline.queueNumber
                ? { ...e, serverQueueNumber: saved.queueNumber }
                : e;
            onSyncedRef.current(synced, saved);
            continue;
          }

          const failure = res;
          const now = Date.now();
          const next = await updateIfPresent(e.clientRef, (cur) =>
            cur.state === "pending" ? afterFailure(cur, failure, now) : null,
          );
          if (next?.state === "review") {
            tried.add(next.clientRef);
            await raiseCounter(next);
          }
          // No answer at all: the connection is likely down, so don't walk every bill into a
          // 15 s timeout. The heartbeat (wakeAt) or the interval starts the next burst.
          if (threw) break;
          continue;
        }

        tried.add(e.clientRef);
        if (work.kind === "check") {
          let res: Awaited<ReturnType<typeof checkOrderSaved>>;
          try {
            res = await withDeadline(checkOrderSaved(e.clientRef), PAYMENT_DEADLINE_MS);
          } catch {
            continue; // no answer: keep it
          }
          if (!("saved" in res)) continue; // no answer: keep it
          const cur = await findEntry(e.clientRef);
          if (!cur || cur.state !== "check-only") continue; // resolved elsewhere meanwhile
          await outboxDelete(e.clientRef);
          onCheckedRef.current(
            e.clientRef,
            res.saved
              ? {
                  orderId: "",
                  orderNumber: res.orderNumber,
                  queueNumber: res.queueNumber,
                  cashReceived: res.cashReceived,
                  changeAmount: res.changeAmount,
                }
              : null,
          );
          continue;
        }

        await raiseCounter(e);
      }
    } finally {
      setProgress(null);
      let pendingLeft = 1;
      try {
        pendingLeft = countEntries(await outboxAll(), tenant).pending;
      } catch {
        // storage gone: leave the summary alone
      }
      if (pendingLeft === 0 && cycleSentRef.current > 0 && mountedRef.current) {
        const n = cycleSentRef.current;
        cycleSentRef.current = 0;
        setJustFinished(n);
        if (finishedTimerRef.current) clearTimeout(finishedTimerRef.current);
        finishedTimerRef.current = setTimeout(() => {
          finishedTimerRef.current = null;
          if (mountedRef.current) setJustFinished(null);
        }, JUST_FINISHED_MS);
      }
    }
  }, [raiseCounter, shouldRun]);

  /** One loop run: recover orphans, then a burst under the cross-tab lock if there is work. */
  const runOnce = useCallback(async () => {
    if (!shouldRun()) return;
    const gen = genRef.current;
    const tenant = tenantRef.current;
    try {
      await recover();
      const all = await outboxAll();
      if (!nextWork(all, Date.now(), tenant, new Set())) return;
    } catch {
      return; // storage unavailable
    }
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks || typeof locks.request !== "function") {
      await burst(gen); // no Web Locks: a single tab sends on its own
      return;
    }
    try {
      // Held for this burst only, then released, so another tab can take over later.
      await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock) return; // another tab is sending; this one only listens
        await burst(gen);
      });
    } catch {
      // the lock manager failed; the next wake-up tries again
    }
  }, [burst, recover, shouldRun]);

  const kick = useCallback(() => {
    if (runningRef.current) {
      rerunRef.current = true;
      return;
    }
    runningRef.current = true;
    void (async () => {
      try {
        do {
          rerunRef.current = false;
          try {
            await runOnce();
          } catch {
            // storage failed mid-burst (or a callback threw): the next wake-up tries again
          }
        } while (rerunRef.current && shouldRun());
      } finally {
        runningRef.current = false;
      }
    })();
  }, [runOnce, shouldRun]);

  // Mount: load, recover orphaned attempts, listen for changes from this and other tabs.
  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = onOutboxChange(() => void refresh());
    void (async () => {
      try {
        await recover();
      } catch {
        // storage unavailable: entries stay []
      }
      await refresh();
    })();
    return () => {
      mountedRef.current = false;
      genRef.current += 1;
      unsubscribe();
      if (finishedTimerRef.current) clearTimeout(finishedTimerRef.current);
      finishedTimerRef.current = null;
    };
  }, [recover, refresh]);

  // online/paused/tenant change: stop a running burst, then start again when allowed.
  useEffect(() => {
    tenantRef.current = tenantId;
    onlineRef.current = online;
    pausedRef.current = paused;
    genRef.current += 1;
    if (online && !paused) kick();
  }, [tenantId, online, paused, kick]);

  // Every heartbeat success restarts the sender.
  useEffect(() => {
    if (wakeAt !== null && onlineRef.current && !pausedRef.current) kick();
  }, [wakeAt, kick]);

  const counts = useMemo(() => countEntries(entries, tenantId), [entries, tenantId]);
  const deviceNumbered = useMemo(
    () => deviceNumberedMode(entries, tenantId, online),
    [entries, tenantId, online],
  );
  const hasWork = useMemo(() => hasSenderWork(entries, tenantId), [entries, tenantId]);

  // A 5 s retry tick while this shop has something to send, check or raise.
  useEffect(() => {
    if (!online || paused || !hasWork) return;
    const id = setInterval(kick, INTERVAL_MS);
    return () => clearInterval(id);
  }, [online, paused, hasWork, kick]);

  const put = useCallback(
    async (e: OutboxEntry) => {
      await outboxPut(e);
      kick();
    },
    [kick],
  );

  const remove = useCallback(async (clientRef: string) => {
    await outboxDelete(clientRef);
  }, []);

  // Both act on an online attempt (attempt, or check-only after recovery). A bill that is already
  // final (pending/review) is left exactly as it is: it must never drop back to check-only.
  const markCheckOnly = useCallback(async (clientRef: string) => {
    const cur = await findEntry(clientRef);
    if (!cur) throw new Error(ENTRY_MISSING);
    if (cur.state !== "attempt") return;
    await outboxPut({ ...cur, state: "check-only" });
  }, []);

  const finalize = useCallback(
    async (clientRef: string, offline: OfflineSale) => {
      const cur = await findEntry(clientRef);
      if (!cur) throw new Error(ENTRY_MISSING);
      if (cur.state === "attempt" || cur.state === "check-only") {
        await outboxPut({ ...cur, state: "pending", offline, tries: 0, nextTryAt: 0 });
      }
      kick();
    },
    [kick],
  );

  return useMemo(
    () => ({
      entries,
      counts,
      deviceNumbered,
      progress,
      justFinished,
      put,
      remove,
      markCheckOnly,
      finalize,
    }),
    [entries, counts, deviceNumbered, progress, justFinished, put, remove, markCheckOnly, finalize],
  );
}
