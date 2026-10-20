"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AdjustOrderState } from "@/app/actions/order-adjustments";
import { PinPad } from "@/components/ui/pin-pad";
import { Label } from "@/components/ui/label";

const MAX_PIN_ATTEMPTS = 5;

type Props = {
  orderId: string;
  /** Text on the button that opens the dialog. */
  triggerLabel: string;
  title: string;
  description?: ReactNode;
  reasonLabel: string;
  reasonPlaceholder: string;
  action: (prev: AdjustOrderState, formData: FormData) => Promise<AdjustOrderState>;
  /** Extra values sent with the form, e.g. { to_method: "transfer" }. */
  hiddenFields?: Record<string, string>;
  tone?: "danger" | "default";
};

const TRIGGER = {
  danger: "border border-destructive/40 bg-white text-destructive hover:bg-destructive/5",
  default: "border border-input bg-white text-sidebar hover:bg-muted",
};

/**
 * Reason + manager/owner PIN dialog shared by the bill-adjustment buttons. Same behaviour as
 * VoidOrderButton: the reason is required before the PIN pad unlocks, 5 wrong PINs close and
 * reset it, and the PIN never stays in the DOM after submitting.
 */
export function PinReasonDialog({
  orderId,
  triggerLabel,
  title,
  description,
  reasonLabel,
  reasonPlaceholder,
  action,
  hiddenFields,
  tone = "default",
}: Props) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [attempts, setAttempts] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [state, formAction, pending] = useActionState<AdjustOrderState, FormData>(
    action,
    undefined
  );

  // Adjust local state once per distinct action result (render-time pattern, as in
  // VoidOrderButton; setState inside an effect is disallowed by react-hooks/set-state-in-effect).
  const [handledState, setHandledState] = useState<AdjustOrderState>(undefined);
  if (state !== handledState) {
    setHandledState(state);
    if (state?.success) {
      setIsOpen(false);
      setReason("");
      setAttempts(0);
    } else if (state?.error === "PIN ไม่ถูกต้อง") {
      const next = attempts + 1;
      if (next >= MAX_PIN_ATTEMPTS) {
        setIsOpen(false);
        setReason("");
        setAttempts(0);
      } else {
        setAttempts(next);
      }
    }
  }

  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state?.success, router]);

  function close() {
    setIsOpen(false);
    setReason("");
    setAttempts(0);
  }

  const reasonId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`h-12 w-full rounded-xl px-4 text-base font-semibold transition-colors ${TRIGGER[tone]}`}
      >
        {triggerLabel}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-full w-full max-w-sm space-y-4 overflow-y-auto rounded-xl bg-white p-6">
            <h2 className="text-center text-xl font-bold text-sidebar">{title}</h2>
            {description && (
              <div className="text-center text-base text-muted-foreground">{description}</div>
            )}

            <form ref={formRef} action={formAction} className="space-y-4">
              <input type="hidden" name="order_id" value={orderId} />
              {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <input type="hidden" name="pin" />

              <div className="space-y-1.5">
                <Label htmlFor={reasonId} className="text-base">
                  {reasonLabel}
                </Label>
                <textarea
                  id={reasonId}
                  name="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  rows={2}
                  maxLength={500}
                  className="w-full rounded-lg border border-input px-3 py-2 text-base"
                  placeholder={reasonPlaceholder}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-base">PIN ของ Manager/Owner เพื่ออนุมัติ</Label>
                <PinPad
                  disabled={pending || reason.trim() === ""}
                  onComplete={(pin) => {
                    if (!formRef.current) return;
                    const hidden = formRef.current.elements.namedItem("pin") as HTMLInputElement;
                    hidden.value = pin;
                    formRef.current.requestSubmit();
                    // FormData is captured synchronously by requestSubmit; don't leave the PIN
                    // readable in the DOM afterwards.
                    hidden.value = "";
                  }}
                />
                {reason.trim() === "" && (
                  <p className="text-center text-sm text-muted-foreground">กรอกเหตุผลก่อนกดตัวเลข</p>
                )}
              </div>

              {state?.error !== undefined && (
                <p className="text-center text-base font-medium text-destructive">{state.error}</p>
              )}

              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="h-12 w-full rounded-xl border border-input bg-white text-base font-semibold text-sidebar hover:bg-muted disabled:opacity-50"
              >
                ปิด
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
