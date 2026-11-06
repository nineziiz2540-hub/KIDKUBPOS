"use client";
import { useState, type ReactNode } from "react";
import { showSyncingBar } from "@/lib/connectivity";

type Progress = { sent: number; total: number };

type Props = {
  offline: boolean;
  /** The server has answered this page at least once (not just assumed online after a load). */
  confirmed: boolean;
  /** This shop's bills waiting on the device to be sent. */
  pendingCount: number;
  /** Bills sent in this burst against its total; null when this tab isn't sending. */
  progress: Progress | null;
  /** Bills just sent, for the green bar; null when it has hidden itself. */
  justFinished: number | null;
  /** Bills the server refused, waiting for the manager. */
  reviewCount: number;
  onOpenReview: () => void;
  updateAvailable: boolean;
  onRefresh: () => void;
  /** Bills whose queue number the server kept differently from the device's (spec call 15). */
  queueChanges?: { device: number; server: number }[];
};

const BAR = "flex shrink-0 items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-base font-semibold";

/**
 * Full-width bars at the top of the POS, one at a time: red (internet down) beats yellow (sending
 * bills) beats green (all sent) beats the update bar — while offline there is nothing to refresh
 * to. The review bar shows under any of them while refused bills wait for the manager.
 */
export function StatusBanners({
  offline,
  confirmed,
  pendingCount,
  progress,
  justFinished,
  reviewCount,
  onOpenReview,
  updateAvailable,
  onRefresh,
  queueChanges = [],
}: Props) {
  // Between two sending bursts (a bill waiting on its retry) the sender reports no progress; keep
  // showing the last count instead of letting the yellow bar flicker off and on.
  const [lastProgress, setLastProgress] = useState<Progress | null>(null);
  if (progress && (progress.sent !== lastProgress?.sent || progress.total !== lastProgress?.total)) {
    setLastProgress(progress);
  } else if (!progress && pendingCount === 0 && lastProgress !== null) {
    setLastProgress(null);
  }
  const syncing = showSyncingBar({ offline, confirmed, sending: progress !== null, pendingCount });
  const shown: Progress =
    progress ??
    (lastProgress && lastProgress.total - lastProgress.sent === pendingCount
      ? lastProgress
      : { sent: 0, total: pendingCount });

  let top: ReactNode = null;
  if (offline) {
    top = (
      <div role="alert" className={`${BAR} bg-destructive text-white`}>
        <span>⚠ เน็ตหลุด — บิลจะถูกเก็บไว้ในเครื่องก่อน · แจ้งผู้จัดการ</span>
        {pendingCount > 0 && (
          <span className="shrink-0 text-sm font-medium tabular-nums">ค้างส่ง {pendingCount} บิล</span>
        )}
      </div>
    );
  } else if (syncing) {
    top = (
      <div role="status" className={`${BAR} bg-warning text-sidebar`}>
        <span>⟳ เน็ตกลับมาแล้ว — กำลังส่งบิลขึ้นระบบ…</span>
        <span className="shrink-0 text-sm font-medium tabular-nums">
          {shown.sent} / {shown.total}
        </span>
      </div>
    );
  } else if (justFinished !== null) {
    top = (
      <div role="status" className={`${BAR} bg-success text-white`}>
        <span>✓ ส่งบิลครบแล้ว {justFinished} บิล</span>
        {queueChanges.length > 0 && (
          <span className="shrink-0 text-sm font-medium tabular-nums">
            {queueChanges.map((c) => `คิว ${c.device} → ${c.server}`).join(" · ")}
          </span>
        )}
      </div>
    );
  } else if (updateAvailable) {
    top = (
      <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl bg-sidebar px-4 py-2 text-base font-semibold text-white">
        <span>ระบบมีอัปเดตใหม่</span>
        <button
          type="button"
          onClick={onRefresh}
          className="h-10 rounded-lg bg-white px-4 text-base font-semibold text-sidebar hover:bg-white/90"
        >
          แตะเพื่อรีเฟรช
        </button>
      </div>
    );
  }

  if (top === null && reviewCount === 0) return null;
  return (
    <div className="mb-3 flex shrink-0 flex-col gap-2">
      {top}
      {reviewCount > 0 && (
        <button
          type="button"
          onClick={onOpenReview}
          className="flex h-11 shrink-0 items-center justify-between gap-3 rounded-xl border-2 border-warning bg-warning/10 px-4 text-left text-base font-semibold text-sidebar hover:bg-warning/20"
        >
          <span>บิลส่งไม่ผ่าน {reviewCount} บิล · ให้ผู้จัดการตรวจ</span>
          <span aria-hidden className="text-warning">›</span>
        </button>
      )}
    </div>
  );
}
