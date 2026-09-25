"use client";
import { useEffect, useState } from "react";
import { Delete } from "lucide-react";
import { Button } from "@/components/ui/button";
import { computeChange, MAX_CASH_RECEIVED, suggestCashAmounts, toSatang } from "@/lib/cash";

type Props = {
  total: number;
  pending: boolean;
  error: string | null;
  onConfirm: (cashReceived: number) => void;
  onCancel: () => void;
};

const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"] as const;

/** Appends one keypad key to the typed amount, rejecting anything that isn't a valid baht value. */
function applyKey(current: string, key: string): string {
  if (key === "back") return current.slice(0, -1);
  if (key === ".") {
    if (current.includes(".")) return current;
    return current === "" ? "0." : `${current}.`;
  }
  const [, decimals] = current.split(".");
  if (decimals !== undefined && decimals.length >= 2) return current;
  const next = current === "0" ? key : `${current}${key}`;
  if (Number(next) > MAX_CASH_RECEIVED) return current;
  return next;
}

function formatBaht(amount: number): string {
  return amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CashPaymentModal({ total, pending, error, onConfirm, onCancel }: Props) {
  const [typed, setTyped] = useState("");

  const received = typed === "" ? null : Number(typed);
  const change = received === null ? null : computeChange(total, received);
  const shortBy =
    received !== null && change === null
      ? (toSatang(total) - toSatang(received)) / 100
      : null;
  const canConfirm = change !== null && !pending;
  const suggestions = suggestCashAmounts(total);

  function confirm() {
    if (!canConfirm || received === null) return;
    onConfirm(received);
  }

  // Physical keyboard support for desktop/tablet-with-keyboard use.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (/^[0-9]$/.test(e.key) || e.key === ".") {
        setTyped((t) => applyKey(t, e.key));
      } else if (e.key === "Backspace") {
        setTyped((t) => applyKey(t, "back"));
      } else if (e.key === "Escape" && !pending) {
        onCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, onCancel]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-4 max-h-[95vh] overflow-y-auto">
        <div className="text-center">
          <h2 className="text-lg font-bold text-sidebar">รับเงินสด</h2>
          <p className="text-sm text-muted-foreground mt-1">ยอดที่ต้องชำระ</p>
          <p className="text-3xl font-bold text-sidebar tabular-nums">฿{formatBaht(total)}</p>
        </div>

        {/* Quick-tender buttons: set (not add) the received amount */}
        <div className="grid grid-cols-5 gap-2">
          <button
            type="button"
            onClick={() => setTyped((toSatang(total) / 100).toString())}
            disabled={pending}
            className="rounded-lg border-2 border-accent/40 bg-accent/10 py-3 text-sm font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            พอดี
          </button>
          {suggestions.map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => setTyped(amount.toString())}
              disabled={pending}
              className="rounded-lg border border-input bg-white py-3 text-sm font-semibold text-sidebar tabular-nums hover:bg-muted disabled:opacity-50"
            >
              ฿{amount.toLocaleString("th-TH")}
            </button>
          ))}
        </div>

        {/* Received amount */}
        <div className="rounded-lg border border-input bg-surface px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">รับเงินมา</span>
          <span className="text-2xl font-bold text-sidebar tabular-nums" aria-live="polite">
            {typed === "" ? "—" : `฿${typed}`}
          </span>
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2">
          {KEYPAD.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTyped((t) => applyKey(t, key))}
              disabled={pending}
              aria-label={key === "back" ? "ลบ" : key}
              className="rounded-lg border border-input bg-white py-3 text-xl font-semibold text-sidebar tabular-nums hover:bg-muted active:bg-muted disabled:opacity-50 flex items-center justify-center"
            >
              {key === "back" ? <Delete size={22} /> : key}
            </button>
          ))}
        </div>

        {/* Change / shortfall */}
        <div
          className={`rounded-lg px-4 py-3 flex items-center justify-between ${
            change !== null
              ? "bg-success/10 text-success"
              : shortBy !== null
                ? "bg-destructive/10 text-destructive"
                : "bg-muted text-muted-foreground"
          }`}
        >
          <span className="text-sm font-medium">
            {shortBy !== null ? "ยังขาดอีก" : "เงินทอน"}
          </span>
          <span className="text-3xl font-bold tabular-nums">
            {change !== null
              ? `฿${formatBaht(change)}`
              : shortBy !== null
                ? `฿${formatBaht(shortBy)}`
                : "—"}
          </span>
        </div>

        {error && (
          <p className="text-sm text-destructive font-medium text-center">{error}</p>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="flex-1 h-12 bg-white border border-input text-sidebar hover:bg-muted"
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={confirm}
            disabled={!canConfirm}
            className="flex-1 h-12 bg-accent hover:bg-accent/90 text-white text-base"
          >
            {pending ? "กำลังบันทึก…" : "ยืนยันรับเงิน"}
          </Button>
        </div>
      </div>
    </div>
  );
}
