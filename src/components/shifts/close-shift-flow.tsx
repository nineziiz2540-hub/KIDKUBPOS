"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finishShift, recordClosingCount } from "@/app/actions/shifts";
import {
  MAX_FLOAT,
  NOTE_MAX,
  compareCount,
  depositFor,
  differenceLabel,
  formatMoney,
  parseAmount,
  planFloat,
  type CountComparison,
} from "@/lib/shift-math";
import { shiftErrorMessage } from "@/lib/shift-errors";
import { AmountInput } from "./amount-input";

/** What finishShift returns when cash moved after the latest count (shift_close's expected_changed). */
const EXPECTED_CHANGED = shiftErrorMessage("expected_changed");

export type ClosingResult = {
  attempt: number;
  counted: number;
  expected: number;
  difference: CountComparison;
};

export type ClosingStartStep = "idle" | "count1" | "count2" | "recount_changed" | "float";

type OpenHeld = { id: string; queueNumber: number; customerLabel: string | null; total: number };

type Props = {
  shiftId: string;
  /** Where to start, decided on the server from the saved closing counts (closingStep). */
  initialStep: ClosingStartStep;
  /** The latest saved count and what it was compared with; null before the first count. */
  lastResult: ClosingResult | null;
  floatDefault: number;
  openHeld: OpenHeld[];
  personalOutstanding: number;
};

type Step = "idle" | "held" | "count1" | "count2" | "recount_changed" | "float";

/**
 * Blind closing count. Step ก asks for the count with no expected amount on screen; the server
 * records it before answering, so the first number typed can never be replaced. A mismatch asks
 * for one recount; cash moving while counting asks for a fresh count. Step ข splits the count into
 * the float left for tomorrow and the bank deposit.
 */
