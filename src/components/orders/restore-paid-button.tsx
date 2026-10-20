"use client";

import { restoreOrderPaid } from "@/app/actions/order-adjustments";
import { PinReasonDialog } from "@/components/orders/pin-reason-dialog";

export function RestorePaidButton({ orderId }: { orderId: string }) {
  return (
    <PinReasonDialog
      orderId={orderId}
      triggerLabel="ได้รับเงินแล้ว"
      title="ได้รับเงินแล้ว"
      description="บิลจะกลับมานับในยอดขายและยอดโอน แล้วอย่าลืมติ๊ก ‘เจอเงินแล้ว’ หลังเห็นเงินเข้าบัญชี"
      reasonLabel="เหตุผล"
      reasonPlaceholder="เช่น ลูกค้าโอนมาตอนเย็น"
      action={restoreOrderPaid}
    />
  );
}
