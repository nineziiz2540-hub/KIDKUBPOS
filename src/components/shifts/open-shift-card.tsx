"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkOpeningCount, startShift } from "@/app/actions/shifts";
import { differenceLabel, parseAmount, type CountComparison } from "@/lib/shift-math";
import { formatBaht } from "@/lib/order-history";
import { AmountInput } from "./amount-input";

type Step =
  | { kind: "count1" }
  | { kind: "count2"; first: number; firstResult: CountComparison }
  | { kind: "ready"; counts: number[]; result: CountComparison; recounted: boolean };

/**
 * Morning count before opening the shift. The number to compare with (what was left in the drawer
 * last night) is never on screen before the count: the server answers only after ตรวจยอด. A
 * mismatch asks for one recount; the recount is what the shift opens with.
 */
export function OpenShiftCard() {
  const router = useRouter();
  const inputId = useId();
  const noteId = useId();
  const [step, setStep] = useState<Step>({ kind: "count1" });
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function check() {
    const amount = parseAmount(value);
    if (amount === null) {
      setError("จำนวนเงินไม่ถูกต้อง");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await checkOpeningCount(amount);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      const result = res.difference;
      setValue("");
      if (step.kind === "count2") {
        setStep({ kind: "ready", counts: [step.first, amount], result, recounted: true });
      } else if (result.kind === "short" || result.kind === "over") {
        setStep({ kind: "count2", first: amount, firstResult: result });
      } else {
        setStep({ kind: "ready", counts: [amount], result, recounted: false });
      }
    });
  }

  function open() {
    if (step.kind !== "ready") return;
    setError(null);
    startTransition(async () => {
      const res = await startShift(step.counts, note.trim() === "" ? null : note);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const mismatchSaved =
    step.kind === "ready" && (step.result.kind === "short" || step.result.kind === "over");

  return (
    <div className="max-w-xl space-y-5 rounded-2xl border bg-white p-6">
      <h2 className="text-xl font-bold text-sidebar">นับเงินในลิ้นชักก่อนเปิดร้าน</h2>

      {step.kind === "count2" && (
        <p className="rounded-xl bg-warning/10 px-4 py-3 text-lg font-semibold text-warning">
          {differenceLabel(step.firstResult)} · นับอีกครั้ง
        </p>
      )}

      {step.kind !== "ready" && (
        <div className="space-y-3">
          <label htmlFor={inputId} className="text-base font-medium text-sidebar">
            {step.kind === "count2" ? "นับครั้งที่ 2" : "เงินสดที่นับได้"}
          </label>
          <AmountInput
            key={step.kind}
            id={inputId}
            value={value}
            onChange={setValue}
            autoFocus
            disabled={isPending}
          />
          <button
            type="button"
            onClick={check}
            disabled={isPending || value.trim() === ""}
            className="h-14 w-full rounded-xl bg-accent text-lg font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {isPending ? "กำลังตรวจ…" : "ตรวจยอด"}
          </button>
        </div>
      )}

      {step.kind === "ready" && (
        <div className="space-y-4">
          {step.result.kind === "match" && (
            <p className="rounded-xl bg-success/10 px-4 py-3 text-lg font-semibold text-success">
              {step.recounted ? "ตรงแล้ว ✓" : "ตรงกับเงินที่เหลือไว้เมื่อคืน ✓"}
            </p>
          )}
          {mismatchSaved && (
            <p className="rounded-xl bg-warning/10 px-4 py-3 text-lg font-semibold text-warning">
              {differenceLabel(step.result)} · บันทึกแล้ว
            </p>
          )}
          <p className="text-base text-muted-foreground">
            เงินตั้งต้นของกะนี้{" "}
            <span className="font-semibold tabular-nums text-sidebar">
              ฿{formatBaht(step.counts.at(-1) ?? 0)}
            </span>
          </p>
          {mismatchSaved && (
            <div className="space-y-1.5">
              <label htmlFor={noteId} className="text-base font-medium text-sidebar">
                หมายเหตุ (ไม่บังคับ)
              </label>
              <textarea
                id={noteId}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={200}
                placeholder="เช่น เหรียญหาย"
                className="w-full rounded-xl border border-input px-3 py-2 text-base"
              />
            </div>
          )}
          <button
            type="button"
            onClick={open}
            disabled={isPending}
            className="h-14 w-full rounded-xl bg-accent text-lg font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {isPending ? "กำลังเปิดกะ…" : "เปิดกะ"}
          </button>
        </div>
      )}

      {error && <p className="text-base font-medium text-destructive">{error}</p>}
    </div>
  );
}
