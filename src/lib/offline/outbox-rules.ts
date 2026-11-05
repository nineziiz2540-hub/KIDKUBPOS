// Pure rules for the offline outbox (bills saved on the device, sent later).
import type { CreateOrderInput, OfflineSale } from "../../types/app.ts";
import type { ReviewCode } from "./sync-outcome.ts";

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
};

export const MAX_GENERIC_TRIES = 20;
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
