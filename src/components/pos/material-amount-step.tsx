"use client";
// The amount step shared by "บันทึกของเสีย" (material) and "รับของเข้า" (round D2a, Tasks 11 and 12): the
// numeric keypad in the purchase unit (ขวด…) with chips ¼ ½ ¾, a switch to the use unit, and the
// "= N ml" line. The primary button sits in a fixed footer, so it is always in view at 1180x740.
import { useState, type ReactNode } from "react";
import { padPress, composeEntryQty } from "@/lib/stock/material-view";
import { receiveAmountToUseUnits } from "@/lib/stock/receive-input";
import type { WasteMaterial } from "@/lib/stock/waste-input";
import { DisabledReason, OFFLINE_REASON } from "./disabled-reason";
import { NumericKeypad } from "./numeric-keypad";

const FRACTIONS = [
  { value: 0.25, label: "¼" },
  { value: 0.5, label: "½" },
  { value: 0.75, label: "¾" },
] as const;

export const STEP_TAB = "h-14 flex-1 rounded-lg border-2 text-lg font-semibold transition-colors";
export const STEP_BACK = "h-14 shrink-0 rounded-lg border border-input bg-white px-5 text-base font-semibold text-sidebar hover:bg-muted";

export type AmountEntry = {
  /** The amount in the material's use unit (what the server stores). */
  qty: number;
  /** What was typed, in the entry unit ("6 ขวด"): the toast says it this way. */
  entry: number;
  entryUnit: string;
};

type Props = {
  material: WasteMaterial;
  /** The main button, e.g. "ต่อไป" or "บันทึกรับของ". */
  primaryLabel: string;
  onBack: () => void;
  onSubmit: (amount: AmountEntry) => void;
  /** Extra controls under the chips (the price field for a manager or owner). */
  extra?: ReactNode;
  /** A save is in flight: the button is off and says so. */
  busy?: boolean;
  error?: string | null;
  /** false = the connection is gone: the button is off and says why. Absent = always on. */
  online?: boolean;
};

export function MaterialAmountStep({ material, primaryLabel, onBack, onSubmit, extra, busy = false, error = null, online = true }: Props) {
  const hasPurchase = material.purchaseSize !== null && !!material.purchaseUnit;
  const [unit, setUnit] = useState<"purchase" | "use">(hasPurchase ? "purchase" : "use");
  const [pad, setPad] = useState("");
  const [fraction, setFraction] = useState<0 | 0.25 | 0.5 | 0.75>(0);
  const entry = composeEntryQty(pad, unit === "purchase" ? fraction : 0);
  const qty = receiveAmountToUseUnits(entry, unit, material);
  const valid = qty !== null && qty <= 100_000 && Math.round(qty * 1000) / 1000 === qty;
  const entryUnit = (unit === "purchase" ? material.purchaseUnit : material.unit) ?? material.unit;
  const shown = `${pad === "" ? "0" : pad}${unit === "purchase" && fraction ? ` + ${FRACTIONS.find((f) => f.value === fraction)?.label}` : ""}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* The body scrolls on a very short screen; the primary button below it never does (always in view). On a
          wide screen the keypad sits beside the controls, so the whole step is about 300 px tall. */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} disabled={busy} className={STEP_BACK}>กลับ</button>
        <p className="min-w-0 text-xl font-bold text-sidebar">{material.name}</p>
      </div>
      <div className="space-y-3 sm:grid sm:grid-cols-2 sm:items-start sm:gap-4 sm:space-y-0">
      <div className="space-y-3">
      {hasPurchase && (
        <div className="flex gap-2">
          {(
            [
              ["purchase", material.purchaseUnit],
              ["use", material.unit],
            ] as const
          ).map(([id, text]) => (
            <button
              key={id}
              type="button"
              aria-pressed={unit === id}
              onClick={() => { setUnit(id); setFraction(0); }}
              className={`${STEP_TAB} ${unit === id ? "border-accent bg-accent text-white" : "border-input bg-white text-sidebar hover:border-accent"}`}
            >
              {text}
            </button>
          ))}
        </div>
      )}
      <p className="text-center text-3xl font-bold text-sidebar tabular-nums">
        {shown} <span className="text-xl font-semibold text-muted-foreground">{entryUnit}</span>
      </p>
      {/* its line is always there, so the pad and the buttons never move when it comes and goes */}
      <p className="min-h-6 text-center text-base text-muted-foreground tabular-nums">
        {unit === "purchase" && qty !== null ? `= ${qty.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${material.unit}` : " "}
      </p>
      {unit === "purchase" && (
        <div className="flex gap-2">
          {FRACTIONS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={fraction === f.value}
              onClick={() => setFraction((cur) => (cur === f.value ? 0 : f.value))}
              className={`${STEP_TAB} ${fraction === f.value ? "border-accent bg-accent text-white" : "border-input bg-white text-sidebar hover:border-accent"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      {extra}
      </div>
      <NumericKeypad allowDecimal onKey={(k) => setPad((p) => padPress(p, k))} />
      </div>
      </div>
      {!online && <DisabledReason className="shrink-0" what={[primaryLabel]} reason={OFFLINE_REASON} />}
      {error && <p role="alert" className="shrink-0 rounded-lg bg-destructive/10 px-3 py-2 text-base font-semibold text-destructive">{error}</p>}
      <button
        type="button"
        disabled={!valid || busy || !online}
        onClick={() => qty !== null && onSubmit({ qty, entry, entryUnit })}
        className="h-14 shrink-0 rounded-lg bg-accent text-lg font-bold text-white disabled:bg-accent/40 disabled:cursor-not-allowed"
      >
        {busy ? "กำลังบันทึก…" : primaryLabel}
      </button>
    </div>
  );
}
