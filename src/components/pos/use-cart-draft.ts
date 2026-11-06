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

type Args = {
  tenantId: string;
  sellerId: string;
  items: DraftState["items"];
  orderType: DraftState["orderType"];
  paymentMethod: DraftState["paymentMethod"];
  customer: DraftState["customer"];
  activeHeld: DraftState["activeHeld"];
  discount: DraftState["discount"];
  /** Called once on mount, only if a draft was found and the cart was still empty. */
  onRestore: (draft: CartDraft) => void;
};

/**
 * Keeps the cart in progress on the device (kv `cart:<tenant>:<seller>`) so a reload brings it back.
 * Storage trouble is swallowed: the POS never depends on it. Returns a stable `discard`.
 */
export function useCartDraft(args: Args): { discard: () => void } {
  const { tenantId, sellerId, items, orderType, paymentMethod, customer, activeHeld, discount } =
    args;
  const key = draftKey({ tenantId, sellerId });
  const [ready, setReady] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(args);
  useEffect(() => {
    latest.current = args;
  });

  // Restore once on mount. The cart may already have changed while the read was running: then
  // the cashier's own cart wins and nothing is restored.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await kvGet<unknown>(key);
        if (cancelled) return;
        const draft = restorable(saved, { tenantId, sellerId });
        const cur = latest.current;
        if (draft && cur.items.length === 0 && cur.activeHeld === null) cur.onRestore(draft);
      } catch {
        // no storage: nothing to restore
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // Once per mount (and per seller): a restore must never run again.
  }, [key, tenantId, sellerId]);

  // Save after the cart settles for a moment. An emptied cart removes the draft.
  useEffect(() => {
    if (!ready) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const draft = toDraft(
        { savedAt: Date.now(), items, orderType, paymentMethod, customer, activeHeld, discount },
        { tenantId, sellerId }
      );
      (draft ? kvSet(key, draft) : kvDelete(key)).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [ready, key, tenantId, sellerId, items, orderType, paymentMethod, customer, activeHeld, discount]);

  // The cart is finished (paid, cleared, parked): forget it now. Any save still waiting is
  // cancelled first, so it cannot write the old cart back after the delete.
  const discard = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    kvDelete(key).catch(() => {});
  }, [key]);

  return { discard };
}
