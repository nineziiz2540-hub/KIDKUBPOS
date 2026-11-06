// Pure rules for the offline outbox (bills saved on the device, sent later).
import type { CreateOrderInput, OfflineSale } from "../../types/app.ts";
import type { ReviewCode } from "./sync-outcome.ts";
import { bangkokToday } from "../bangkok-time.ts";
import { PAYMENT_DEADLINE_MS } from "../payment-attempt.ts";

export type OutboxState = "attempt" | "check-only" | "pending" | "review";

export type OutboxEntry = {
  clientRef: string;
  tenantId: string;
  sellerId: string;
  state: OutboxState;
  createdAt: number;
  // PINs are never stored in the outbox.
  input: Omit<CreateOrderInput, "approverPin" | "override">;
  offline: OfflineSale | null;
  display: {
    total: number;
    itemCount: number;
    itemsText: string;
    paymentMethod: "cash" | "transfer";
    queueNumber: number | null;
    cashReceived: number | null;
    changeAmount: number | null;
  };
  tries: number;
  nextTryAt: number;
  lastError: string | null;
  reviewCode: ReviewCode | null;
  serverQueueNumber: number | null;
  /**
   * Review entries only: true once the server's queue counter for the sale's day was raised to
   * this bill's device number (spec call 2). Missing = not yet; the sender keeps trying.
   */
  counterRaised?: boolean;
};

export const MAX_GENERIC_TRIES = 20;

/**
 * How old an `attempt` / `check-only` entry must be before the sender touches it. A younger one
 * may belong to a payment still running in another tab (its window waits PAYMENT_DEADLINE_MS).
 */
export const ORPHAN_AFTER_MS = PAYMENT_DEADLINE_MS + 30_000;

/** Shown in the review list for a pending entry that somehow lost its device data. */
export const MISSING_OFFLINE_MESSAGE = "ข้อมูลบิลที่ขายตอนเน็ตหลุดไม่ถูกต้อง";
const GENERIC_ERROR = "บันทึกออเดอร์ไม่สำเร็จ";

/** After a crash or reload an unanswered attempt may have saved: ask before re-sending. */
export function startupRecovery(entries: OutboxEntry[]): OutboxEntry[] {
  return entries.map((e) => (e.state === "attempt" ? { ...e, state: "check-only" as const } : e));
}