export function CloseShiftFlow({
  shiftId,
  initialStep,
  lastResult,
  floatDefault,
  openHeld,
  personalOutstanding,
}: Props) {
  const router = useRouter();
  const countId = useId();
  const floatId = useId();
  const noteId = useId();
  const [step, setStep] = useState<Step>(initialStep);
  const [result, setResult] = useState<ClosingResult | null>(lastResult);
  const [value, setValue] = useState("");
  const [floatValue, setFloatValue] = useState(() =>
    lastResult ? String(planFloat(lastResult.counted, floatDefault).floatLeft) : ""
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const heldTotal = openHeld.reduce((sum, b) => sum + b.total, 0);

  function begin() {
    setError(null);
    setStep(openHeld.length > 0 ? "held" : "count1");
  }

  function check() {
    const amount = parseAmount(value);
    if (amount === null) {
      setError("จำนวนเงินไม่ถูกต้อง");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await recordClosingCount(shiftId, amount);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setValue("");
      setResult(res);
      setFloatValue(String(planFloat(res.counted, floatDefault).floatLeft));
      // Same rule as the database's shift_close: a match, or at least the second count.
      setStep(res.difference.kind === "match" || res.attempt >= 2 ? "float" : "count2");
    });
  }

  function finish() {
    if (!result) return;
    const floatLeft = parseAmount(floatValue, MAX_FLOAT);
    if (floatLeft === null || depositFor(result.counted, floatLeft) === null) {
      setError("เงินทอนที่เก็บไว้ต้องไม่เกินยอดที่นับได้");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await finishShift(shiftId, floatLeft, note.trim() === "" ? null : note);
      if ("error" in res) {
        if (res.error === EXPECTED_CHANGED) {
          setStep("recount_changed");
          setValue("");
          router.refresh(); // show the movement/sale that changed the drawer
          return;
        }
        setError(res.error);
        return;
      }
      router.push(`/shifts?closed=${shiftId}`);
    });
  }

  if (step === "idle") {
    return (
      <section className="space-y-3 rounded-2xl border bg-white p-5">
        <h2 className="text-lg font-bold text-sidebar">ปิดกะ</h2>
        {personalOutstanding > 0 && <PersonalWarning amount={personalOutstanding} />}
        <button
          type="button"
          onClick={begin}
          className="h-14 w-full rounded-xl bg-accent text-lg font-semibold text-white hover:bg-accent/90"
        >
          ปิดกะ
        </button>
      </section>
    );
  }

  const mismatch = result !== null && result.difference.kind !== "match";
  const counting = step === "count1" || step === "count2" || step === "recount_changed";
  const deposit = result ? depositFor(result.counted, parseAmount(floatValue, MAX_FLOAT) ?? -1) : null;
  const plan = result ? planFloat(result.counted, floatDefault) : null;
  const floatEdited = parseAmount(floatValue, MAX_FLOAT) !== floatDefault;

  return (
    <section className="space-y-4 rounded-2xl border bg-white p-5">
      <h2 className="text-lg font-bold text-sidebar">ปิดกะ</h2>

      {step === "held" && (
        <div className="space-y-3">
          <div className="space-y-1 rounded-xl border border-warning/30 bg-warning/10 p-3 text-base">
            <p className="font-semibold text-warning">
              บิลค้างจ่าย {openHeld.length} บิล · {formatMoney(heldTotal)}
            </p>
            <p className="text-muted-foreground">ยังไม่นับเป็นยอดขาย และไม่อยู่ในเงินสดของกะนี้</p>
            <ul className="pt-1 text-sidebar">
              {openHeld.map((b) => (
                <li key={b.id}>
                  คิว {b.queueNumber}
                  {b.customerLabel ? ` · ${b.customerLabel}` : ""} — {formatMoney(b.total)}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-base font-medium text-sidebar">
            ยืนยันปิดกะทั้งที่ยังมีบิลค้างจ่าย? บิลเหล่านี้จะยังค้างอยู่ในระบบ
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep("idle")}
              className="h-12 flex-1 rounded-xl border border-input bg-white text-base font-semibold text-sidebar hover:bg-muted"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() => setStep("count1")}
              className="h-12 flex-1 rounded-xl bg-accent text-base font-semibold text-white hover:bg-accent/90"
            >
              ปิดกะต่อ
            </button>
          </div>
        </div>
      )}

      {counting && personalOutstanding > 0 && <PersonalWarning amount={personalOutstanding} />}

      {step === "count2" && result && (
        <>
          <ResultLines result={result} />
          <p className="rounded-xl bg-warning/10 px-4 py-3 text-lg font-semibold text-warning">
            {differenceLabel(result.difference)} · นับอีกครั้ง
          </p>
        </>
      )}
      {step === "recount_changed" && (
        <p className="rounded-xl bg-warning/10 px-4 py-3 text-lg font-semibold text-warning">
          มีรายการเงินสดใหม่ระหว่างนับ · นับอีกครั้ง
        </p>
      )}

      {counting && (
        <div className="space-y-3">
          <label htmlFor={countId} className="text-base font-medium text-sidebar">
            {step === "count1" ? "นับเงินสดทั้งหมดในลิ้นชัก" : "นับอีกครั้ง"}
          </label>
          <AmountInput
            key={`${step}-${result?.attempt ?? 0}`}
            id={countId}
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

      {step === "float" && result && plan && (
        <div className="space-y-4">
          <ResultLines result={result} />
          {mismatch ? (
            <p className="rounded-xl bg-warning/10 px-4 py-3 text-lg font-semibold text-warning">
              {differenceLabel(result.difference)} · บันทึกแล้ว
            </p>
          ) : (
            <p className="rounded-xl bg-success/10 px-4 py-3 text-lg font-semibold text-success">
              ตรงแล้ว ✓
            </p>
          )}

          <div className="space-y-1.5">
            <label htmlFor={floatId} className="text-base font-medium text-sidebar">
              เก็บไว้เป็นเงินทอนพรุ่งนี้
            </label>
            <AmountInput id={floatId} value={floatValue} onChange={setFloatValue} disabled={isPending} />
            {floatEdited && (
              <p className="text-[15px] text-muted-foreground">
                ค่าปกติของร้าน {formatMoney(floatDefault)}
              </p>
            )}
          </div>
          {plan.shortfall > 0 && (
            <p className="rounded-xl bg-warning/10 px-4 py-3 text-base font-semibold text-warning">
              เงินทอนขาดอีก {formatMoney(plan.shortfall)} · เติมก่อนเปิดร้าน
            </p>
          )}
          <div className="flex items-baseline justify-between gap-3 rounded-xl bg-muted px-4 py-3">
            <p className="text-base font-semibold text-sidebar">นำไปฝากธนาคาร</p>
            <p className="text-[22px] font-bold tabular-nums text-sidebar">
              {deposit === null ? "—" : formatMoney(deposit)}
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={noteId} className="text-base font-medium text-sidebar">
              หมายเหตุ (ไม่บังคับ)
            </label>
            <textarea
              id={noteId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={NOTE_MAX}
              placeholder={mismatch ? "เช่น ทอนเกินลูกค้า" : ""}
              className="w-full rounded-xl border border-input px-3 py-2 text-base"
            />
          </div>

          <button
            type="button"
            onClick={finish}
            disabled={isPending || deposit === null}
            className="h-14 w-full rounded-xl bg-accent text-lg font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {isPending ? "กำลังปิดกะ…" : "ยืนยันปิดกะ"}
          </button>
        </div>
      )}

      {error && <p className="text-base font-medium text-destructive">{error}</p>}
    </section>
  );
}

function ResultLines({ result }: { result: ClosingResult }) {
  const diff = compareCount(result.counted, result.expected);
  return (
    <dl className="space-y-1.5 rounded-xl border px-4 py-3 text-base">
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">นับได้</dt>
        <dd className="font-semibold tabular-nums text-sidebar">{formatMoney(result.counted)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">ระบบคิดว่าควรมี</dt>
        <dd className="font-semibold tabular-nums text-sidebar">{formatMoney(result.expected)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted-foreground">ส่วนต่าง</dt>
        <dd
          className={`font-bold tabular-nums ${
            diff.kind === "short"
              ? "text-destructive"
              : diff.kind === "over"
                ? "text-warning"
                : "text-success"
          }`}
        >
          {differenceLabel(diff)}
        </dd>
      </div>
    </dl>
  );
}

function PersonalWarning({ amount }: { amount: number }) {
  return (
    <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-base font-semibold text-warning">
      เงินส่วนตัวยังอยู่ในลิ้นชัก {formatMoney(amount)}
    </p>
  );
}
