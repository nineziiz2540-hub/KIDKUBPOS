"use client";
import { Delete } from "lucide-react";

type Props = {
  onKey: (key: string) => void;
  /** Show a "." key (money amounts); phone numbers leave that slot empty. */
  allowDecimal?: boolean;
  disabled?: boolean;
};

/**
 * On-screen number pad shared by the POS modals (cash tender, member phone, discount), so every
 * number entry on the counter iPad looks and feels the same and never pops the system keyboard
 * over the modal. Emits "0"-"9", "." and "back"; the caller owns the typed string.
 */
export function NumericKeypad({ onKey, allowDecimal = false, disabled = false }: Props) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", allowDecimal ? "." : "", "0", "back"];
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((key, i) =>
        key === "" ? (
          <span key={`blank-${i}`} aria-hidden />
        ) : (
          <button
            key={key}
            type="button"
            onClick={() => onKey(key)}
            disabled={disabled}
            aria-label={key === "back" ? "ลบ" : key}
            className="h-14 rounded-lg border border-input bg-white text-2xl font-semibold text-sidebar tabular-nums hover:bg-muted active:bg-muted disabled:opacity-50 flex items-center justify-center"
          >
            {key === "back" ? <Delete size={24} /> : key}
          </button>
        )
      )}
    </div>
  );
}
