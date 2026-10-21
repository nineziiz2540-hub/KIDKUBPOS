"use client";

import { useState } from "react";
import { formatTime } from "@/lib/bangkok-time";
import { formatBaht } from "@/lib/order-history";
import { MOVEMENT_REASONS, type MovementDirection, type MovementReason } from "@/lib/shift-math";
import { CashMovementDialog } from "./cash-movement-dialog";

export type MovementRow = {
  id: string;
  direction: MovementDirection;
  reason: string;
  amount: number;
  note: string | null;
  createdAt: string;
  createdByName: string;
};

type Props = {
  shiftId: string;
  movements: MovementRow[];
  personalOutstanding: number;
};

function reasonLabel(reason: string): string {
  return Object.hasOwn(MOVEMENT_REASONS, reason)
    ? MOVEMENT_REASONS[reason as MovementReason].label
    : reason;
}

/** The two drawer buttons, the personal-money reminder and this shift's movements. */
export function ShiftMovements({ shiftId, movements, personalOutstanding }: Props) {
  const [dialog, setDialog] = useState<MovementDirection | null>(null);

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setDialog("in")}
          className="h-14 rounded-xl border border-input bg-white text-lg font-semibold text-sidebar hover:bg-muted"
        >
          ＋ เงินเข้าลิ้นชัก
        </button>
        <button
          type="button"
          onClick={() => setDialog("out")}
          className="h-14 rounded-xl border border-input bg-white text-lg font-semibold text-sidebar hover:bg-muted"
        >
          － เงินออกลิ้นชัก
        </button>
      </div>

      {personalOutstanding > 0 && (
        <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-base font-semibold text-warning">
          เงินส่วนตัวยังอยู่ในลิ้นชัก ฿{formatBaht(personalOutstanding)}
        </p>
      )}

      {movements.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border bg-white">
          {movements.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-base font-medium text-sidebar">
                  <span className="tabular-nums">{formatTime(m.createdAt)}</span> ·{" "}
                  {reasonLabel(m.reason)}
                </p>
                <p className="truncate text-[15px] text-muted-foreground">
                  {m.note ? `${m.note} · ` : ""}โดย {m.createdByName}
                </p>
              </div>
              <p
                className={`shrink-0 text-lg font-bold tabular-nums ${
                  m.direction === "in" ? "text-success" : "text-destructive"
                }`}
              >
                {m.direction === "in" ? "+" : "−"}฿{formatBaht(m.amount)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {dialog && (
        <CashMovementDialog shiftId={shiftId} direction={dialog} onClose={() => setDialog(null)} />
      )}
    </section>
  );
}
