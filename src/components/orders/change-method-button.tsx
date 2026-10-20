"use client";

import { changePaymentMethod } from "@/app/actions/order-adjustments";
import { PinReasonDialog } from "@/components/orders/pin-reason-dialog";

const LABELS: Record<string, string> = { cash: "เงินสด", transfer: "โอน" };

type Props = {
  orderId: string;
  currentMethod: string;
  /** False when the bill's shift is already closed: its cash count is final. */
  shiftOpen: boolean;
};

export function ChangeMethodButton({ orderId, currentMethod, shiftOpen }: Props) {
  const toMethod = currentMethod === "cash" ? "transfer" : "cash";

  if (!shiftOpen) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          disabled
          className="h-12 w-full rounded-xl border border-input bg-white px-4 text-base font-semibold text-sidebar opacity-50"
        >
          แก้ช่องทางชำระ
        </button>
        <p className="text-center text-sm text-muted-foreground">
          กะของบิลนี้ปิดแล้ว แก้ช่องทางชำระไม่ได้
        </p>
      </div>
    );
  }

  return (
    <PinReasonDialog
      orderId={orderId}
      triggerLabel="แก้ช่องทางชำระ"
      title="แก้ช่องทางชำระ"
      description={
        <span className="text-lg font-semibold text-sidebar">
          {LABELS[currentMethod] ?? currentMethod} → {LABELS[toMethod]}
        </span>
      }
      reasonLabel="เหตุผล"
      reasonPlaceholder="เช่น ลูกค้าโอน แต่กดเป็นเงินสด"
      action={changePaymentMethod}
      hiddenFields={{ to_method: toMethod }}
    />
  );
}
