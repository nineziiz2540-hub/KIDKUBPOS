"use client";
import { DisabledReason } from "./disabled-reason";

/**
 * บันทึกไว้ในเครื่อง in a payment window (round C2, spec goal 11): after a try got no answer the
 * cashier can store the bill on the device instead of keeping the customer waiting.
 */
export function SaveToDeviceButton({
  onSave,
  disabledReason,
  pending,
}: {
  onSave: () => void;
  disabledReason: string | null;
  pending: boolean;
}) {
  const disabled = disabledReason !== null || pending;
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => {
          if (!disabled) onSave();
        }}
        disabled={disabled}
        className={`h-12 w-full rounded-lg border-2 text-base font-semibold transition-colors ${
          disabledReason !== null
            ? "border-transparent bg-muted text-muted-foreground"
            : "border-accent bg-white text-accent hover:bg-accent/10 disabled:opacity-50"
        }`}
      >
        บันทึกไว้ในเครื่อง
      </button>
      {disabledReason !== null && <DisabledReason reason={disabledReason} />}
    </div>
  );
}