export function sendable(entries: OutboxEntry[], now: number, tenantId: string): OutboxEntry[] {
  return entries
    .filter((e) => e.tenantId === tenantId && e.state === "pending" && e.nextTryAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** True when new bills must take device queue numbers. Review and check-only entries do not count. */
export function deviceNumberedMode(
  entries: OutboxEntry[],
  tenantId: string,
  online: boolean,
): boolean {
  return !online || entries.some((e) => e.tenantId === tenantId && e.state === "pending");
}

export function backoffMs(tries: number): number {
  return Math.min(5000 * 2 ** Math.max(0, tries), 60000);
}

export function afterFailure(
  e: OutboxEntry,
  res: {
    outcome: "retry" | "review" | "refused";
    reviewCode?: ReviewCode;
    error: string;
    mayHaveSaved?: true;
  },
  now: number,
): OutboxEntry {
  if (res.outcome === "review" || res.outcome === "refused") {
    return { ...e, state: "review", reviewCode: res.reviewCode ?? "other", lastError: res.error };
  }
  if (res.error === GENERIC_ERROR && e.tries >= MAX_GENERIC_TRIES) {
    return { ...e, state: "review", reviewCode: "other", lastError: res.error };
  }
  return { ...e, tries: e.tries + 1, nextTryAt: now + backoffMs(e.tries), lastError: res.error };
}

export function counts(
  entries: OutboxEntry[],
  tenantId: string,
): { pending: number; review: number; checkOnly: number } {
  const mine = entries.filter((e) => e.tenantId === tenantId);
  return {
    pending: mine.filter((e) => e.state === "pending").length,
    review: mine.filter((e) => e.state === "review").length,
    checkOnly: mine.filter((e) => e.state === "check-only").length,
  };
}

/**
 * What still blocks closing the shift (ruling R24b): pending bills, and review bills that can still
 * be recorded. A review bill whose menu item was deleted (product_missing) can never be recorded,
 * so it is counted apart (`unrecordable`) and only warned about. Without a tenantId every shop's
 * bills count.
 */
export function closeBlockCounts(
  entries: OutboxEntry[],
  tenantId?: string,
): { pending: number; review: number; unrecordable: number } {
  const mine = tenantId === undefined ? entries : entries.filter((e) => e.tenantId === tenantId);
  const review = mine.filter((e) => e.state === "review");
  const unrecordable = review.filter((e) => e.reviewCode === "product_missing").length;
  return {
    pending: mine.filter((e) => e.state === "pending").length,
    review: review.length - unrecordable,
    unrecordable,
  };
}

type SaleKeyInput = Pick<
  OutboxEntry["input"],
  | "items"
  | "paymentMethod"
  | "orderType"
  | "customerId"
  | "discountType"
  | "discountValue"
  | "heldBillId"
  | "heldBillVersion"
>;

/**
 * The fields that make one sale, as the POS's saleInput() builds them (and the outbox stores
 * them): the same cart always gives the same key, whatever it is stored as.
 */
export function saleKey(i: SaleKeyInput): string {
  return JSON.stringify([
    i.items.map((it) => [
      it.productId,
      it.quantity,
      it.totalPrice,
      it.note ?? null,
      it.selectedModifiers.map((m) => m.optionId),
    ]),
    i.paymentMethod,
    i.orderType,
    i.customerId ?? null,
    i.discountType ?? null,
    i.discountValue ?? null,
    i.heldBillId ?? null,
    i.heldBillVersion ?? null,
  ]);
}

/**
 * Whether a cart restored after a reload may take over `draftRef`, the attempt ref its own draft
 * saved: only if that exact entry is still an unanswered online attempt (`attempt` / `check-only`)
 * of this shop and seller, for the same sale (key). Never by sale key alone: an identical cart
 * built for the next customer must not inherit an earlier customer's bill. Returns the ref or null.
 */
export function adoptableRef(
  draftRef: string | null | undefined,
  entries: OutboxEntry[],
  tenantId: string,
  sellerId: string,
  key: string,
): string | null {
  if (!draftRef) return null;
  const e = entries.find((x) => x.clientRef === draftRef);
  if (!e || e.tenantId !== tenantId || e.sellerId !== sellerId) return null;
  if (e.state !== "attempt" && e.state !== "check-only") return null;
  return saleKey(e.input) === key ? draftRef : null;
}

function isOrphan(e: OutboxEntry, now: number): boolean {
  return now - e.createdAt > ORPHAN_AFTER_MS;
}

/**
 * startupRecovery for this shop's attempts old enough that no tab can still be waiting on them.
 * Returns only the entries that changed (to write back).
 */
export function recoverOrphans(entries: OutboxEntry[], now: number, tenantId: string): OutboxEntry[] {
  return startupRecovery(
    entries.filter((e) => e.tenantId === tenantId && e.state === "attempt" && isOrphan(e, now)),
  );
}

/** This shop's check-only entries the sender may ask about now, oldest first. */
export function checkable(entries: OutboxEntry[], now: number, tenantId: string): OutboxEntry[] {
  return entries
    .filter((e) => e.tenantId === tenantId && e.state === "check-only" && isOrphan(e, now))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** This shop's review entries whose device queue number the server's counter hasn't yet covered. */
export function needsCounterRaise(entries: OutboxEntry[], tenantId: string): OutboxEntry[] {
  return entries
    .filter(
      (e) =>
        e.tenantId === tenantId && e.state === "review" && e.offline !== null && e.counterRaised !== true,
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The Bangkok business date of the sale: its sale time when known, else when it was put. */
export function saleBusinessDate(e: OutboxEntry): string {
  const sold = e.offline ? Date.parse(e.offline.soldAt) : Number.NaN;
  return bangkokToday(new Date(Number.isNaN(sold) ? e.createdAt : sold));
}

/** A pending entry without device data can't be sent: it goes to review instead. */
export function missingOfflineToReview(e: OutboxEntry): OutboxEntry {
  return { ...e, state: "review", reviewCode: "other", lastError: MISSING_OFFLINE_MESSAGE };
}

export type OutboxWork =
  | { kind: "send"; entry: OutboxEntry }
  | { kind: "check"; entry: OutboxEntry }
  | { kind: "raise"; entry: OutboxEntry };

/**
 * The sender's next job, from a fresh read of the store: the oldest due pending bill first, then
 * check-only entries, then counter raises. `tried` holds refs already handled in this burst, so a
 * check or raise that got no answer is not repeated until the next burst.
 */
export function nextWork(
  entries: OutboxEntry[],
  now: number,
  tenantId: string,
  tried: ReadonlySet<string>,
): OutboxWork | null {
  const send = sendable(entries, now, tenantId)[0];
  if (send) return { kind: "send", entry: send };
  const check = checkable(entries, now, tenantId).find((e) => !tried.has(e.clientRef));
  if (check) return { kind: "check", entry: check };
  const raise = needsCounterRaise(entries, tenantId).find((e) => !tried.has(e.clientRef));
  if (raise) return { kind: "raise", entry: raise };
  return null;
}

/**
 * Whether the sender should keep waking up (its 5 s interval) for this shop. An attempt counts:
 * a young one may turn into an orphan to recover.
 */
export function hasSenderWork(entries: OutboxEntry[], tenantId: string): boolean {
  return (
    entries.some((e) => e.tenantId === tenantId && e.state !== "review") ||
    needsCounterRaise(entries, tenantId).length > 0
  );
}
