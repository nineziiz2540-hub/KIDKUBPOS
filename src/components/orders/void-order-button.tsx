"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { voidOrder, type VoidOrderState } from "@/app/actions/orders";
import { PinPad } from "@/components/ui/pin-pad";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const MAX_PIN_ATTEMPTS = 5;

export function VoidOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [attempts, setAttempts] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, action, pending] = useActionState<VoidOrderState, FormData>(
    voidOrder,
    undefined
  );

  // Synchronize local UI state with the latest action result. Handled during
  // render (React's "adjust state while rendering" pattern) rather than in a
  // useEffect, since we only want this to run once per distinct action result
  // and setting state synchronously inside an effect is disallowed by
  // react-hooks/set-state-in-effect.
  const [handledState, setHandledState] = useState<VoidOrderState>(undefined);
  if (state !== handledState) {
    setHandledState(state);
    if (state?.success) {
      setIsOpen(false);
    } else if (state?.error === "PIN ไม่ถูกต้อง") {
      const next = attempts + 1;
      if (next >= MAX_PIN_ATTEMPTS) {
        // Full reset, not just closing: reopening should give a fresh attempt
        // budget, not immediately re-trip the cap on the next wrong guess.
        setIsOpen(false);
        setReason("");
        setAttempts(0);
      } else {
        setAttempts(next);
      }
    }
  }

  // router.refresh() is a genuine side effect (re-fetches server data), so it
  // belongs in an effect rather than the render-time block above.
  useEffect(() => {
    if (state?.success) {
      router.refresh();
    }
  }, [state?.success, router]);

  function close() {
    setIsOpen(false);
    setReason("");
    setAttempts(0);
  }

  if (!isOpen) {
    return (
      <Button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full bg-white border border-destructive/40 text-destructive hover:bg-destructive/5"
      >
        ยกเลิกบิล
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4">
        <h2 className="text-lg font-bold text-sidebar text-center">ยกเลิกบิล</h2>

        <form ref={formRef} action={action} className="space-y-4">
          <input type="hidden" name="order_id" value={orderId} />
          <input type="hidden" name="pin" />

          <div className="space-y-1.5">
            <Label htmlFor="reason">เหตุผลที่ยกเลิก</Label>
            <textarea
              id="reason"
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={2}
              className="w-full rounded-md border border-input px-3 py-2 text-sm"
              placeholder="เช่น สั่งผิด, ลูกค้ายกเลิก"
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
                // Clear immediately after submit — FormData is captured synchronously
                // by requestSubmit, so this can't affect what was sent. Leaving the
                // real PIN sitting in the DOM after a wrong guess would let anyone
                // read it back out (devtools, or just view-source on a shared device).
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
