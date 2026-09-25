"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { findOrCreateCustomer } from "@/app/actions/customers";
import { NumericKeypad } from "./numeric-keypad";

type Props = {
  onLinked: (customerId: string, phone: string) => void;
  onCancel: () => void;
};

// Thai numbers are 9 digits (landline) or 10 (mobile).
const MIN_DIGITS = 9;
const MAX_DIGITS = 10;

/** Formats 0812345678 as 081-234-5678 (and 021234567 as 02-123-4567) for readability. */
function formatPhone(digits: string): string {
  if (digits.length <= 3) return digits;
  if (digits.length === 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function MemberModal({ onLinked, onCancel }: Props) {
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleKey(key: string) {
    setError(null);
    if (key === "back") setDigits((d) => d.slice(0, -1));
    else if (/^[0-9]$/.test(key)) setDigits((d) => (d.length >= MAX_DIGITS ? d : d + key));
  }

  function save() {
    if (digits.length < MIN_DIGITS || pending) return;
    startTransition(async () => {
      // Phone doubles as the name so findOrCreateCustomer always has a non-empty name.
      const result = await findOrCreateCustomer({ phone: digits, name: digits });
      if ("error" in result) setError(result.error);
      else onLinked(result.customerId, digits);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
    >
      <div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-4">
        <h2 className="text-lg font-bold text-sidebar text-center">เบอร์สมาชิก</h2>
        <div className="rounded-lg border border-input bg-surface px-4 py-3 text-center">
          <span className="text-3xl font-bold text-sidebar tabular-nums tracking-wide">
            {digits === "" ? <span className="text-muted-foreground/50">0XX-XXX-XXXX</span> : formatPhone(digits)}
          </span>
        </div>
        <NumericKeypad onKey={handleKey} disabled={pending} />
        {error && <p className="text-sm text-destructive font-medium text-center">{error}</p>}
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="flex-1 h-12 bg-white border border-input text-sidebar text-base hover:bg-muted"
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={digits.length < MIN_DIGITS || pending}
            className="flex-1 h-12 bg-accent hover:bg-accent/90 text-white text-base"
          >
            {pending ? "กำลังค้นหา…" : "บันทึก"}
          </Button>
        </div>
      </div>
    </div>
  );
}
