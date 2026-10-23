"use client";

type Props = {
  offline: boolean;
  updateAvailable: boolean;
  onRefresh: () => void;
};

/**
 * Full-width bars at the top of the POS. "Internet down" wins: while offline there is nothing to
 * refresh to, so the update bar waits until the connection is back.
 */
export function StatusBanners({ offline, updateAvailable, onRefresh }: Props) {
  if (offline) {
    return (
      <div
        role="alert"
        className="mb-3 flex shrink-0 items-center gap-2 rounded-xl bg-destructive px-4 py-2.5 text-base font-semibold text-white"
      >
        ⚠ เน็ตหลุด — ยังชำระเงินไม่ได้ชั่วคราว · แจ้งผู้จัดการ
      </div>
    );
  }
  if (updateAvailable) {
    return (
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3 rounded-xl bg-sidebar px-4 py-2 text-base font-semibold text-white">
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
  return null;
}
