"use client";

import { markOrderUnpaid } from "@/app/actions/order-adjustments";
import { PinReasonDialog } from "@/components/orders/pin-reason-dialog";

export function MarkUnpaidButton({ orderId }: { orderId: string }) {
  return (
    <PinReasonDialog
      orderId={orderId}
      triggerLabel="ไม่ได้รับเงิน"
      title="แจ้งว่าไม่ได้รับเงิน"
      description="บิลนี้จะไม่นับในยอดขายและยอดโอน แต่ยังเก็บไว้ในประวัติ เปลี่ยนกลับได้ถ้าลูกค้าโอนมาทีหลัง"
      reasonLabel="เหตุผล"
      reasonPlaceholder="เช่น ไม่พบยอดโอนในบัญชี"
      action={markOrderUnpaid}
      tone="danger"
    />
  );
}
