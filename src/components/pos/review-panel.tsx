"use client";
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { createOrder } from "@/app/actions/orders";
import { PinPad } from "@/components/ui/pin-pad";
import { formatPrice } from "@/lib/cash";
import { formatDateTime } from "@/lib/bangkok-time";
import { PAYMENT_DEADLINE_MS, withDeadline } from "@/lib/payment-attempt";
import type { OutboxEntry } from "@/lib/offline/outbox-rules";
import { REVIEW_MESSAGES } from "@/lib/offline/sync-outcome";
import type { SavedOrder } from "@/types/app";
import { deviceQueueOf } from "./outbox-sale";

const NO_ANSWER = "ไม่ได้รับคำตอบจากเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง";
const DEFAULT_REASON = "บันทึกตามยอดที่เก็บจริง";

/** Why the bill is in review, as the card shows it (lastError for "other" or an empty message). */
function reasonOf(e: OutboxEntry): string {
  const msg = e.reviewCode ? REVIEW_MESSAGES[e.reviewCode] : "";
  return msg || e.lastError || DEFAULT_REASON;
}

/** The reason the server logs with the override (R20), at most 500 characters. */
function overrideReason(e: OutboxEntry): string {
  const msg = e.reviewCode ? REVIEW_MESSAGES[e.reviewCode] : "";
  return (msg || e.lastError || DEFAULT_REASON).trim().slice(0, 500);
}

/**
 * The manager's list of bills the server refused (round C2, spec calls 6, 9, 10). Each card can be
 * recorded exactly as charged after a manager/owner PIN; there is deliberately no discard. The PIN
 * lives only in this component's call to createOrder and is never stored or shown.
 */
export function ReviewPanel({
  entries,
  online,
  remove,
  onRecorded,
  onClose,
}: {
  entries: OutboxEntry[];
  online: boolean;
  /** useOutbox's remove: drops the entry once the server has the bill. */
  remove(clientRef: string): Promise<void>;
  onRecorded(clientRef: string, saved: SavedOrder): void;
  onClose(): void;
}) {
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [recorded, setRecorded] = useState<string[]>([]);
  const busyLock = useRef(false);

  const pinEntry = entries.find((e) => e.clientRef === pinFor) ?? null;

  async function record(entry: OutboxEntry, approverPin: string) {
    if (busyLock.current || !entry.offline) return;
    busyLock.current = true;
    setPinFor(null);
    setBusyRef(entry.clientRef);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[entry.clientRef];
      return next;
    });
    try {
      const res = await withDeadline(
        createOrder({
          ...entry.input,
          clientRef: entry.clientRef,
          offline: entry.offline,
          override: { approverPin, reason: overrideReason(entry) },
        }),
        PAYMENT_DEADLINE_MS,
      );
      if ("error" in res) {
        setErrors((prev) => ({ ...prev, [entry.clientRef]: res.error }));
        return;
      }
      setRecorded((prev) => [...prev, res.orderNumber]);
      try {
        await remove(entry.clientRef);
      } catch {
        // The bill is saved; a leftover entry replays as already saved on its next send.
      }
      onRecorded(entry.clientRef, res);
    } catch {
      // No answer: the same clientRef replays, so trying again is safe.
      setErrors((prev) => ({ ...prev, [entry.clientRef]: NO_ANSWER }));
    } finally {
      busyLock.current = false;
      setBusyRef(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[92dvh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="text-lg font-bold text-sidebar">บิลที่ต้องตรวจ ({entries.length})</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="w-11 h-11 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted"
          >
            <X size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {recorded.map((n) => (
            <p
              key={n}
              className="rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-base font-medium text-success"
            >
              บันทึกแล้ว ({n})
            </p>
          ))}
          {entries.length === 0 && recorded.length === 0 && (
            <p className="text-center text-base text-muted-foreground py-10">ไม่มีบิลที่ต้องตรวจ</p>
          )}
          {entries.map((e) => {
            const queue = deviceQueueOf(e);
            const busy = busyRef === e.clientRef;
            const canRecord = e.reviewCode !== "product_missing";
            const error = errors[e.clientRef];
            return (
              <div key={e.clientRef} className="rounded-xl border border-border p-4 space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                  <span>
                    {formatDateTime(e.offline?.soldAt ?? new Date(e.createdAt).toISOString())}
                  </span>
                  {queue !== null && <span className="font-medium">คิว {queue}</span>}
                </div>
                <p className="text-base text-sidebar">{e.display.itemsText}</p>
                <p className="text-base font-bold text-sidebar">
                  ฿{formatPrice(e.display.total)} ·{" "}
                  {e.display.paymentMethod === "cash" ? "เงินสด" : "โอนเงิน"}
                </p>
                <p className="text-sm text-warning">{reasonOf(e)}</p>
                {canRecord && (
                  <>
                    <button
                      type="button"
                      disabled={!online || busyRef !== null}
                      onClick={() => setPinFor(e.clientRef)}
                      className="w-full min-h-12 rounded-lg bg-primary px-4 text-base font-medium text-primary-foreground disabled:opacity-50"
                    >
                      {busy ? "กำลังบันทึก..." : "บันทึกตามยอดที่เก็บจริง"}
                    </button>
                    {!online && (
                      <p className="text-sm text-muted-foreground">ใช้ไม่ได้ตอนเน็ตหลุด</p>
                    )}
                  </>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
            );
          })}
        </div>
      </div>

      {pinEntry && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPinFor(null);
          }}
        >
          <div className="bg-white rounded-xl w-full max-w-sm p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-base font-bold text-sidebar">PIN ของ Manager/Owner เพื่ออนุมัติ</p>
              <button
                type="button"
                onClick={() => setPinFor(null)}
                aria-label="ปิด"
                className="w-11 h-11 -mt-2 -mr-2 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted"
              >
                <X size={22} />
              </button>
            </div>
            <PinPad onComplete={(pin) => void record(pinEntry, pin)} />
          </div>
        </div>
      )}
    </div>
  );
}
