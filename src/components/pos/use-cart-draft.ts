"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { kvDelete, kvGet, kvSet } from "@/lib/offline/idb";
import {
  draftKey,
  restorable,
  toDraft,
  type CartDraft,
  type DraftState,
} from "@/lib/offline/cart-draft";

const SAVE_DEBOUNCE_MS = 300;
/** A stuck device store must not leave the hook never saving. */
const RESTORE_READ_TIMEOUT_MS = 3000;
const LOCK_RETRY_MS = 100;

type Args = {
  tenantId: string;
  sellerId: string;
  items: DraftState["items"];
  orderType: DraftState["orderType"];
  paymentMethod: DraftState["paymentMethod"];
  customer: DraftState["customer"];
  activeHeld: DraftState["activeHeld"];
  discount: DraftState["discount"];
  /** Called at most once, only if a draft was found and the cart was still empty. */
  onRestore: (draft: CartDraft) => void;
};

type LockApi = {
  request: (
    name: string,
    options: { ifAvailable: boolean },
    cb: (lock: unknown) => Promise<void> | null
  ) => Promise<unknown>;
};

function lockApi(): LockApi | null {
  const locks = (typeof navigator !== "undefined" ? navigator : undefined)?.locks;
  return locks ? (locks as unknown as LockApi) : null;
}

/**
 * Keeps the cart in progress on the device (kv `cart:<tenant>:<seller>`) so a reload brings it back.
 * Only one tab per seller owns the draft (a Web Lock held for the tab's lifetime); the others work
 * as a normal POS without touching it. Without Web Locks every tab owns it, as before. Storage
 * trouble is swallowed. Returns a stable `discard`.
 */
export function useCartDraft(args: Args): { discard: () => void } {
  const { tenantId, sellerId, items, orderType, paymentMethod, customer, activeHeld, discount } =
    args;
  const key = draftKey({ tenantId, sellerId });
  const [ready, setReady] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set once the cart has been finished or a restore has happened: no (later) restore may run.
  const noRestoreRef = useRef(false);
  const ownerRef = useRef(false);
  // The device store answered the restore read in time: only then does an emptied cart remove
  // the draft. After a timed-out read the draft may still be there unread, so it is left alone.
  const readOkRef = useRef(false);
  const latest = useRef(args);
  useEffect(() => {
    latest.current = args;
  });

  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    noRestoreRef.current = false;
    ownerRef.current = false;
    readOkRef.current = false;

    async function restore() {
      let saved: unknown;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = Symbol("timeout");
      try {
        const got = await Promise.race([
          kvGet<unknown>(key),
          new Promise<symbol>((resolve) => {
            timer = setTimeout(() => resolve(timedOut), RESTORE_READ_TIMEOUT_MS);
          }),
        ]);
        if (got === timedOut) saved = undefined;
        else {
          saved = got;
          readOkRef.current = true;
        }
      } catch {
        saved = undefined;
      } finally {
        clearTimeout(timer);
      }
      if (cancelled) return;
      const draft = restorable(saved, { tenantId, sellerId }, Date.now());
      const cur = latest.current;
      if (draft && !noRestoreRef.current && cur.items.length === 0 && cur.activeHeld === null) {
        noRestoreRef.current = true;
        cur.onRestore(draft);
      }
      setReady(true);
    }

    function own() {
      ownerRef.current = true;
      void restore();
    }

    const locks = lockApi();
    if (!locks) {
      own();
    } else {
      const tryLock = (again: boolean) => {
        locks
          .request(`kidkub-cart:${tenantId}:${sellerId}`, { ifAvailable: true }, (lock) => {
            if (!lock) return null;
            // Held until this tab goes away (or the effect is cleaned up).
            return new Promise<void>((resolve) => {
              release = resolve;
              if (cancelled) resolve();
              else own();
            });
          })
          .then(() => {
            // Not granted: one short retry (a strict-mode remount releases a moment late).
            if (!ownerRef.current && !cancelled && again) {
              retry = setTimeout(() => tryLock(false), LOCK_RETRY_MS);
            }
          })
          .catch(() => {
            if (!cancelled) own();
          });
      };
      tryLock(true);
    }

    return () => {
      cancelled = true;
      if (retry !== null) clearTimeout(retry);
      release?.();
      ownerRef.current = false;
      setReady(false);
    };
  }, [key, tenantId, sellerId]);

  // Save after the cart settles for a moment. An emptied cart removes the draft.
  useEffect(() => {
    if (!ready || !ownerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const draft = toDraft(
        { savedAt: Date.now(), items, orderType, paymentMethod, customer, activeHeld, discount },
        { tenantId, sellerId }
      );
      // Saving only writes. An emptied cart removes the draft only when the read said what was
      // there; the explicit removal is discard().
      if (draft) {
        // Our own write now stands in the store, so a later emptying removes it as usual.
        readOkRef.current = true;
        kvSet(key, draft).catch(() => {});
      }
      else if (readOkRef.current) kvDelete(key).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [ready, key, tenantId, sellerId, items, orderType, paymentMethod, customer, activeHeld, discount]);

  // The cart is finished (paid, cleared, parked): forget it now, and never restore it, even if a
  // restore read is still in flight. A save still waiting is cancelled first so it cannot write
  // the old cart back after the delete. A tab that does not own the draft leaves it alone.
  const discard = useCallback(() => {
    noRestoreRef.current = true;
    if (!ownerRef.current) return;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    kvDelete(key).catch(() => {});
  }, [key]);

  return { discard };
}
