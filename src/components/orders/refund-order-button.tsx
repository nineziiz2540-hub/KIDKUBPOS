"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { refundOrder, type RefundOrderState } from "@/app/actions/orders";
import { PinPad } from "@/components/ui/pin-pad";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const MAX_PIN_ATTEMPTS = 5;

type RefundMethod = "cash" | "transfer" | "card";

const REFUND_METHODS: { value: RefundMethod; label: string }[] = [
  { value: "cash", label: "เงินสด" },
  { value: "transfer", label: "โอน" },
  { value: "card", label: "บัตร" },
];

export function RefundOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [refundMethod, setRefundMethod] = useState<RefundMethod>("cash");
  const [reason, setReason] = useState("");
  const [attempts, setAttempts] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, action, pending] = useActionState<RefundOrderState, FormData>(
    refundOrder,
    undefined
  );

  const [handledState, setHandledState] = useState<RefundOrderState>(undefined);
  if (state !== handledState) {
    setHandledState(state);
    if (state?.success) {
      setIsOpen(false);
    } else if (state?.error === "PIN ไม่ถูกต้อง") {
      const next = attempts + 1;
      if (next >= MAX_PIN_ATTEMPTS) {
        setIsOpen(false);
        setReason("");
        setRefundMethod("cash");
        setAttempts(0);
      } else {
        setAttempts(next);
      }
    }
  }

  useEffect(() => {
    if (state?.success) {
      router.refresh();
    }
  }, [state?.success, router]);

  function close() {
    setIsOpen(false);
    setReason("");
    setRefundMethod("cash");
    setAttempts(0);
  }

  if (!isOpen) {
    return (
      <Button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full bg-white border border-destructive/40 text-destructive hover:bg-destructive/5"
      >
        คืนเงิน
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4">
        <h2 className="text-lg font-bold text-sidebar text-center">คืนเงิน</h2>

        <form ref={formRef} action={action} className="space-y-4">
          <input type="hidden" name="order_id" value={orderId} />
          <input type="hidden" name="refund_method" value={refundMethod} />
          <input type="hidden" name="pin" />

          <div className="space-y-1.5">
            <Label>วิธีคืนเงิน</Label>
            <div className="flex gap-2">
              {REFUND_METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setRefundMethod(m.value)}
                  className={`flex-1 rounded-md border py-1.5 text-xs font-medium transition-colors ${
                    refundMethod === m.value
                      ? "border-accent bg-accent text-white"
                      : "border-input text-muted-foreground hover:border-accent hover:text-accent"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="refund-reason">เหตุผลที่คืนเงิน</Label>
            <textarea
              id="refund-reason"
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={2}
              className="w-full rounded-md border border-input px-3 py-2 text-sm"
              placeholder="เช่น ลูกค้าไม่พอใจสินค้า, สั่งผิด"
            />
          </div>

          <div className="space-y-1.5">
            <Label>PIN ของ Manager/Owner เพื่ออนุมัติ</Label>
            <PinPad
              disabled={pending || reason.trim() === ""}
              onComplete={(pin) => {
                if (!formRef.current) return;
                const hidden = formRef.current.elements.namedItem(
                  "pin"
                ) as HTMLInputElement;
                hidden.value = pin;
                formRef.current.requestSubmit();
                // Clear immediately after submit — FormData is captured synchronously by
                // requestSubmit, so this can't affect what was sent. Matches void-order-button's
                // existing convention: leaving the real PIN in the DOM after a wrong guess would
                // let anyone read it back out on a shared device.
                hidden.value = "";
              }}
            />
            {reason.trim() === "" && (
              <p className="text-xs text-muted-foreground text-center">
                กรอกเหตุผลก่อนกดตัวเลข
              </p>
            )}
          </div>

          {state?.error !== undefined && (
            <p className="text-sm text-destructive font-medium text-center">
              {state.error}
            </p>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={close}
            disabled={pending}
            className="w-full"
          >
            ยกเลิก
          </Button>
        </form>
      </div>
    </div>
  );
}
