"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCashMovement } from "@/app/actions/shifts";
import {
  MAX_MOVEMENT,
  MOVEMENT_REASONS,
  NOTE_MAX,
  parseAmount,
  validateMovement,
  type MovementDirection,
  type MovementReason,
} from "@/lib/shift-math";
import { AmountInput } from "./amount-input";

const REASONS_BY_DIRECTION: Record<MovementDirection, [MovementReason, ...MovementReason[]]> = {
  in: ["personal_topup", "correction", "other_in"],
  out: ["purchase", "personal_return", "correction", "other_out"],
};

type Props = {
  shiftId: string;
  direction: MovementDirection;
  onClose: () => void;
};

/** Amount, one reason chip and an optional note (required for อื่นๆ / แก้รายการที่กดผิด). */
export function CashMovementDialog({ shiftId, direction, onClose }: Props) {
  const router = useRouter();
  const amountId = useId();
  const noteId = useId();
  const reasons = REASONS_BY_DIRECTION[direction];
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<MovementReason>(reasons[0]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const noteRequired = MOVEMENT_REASONS[reason].noteRequired;

  function save() {
    const parsed = parseAmount(amount, MAX_MOVEMENT);
    if (parsed === null) {
      setError("จำนวนเงินไม่ถูกต้อง");
      return;
    }
    const input = { shiftId, direction, reason, amount: parsed, note };
    const invalid = validateMovement(input);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addCashMovement(input);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${amountId}-title`}
        className="max-h-full w-full max-w-md space-y-5 overflow-y-auto rounded-2xl bg-white p-6"
      >
        <h2 id={`${amountId}-title`} className="text-center text-xl font-bold text-sidebar">
          {direction === "in" ? "＋ เงินเข้าลิ้นชัก" : "－ เงินออกลิ้นชัก"}
        </h2>

        <div className="space-y-1.5">
          <label htmlFor={amountId} className="text-base font-medium text-sidebar">
            จำนวนเงิน
          </label>
          <AmountInput id={amountId} value={amount} onChange={setAmount} autoFocus disabled={isPending} />
        </div>

        <div className="space-y-2">
          <p className="text-base font-medium text-sidebar">เหตุผล</p>
          <div className="flex flex-wrap gap-2">
            {reasons.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setReason(code)}
                aria-pressed={reason === code}
                className={`h-12 rounded-full border px-4 text-base font-medium transition-colors ${
                  reason === code
                    ? "border-sidebar bg-sidebar text-white"
                    : "border-input bg-white text-sidebar hover:bg-muted"
                }`}
              >
                {MOVEMENT_REASONS[code].label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={noteId} className="text-base font-medium text-sidebar">
            หมายเหตุ{noteRequired ? " (ต้องกรอก)" : " (ไม่บังคับ)"}
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={NOTE_MAX}
            placeholder={direction === "in" ? "เช่น แลกเหรียญมาเพิ่ม" : "เช่น น้ำแข็ง 2 ถุง"}
            className="w-full rounded-xl border border-input px-3 py-2 text-base"
          />
        </div>

        {error && <p className="text-center text-base font-medium text-destructive">{error}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="h-14 flex-1 rounded-xl border border-input bg-white text-lg font-semibold text-sidebar hover:bg-muted disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={save}
            disabled={isPending || amount.trim() === ""}
            className="h-14 flex-1 rounded-xl bg-accent text-lg font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {isPending ? "กำลังบันทึก…" : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}
