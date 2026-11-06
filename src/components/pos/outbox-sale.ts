// How the POS screen writes its payments into the device outbox (round C2, spec call 1). Kept out
// of pos-screen.tsx so the payment flow there stays readable. The manager PIN never reaches any
// of these: OutboxEntry["input"] has no approverPin field, and pos-screen's saleInput() (the only
// builder) never adds it; the PIN is spread in only for the online createOrder call itself.
import { computeChange } from "@/lib/cash";
import { outboxAll, outboxDeleteIf } from "@/lib/offline/idb";
import type { OutboxEntry } from "@/lib/offline/outbox-rules";
import type { CartItem, OfflineSale } from "@/types/app";

/** Shown in the payment window when the device could not store the bill (or its queue number). */
export const SAVE_ON_DEVICE_FAILED = "บันทึกในเครื่องไม่ได้";

export type SaleInput = OutboxEntry["input"];
export type SaleDisplay = OutboxEntry["display"];

/** What an offline result shows in the cart. */
export type OfflineResult = {
  queueNumber: number;
  cashReceived: number | null;
  changeAmount: number | null;
  /** The system's bill number, once this bill has been sent while its result is still shown. */
  orderNumber?: string;
};

export function saleDisplay(
  input: SaleInput,
  total: number,
  queueNumber: number | null,
): SaleDisplay {
  const cashReceived = input.cashReceived ?? null;
  return {
    total,
    itemCount: input.items.reduce((sum, i) => sum + i.quantity, 0),
    itemsText: input.items.map((i: CartItem) => `${i.name} ×${i.quantity}`).join(", "),
    paymentMethod: input.paymentMethod,
    queueNumber,
    cashReceived,
    changeAmount: cashReceived === null ? null : computeChange(total, cashReceived),
  };
}

/** A fresh outbox entry for this payment: an online `attempt` or a final `pending` bill. */
export function makeEntry(args: {
  clientRef: string;
  tenantId: string;
  sellerId: string;
  state: "attempt" | "pending";
  input: SaleInput;
  display: SaleDisplay;
  offline: OfflineSale | null;
}): OutboxEntry {
  return {
    clientRef: args.clientRef,
    tenantId: args.tenantId,
    sellerId: args.sellerId,
    state: args.state,
    createdAt: Date.now(),
    input: args.input,
    offline: args.offline,
    display: args.display,
    tries: 0,
    nextTryAt: 0,
    lastError: null,
    reviewCode: null,
    serverQueueNumber: null,
  };
}

/** A bill that will be sent no matter what (spec call 1): never overwritten or removed here. */
export function isFinal(e: OutboxEntry): boolean {
  return e.state === "pending" || e.state === "review";
}

/** A fresh read of this shop's entry for clientRef (not React state, which can lag a write). */
export async function readEntry(clientRef: string, tenantId: string): Promise<OutboxEntry | undefined> {
  const all = await outboxAll();
  return all.find((e) => e.clientRef === clientRef && e.tenantId === tenantId);
}

/**
 * Drops an online attempt that is settled (saved, refused, or found not saved). Only ever an
 * `attempt` / `check-only` entry of this shop: a final bill (pending/review) with the same ref is
 * left alone, because the cashier may have saved it to the device meanwhile. Best-effort.
 */
export async function dropAttempt(clientRef: string, tenantId: string): Promise<void> {
  try {
    await outboxDeleteIf(
      clientRef,
      (cur) => cur.tenantId === tenantId && (cur.state === "attempt" || cur.state === "check-only"),
    );
  } catch {
    // storage unavailable: a leftover attempt is recovered to check-only and asked about later
  }
}

/** The queue number a final entry was given on the device (finalize keeps display as it was). */
export function deviceQueueOf(e: OutboxEntry): number | null {
  return e.offline?.queueNumber ?? e.display.queueNumber;
}
