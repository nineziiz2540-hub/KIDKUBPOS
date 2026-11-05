"use client";

type Props = {
  queueNumber: number;
  /** Cash sales only (null for transfer). */
  cashReceived: number | null;
  changeAmount: number | null;
};

/**
 * The cart's result after a sale stored on the device (round C2): the customer's queue number
 * right away; the bill number comes when the bill reaches the system.
 */
export function OfflineSaleResult({ queueNumber, cashReceived, changeAmount }: Props) {
  return (
    <div className="mx-auto mb-3 w-fit max-w-full rounded-lg border border-warning bg-warning/10 px-5 py-3" role="status">
      <p className="text-5xl font-bold text-accent tabular-nums leading-none">คิว {queueNumber}</p>
      <p className="mt-2 text-base font-semibold text-sidebar">บันทึกไว้ในเครื่องแล้ว ✓</p>
      <p className="text-sm text-muted-foreground">รอส่งขึ้นระบบเมื่อเน็ตกลับมา</p>
      <p className="text-sm text-muted-foreground">เลขบิลจะได้หลังส่งขึ้นระบบ</p>
      {cashReceived !== null && changeAmount !== null && (
        <div className="mx-auto mt-3 w-fit rounded-lg bg-success/10 px-5 py-2.5 text-success">
          <p className="text-sm tabular-nums">รับเงิน ฿{cashReceived.toFixed(2)}</p>
          <p className="text-2xl font-bold tabular-nums">ทอน ฿{changeAmount.toFixed(2)}</p>
        </div>
      )}
    </div>
  );
}
