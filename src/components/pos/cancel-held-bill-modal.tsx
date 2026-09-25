"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PinPad } from "@/components/ui/pin-pad";
import { cancelHeldBill } from "@/app/actions/held-bills";

const QUICK_REASONS = ["ลูกค้ายกเลิก", "พักบิลซ้ำ", "สั่งผิด"];

type Props = {
  billId: string;
  queueNumber: number;
  customerLabel: string | null;
  onDone: () => void;
  onCancel: () => void;
};

/** Cancelling a parked, unpaid bill is the "delete it and pocket the cash" move, so it needs a
 *  reason and a Manager/Owner PIN — verified server-side, same as voiding a paid bill. */
export function CancelHeldBillModal({ billId, queueNumber, customerLabel, onDone, onCancel }: Props) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(pin: string) {
    setError(null);
    startTransition(async () => {
      const result = await cancelHeldBill(billId, reason.trim(), pin);
      if ("error" in result) setError(result.error);
      else onDone();
    });
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-4 max-h-[95dvh] overflow-y-auto">
        <div className="text-center">
          <h2 className="text-lg font-bold text-sidebar">ยกเลิกบิลพัก</h2>
          <p className="text-base text-muted-foreground">
            คิว {queueNumber}
            {customerLabel ? ` · ${customerLabel}` : ""}
          </p>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-sidebar">เหตุผล</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={`h-10 px-4 rounded-full border text-base font-medium transition-colors ${
                  reason === r
                    ? "border-accent bg-accent text-white"
                    : "border-input bg-white text-sidebar hover:border-accent"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="หรือพิมพ์เหตุผลเอง"
            aria-label="เหตุผลที่ยกเลิก"
            className="w-full h-12 rounded-lg border border-input px-3 text-base"
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-sidebar text-center">
            PIN ของ Manager/Owner เพื่ออนุมัติ
          </p>
          <PinPad disabled={reason.trim() === "" || pending} onComplete={submit} />
          {reason.trim() === "" && (
            <p className="text-sm text-muted-foreground text-center">เลือกหรือพิมพ์เหตุผลก่อนกด PIN</p>
          )}
        </div>
        {error && <p className="text-sm text-destructive font-medium text-center">{error}</p>}
        <Button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="w-full h-12 bg-white border border-input text-sidebar text-base hover:bg-muted"
        >
          ไม่ยกเลิก
        </Button>
      </div>
    </div>
  );
}
