"use client";

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Accessible name when there is no visible <label htmlFor={id}>. */
  ariaLabel?: string;
};

/**
 * Large baht amount box for counts and cash movements. Plain text with a decimal keyboard (not
 * type="number", which drops "1,000" and lets the wheel change the value); parseAmount in
 * src/lib/shift-math.ts reads what was typed.
 */
export function AmountInput({ id, value, onChange, autoFocus, disabled, ariaLabel }: Props) {
  return (
    <div className="flex h-16 items-center gap-2 rounded-xl border-2 border-input bg-white px-4 focus-within:border-accent">
      <span className="text-[22px] font-semibold text-muted-foreground">฿</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        className="h-full min-w-0 flex-1 bg-transparent text-right text-[26px] font-bold tabular-nums text-sidebar outline-none placeholder:text-muted-foreground/50 disabled:opacity-60"
      />
    </div>
  );
}
