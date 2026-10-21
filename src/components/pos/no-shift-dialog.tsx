"use client";

type Props = {
  onGoToShifts: () => void;
  onPayByTransfer: () => void;
  onClose: () => void;
};

/** Shown instead of the cash modal when no shift is open: cash needs a counted drawer. */
export function NoShiftDialog({ onGoToShifts, onPayByTransfer, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="no-shift-title"
        className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 text-center"
      >
        <h2 id="no-shift-title" className="text-xl font-bold text-sidebar">
          ยังไม่ได้เปิดกะ
        </h2>
        <p className="text-base text-muted-foreground">ต้องเปิดกะก่อนรับเงินสด</p>
        <div className="space-y-2">
          <button
            type="button"
            onClick={onGoToShifts}
            className="h-14 w-full rounded-xl bg-accent text-lg font-semibold text-white hover:bg-accent/90"
          >
            ไปเปิดกะ
          </button>
          <button
            type="button"
            onClick={onPayByTransfer}
            className="h-14 w-full rounded-xl border border-input bg-white text-lg font-semibold text-sidebar hover:bg-muted"
          >
            ชำระด้วยโอนแทน
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-12 w-full rounded-xl text-base font-medium text-muted-foreground hover:bg-muted"
          >
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
