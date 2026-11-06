"use client";

type Props = {
  queueNumber: number;
  /** Cash sales only (null for transfer). */
  cashReceived: number | null;
  changeAmount: number | null;
  /** Set once the bill has reached the system while this result is still on screen. */
  orderNumber?: string;
};

/**
 * The cart's result after a sale stored on the device (round C2): the customer's queue number
 * right away; the bill number comes when the bill reaches the system.
 */
export function OfflineSaleResult({ queueNumber, cashReceived, changeAmount, orderNumber }: Props) {
  const sent = orderNumber !== undefined;
  return (
    <div
      className={`mx-auto mb-3 w-fit max-w-full rounded-lg border px-5 py-3 ${
        sent ? "border-success bg-success/10" : "border-warning bg-warning/10"
      }`}
      role="status"
    >
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
        <div className="mx-auto mt-3 w-fit rounded-lg bg-success/10 px-5 py-2.5 text-success">
          <p className="text-sm tabular-nums">รับเงิน ฿{cashReceived.toFixed(2)}</p>
          <p className="text-2xl font-bold tabular-nums">ทอน ฿{changeAmount.toFixed(2)}</p>
        </div>
      )}
    </div>
  );
}
