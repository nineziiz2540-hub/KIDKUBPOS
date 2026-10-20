"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { setTransferVerified } from "@/app/actions/order-adjustments";

type Props = { orderId: string; verified: boolean; canEdit: boolean };

/**
 * เจอเงินแล้ว tick used while walking the bank app. Owner/manager can toggle it (optimistic;
 * rolled back with a message if the server refuses). Everyone else only sees that it's ticked.
 */
export function TransferCheckToggle({ orderId, verified, canEdit }: Props) {
  const [optimistic, setOptimistic] = useOptimistic(verified);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return verified ? (
      <span className="inline-flex h-12 shrink-0 items-center gap-1 px-2 text-base font-semibold text-success">
        <Check size={18} /> ตรวจแล้ว
      </span>
    ) : null;
  }

  return (
    <div className="flex shrink-0 flex-col items-end">
      <button
        type="button"
        aria-pressed={optimistic}
        disabled={pending}
        onClick={() => {
          const next = !optimistic;
          setError(null);
          startTransition(async () => {
            setOptimistic(next);
            const result = await setTransferVerified(orderId, next);
            if (result.error) setError(result.error);
          });
        }}
        className={`inline-flex h-12 min-w-[150px] items-center justify-center gap-1 rounded-xl border px-3 text-base font-semibold transition-colors ${
          optimistic
            ? "border-success/40 bg-success/10 text-success"
            : "border-input bg-white text-sidebar hover:bg-muted"
        }`}
      >
        {optimistic ? (
          <>
            <Check size={18} /> เจอเงินแล้ว
          </>
        ) : (
          "เจอเงินแล้ว?"
        )}
      </button>
      {error && <p className="mt-1 max-w-[220px] text-right text-sm text-destructive">{error}</p>}
    </div>
  );
}
