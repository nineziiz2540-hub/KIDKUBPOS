"use client";
import { useState } from "react";
import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";

export function PinPad({
  length = 6,
  onComplete,
  disabled,
}: {
  length?: number;
  onComplete: (pin: string) => void;
  disabled?: boolean;
}) {
  const [digits, setDigits] = useState<string[]>([]);

  function pressDigit(d: string) {
    if (disabled || digits.length >= length) return;
    const next = [...digits, d];
    setDigits(next);
    if (next.length === length) {
      onComplete(next.join(""));
      setDigits([]);
    }
  }

  function backspace() {
    if (disabled) return;
    setDigits((prev) => prev.slice(0, -1));
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex gap-3">
        {Array.from({ length }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "size-3.5 rounded-full border-2 border-sidebar/30",
              i < digits.length && "bg-sidebar border-sidebar"
            )}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled}
            onClick={() => pressDigit(d)}
            className="size-14 rounded-full text-xl font-medium text-sidebar hover:bg-muted/40 active:bg-muted/60 disabled:opacity-50 transition-colors"
          >
            {d}
          </button>
        ))}
        <div />
        <button
          type="button"
          disabled={disabled}
          onClick={() => pressDigit("0")}
          className="size-14 rounded-full text-xl font-medium text-sidebar hover:bg-muted/40 active:bg-muted/60 disabled:opacity-50 transition-colors"
        >
          0
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={backspace}
          className="size-14 rounded-full flex items-center justify-center text-sidebar hover:bg-muted/40 active:bg-muted/60 disabled:opacity-50 transition-colors"
        >
          <Delete size={20} />
        </button>
      </div>
    </div>
  );
}
