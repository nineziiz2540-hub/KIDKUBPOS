"use client";
import { ReceiptQr } from "@/components/receipt/receipt-qr";
import { RECEIPT_QR_PENDING_NOTE } from "@/lib/receipt-link";

type Props = {
  queueNumber: number;
  /** Cash sales only (null for transfer). */
  cashReceived: number | null;
  changeAmount: number | null;
  /** Set once the bill has reached the system while this result is still on screen. */
  orderNumber?: string;
  /** The receipt link for this bill; the QR shows under the card text. */
  receiptUrl?: string | null;
};

/**
 * The cart's result after a sale stored on the device (round C2): the customer's queue number
 * right away; the bill number comes when the bill reaches the system.
 */
export function OfflineSaleResult({ queueNumber, cashReceived, changeAmount, orderNumber, receiptUrl }: Props) {
  const sent = orderNumber !== undefined;
  // With the receipt QR the card is a row (text | QR) and tighter: the cart's list is short on an
  // iPad, most of all with the offline bar up, and the QR must never need a scroll.
  const withQr = Boolean(receiptUrl);
  return (
    <div
      className={`mx-auto mb-3 max-w-full rounded-lg border ${
        withQr ? "flex w-full items-center justify-center gap-3 px-3 py-2" : "w-fit px-5 py-3"
      } ${sent ? "border-success bg-success/10" : "border-warning bg-warning/10"}`}
      role="status"
    >
      <div>
        <p className="text-5xl font-bold text-accent tabular-nums leading-none">คิว {queueNumber}</p>
        {sent ? (
          <>
            <p className="mt-2 text-base font-semibold text-sidebar">ส่งขึ้นระบบแล้ว ✓</p>
            <p className="text-sm text-muted-foreground tabular-nums">บิล {orderNumber}</p>
          </>
        ) : (
          <>
            <p className="mt-2 text-base font-semibold text-sidebar">บันทึกไว้ในเครื่องแล้ว ✓</p>
            <p className="text-sm text-muted-foreground">รอส่งขึ้นระบบเมื่อเน็ตกลับมา</p>
            <p className="text-sm text-muted-foreground">เลขบิลจะได้หลังส่งขึ้นระบบ</p>
          </>
        )}
        {cashReceived !== null && changeAmount !== null && (
          <div
            className={`mx-auto w-fit rounded-lg bg-success/10 text-success ${
              withQr ? "mt-2 px-3 py-1" : "mt-3 px-5 py-2.5"
            }`}
          >
            <p className="text-sm tabular-nums">รับเงิน ฿{cashReceived.toFixed(2)}</p>
            <p className="text-2xl font-bold tabular-nums">ทอน ฿{changeAmount.toFixed(2)}</p>
          </div>
        )}
      </div>
      {receiptUrl && (
        <ReceiptQr url={receiptUrl} size={120} note={sent ? null : RECEIPT_QR_PENDING_NOTE} />
      )}
    </div>
  );
}
