"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PinPad } from "@/components/ui/pin-pad";
import { formatPrice } from "@/lib/cash";
import { computeDiscount, type DiscountType } from "@/lib/discount";
import { NumericKeypad } from "./numeric-keypad";

type Props = {
  subtotal: number;
  initialType: DiscountType | null;
  initialValue: string;
  initialReason: string;
  /** pin is null when the discount is under the approval threshold. */
  onApply: (type: DiscountType, value: string, reason: string, pin: string | null) => void;
  onCancel: () => void;
};

// The shop's most-used discounts (asked 2026-09-25): one tap each.
const QUICK: { type: DiscountType; value: string; label: string }[] = [
  { type: "percent", value: "5", label: "5%" },
  { type: "amount", value: "70", label: "฿70" },
];

const QUICK_REASONS = ["ลูกค้าประจำ", "โปรโมชั่น", "ชดเชยลูกค้า"];

/** Same entry rules as the cash modal: one ".", at most 2 decimals, no leading zeros. */
function applyKey(current: string, key: string, max: number): string {
  if (key === "back") return current.slice(0, -1);
  if (key === ".") {
    if (current.includes(".")) return current;
    return current === "" ? "0." : `${current}.`;
  }
  const [, decimals] = current.split(".");
  if (decimals !== undefined && decimals.length >= 2) return current;
  const next = current === "0" ? key : `${current}${key}`;
  if (Number(next) > max) return current;
  return next;
}

export function DiscountModal({
  subtotal,
  initialType,
  initialValue,
  initialReason,
  onApply,
  onCancel,
}: Props) {
  const [type, setType] = useState<DiscountType>(initialType ?? "percent");
  const [typed, setTyped] = useState(initialValue);
  const [step, setStep] = useState<"amount" | "approval">("amount");
  const [reason, setReason] = useState(initialReason);

  // Input is capped at the ceiling for each type, so "over 100%" / "more than the bill" can't be
  // typed at all rather than being shown as an error afterwards.
  const max = type === "percent" ? 100 : subtotal;
  const value = Number(typed);
  const valid = typed !== "" && Number.isFinite(value) && value > 0 && value <= max;
  const { discountAmount, requiresApproval, total } = computeDiscount(
    subtotal,
    type,
    valid ? value : 0
  );

  function switchType(next: DiscountType) {
    setType(next);
    setTyped("");
  }

  function confirmAmount() {
    if (!valid) return;
    if (requiresApproval) setStep("approval");
    else onApply(type, typed, reason.trim(), null);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-4 max-h-[95dvh] overflow-y-auto">
        <div className="text-center">
          <h2 className="text-lg font-bold text-sidebar">
            {step === "amount" ? "ส่วนลด" : "ขออนุมัติส่วนลด"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1 tabular-nums">
            ยอดก่อนลด ฿{formatPrice(subtotal)}
          </p>
        </div>

        {step === "amount" ? (
          <>
            {/* % / ฿ toggle, then the shop's quick picks — one row so the modal fits the iPad's
                landscape height without scrolling */}
            <div className="flex gap-2">
              {(["percent", "amount"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => switchType(t)}
                  className={`flex-1 h-12 rounded-lg border text-lg font-bold transition-colors ${
                    type === t
                      ? "border-accent bg-accent text-white"
                      : "border-input bg-white text-sidebar hover:border-accent hover:text-accent"
                  }`}
                >
                  {t === "percent" ? "%" : "฿"}
                </button>
              ))}
              <span className="w-px bg-border mx-1" aria-hidden />
              {QUICK.filter((q) => q.type === "percent" || Number(q.value) <= subtotal).map(
                (q) => (
                  <button
                    key={q.label}
                    type="button"
                    onClick={() => {
                      setType(q.type);
                      setTyped(q.value);
                    }}
                    className="flex-1 h-12 rounded-lg border-2 border-accent/40 bg-accent/10 text-base font-bold text-accent hover:bg-accent/20"
                  >
                    {q.label}
                  </button>
                )
              )}
            </div>

            {/* Typed value */}
            <div className="rounded-lg border border-input bg-surface px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {type === "percent" ? "ลดกี่ %" : "ลดกี่บาท"}
              </span>
              <span className="text-2xl font-bold text-sidebar tabular-nums" aria-live="polite">
                {typed === "" ? "—" : type === "percent" ? `${typed}%` : `฿${typed}`}
              </span>
            </div>

            <NumericKeypad allowDecimal onKey={(k) => setTyped((t) => applyKey(t, k, max))} />

            {/* Live preview */}
            <div
              className={`rounded-lg px-4 py-3 space-y-0.5 ${
                valid ? "bg-success/10" : "bg-muted"
              }`}
            >
              <div className="flex justify-between text-base">
                <span className="text-muted-foreground">ส่วนลด</span>
                <span className="font-semibold text-destructive tabular-nums">
                  {valid ? `-฿${formatPrice(discountAmount)}` : "—"}
                </span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-base text-sidebar font-medium">ยอดใหม่</span>
                <span className="text-2xl font-bold text-sidebar tabular-nums">
                  {valid ? `฿${formatPrice(total)}` : "—"}
                </span>
              </div>
              {valid && requiresApproval && (
                <p className="text-sm text-warning font-medium pt-1">
                  ส่วนลดนี้เกินเพดาน ต้องใช้ PIN ผู้จัดการ
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                onClick={onCancel}
                className="flex-1 h-12 bg-white border border-input text-sidebar text-base hover:bg-muted"
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                onClick={confirmAmount}
                disabled={!valid}
                className="flex-1 h-12 bg-accent hover:bg-accent/90 text-white text-base font-semibold"
              >
                {valid && requiresApproval ? "ถัดไป: ขออนุมัติ" : "ใช้ส่วนลด"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-lg bg-muted px-4 py-3 flex justify-between items-baseline">
              <span className="text-base text-sidebar">
                ส่วนลด {type === "percent" ? `${typed}%` : `฿${typed}`}
              </span>
              <span className="text-xl font-bold text-destructive tabular-nums">
                -฿{formatPrice(discountAmount)}
              </span>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-sidebar" htmlFor="discount-reason">
                เหตุผลที่ให้ส่วนลด
              </label>
              <div className="flex flex-wrap gap-2">
                {QUICK_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(r)}
                    className={`h-10 px-3 rounded-full border text-sm font-medium transition-colors ${
                      reason === r
                        ? "border-accent bg-accent text-white"
                        : "border-input bg-white text-sidebar hover:border-accent"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <textarea
                id="discount-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-input px-3 py-2 text-base"
                placeholder="หรือพิมพ์เหตุผลเอง"
              />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-sidebar text-center">
                PIN ของ Manager/Owner เพื่ออนุมัติ
              </p>
              <PinPad
                disabled={reason.trim() === ""}
                onComplete={(pin) => onApply(type, typed, reason.trim(), pin)}
              />
              {reason.trim() === "" && (
                <p className="text-sm text-muted-foreground text-center">
                  เลือกหรือพิมพ์เหตุผลก่อนกด PIN
                </p>
              )}
            </div>

            <Button
              type="button"
              onClick={() => setStep("amount")}
              className="w-full h-12 bg-white border border-input text-sidebar text-base hover:bg-muted"
            >
              ย้อนกลับ
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
