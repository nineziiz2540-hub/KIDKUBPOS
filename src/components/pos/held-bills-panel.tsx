"use client";
import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/cash";
import type { CancelledHeldBill, HeldBillSummary } from "@/lib/dal";
import { CancelHeldBillModal } from "./cancel-held-bill-modal";

type Props = {
  bills: HeldBillSummary[];
  cancelledToday: CancelledHeldBill[];
  activeHeldId: string | null;
  /** The cart holds items that would be lost by opening another bill. */
  cartBusy: boolean;
  /** "save" when the busy cart is itself a resumed held bill, "hold" when it's a new order. */
  busyCartAction: "save" | "hold";
  onResume: (bill: HeldBillSummary) => void;
  onParkCurrentThenResume: (bill: HeldBillSummary) => void;
  onCancelled: (billId: string) => void;
  onClose: () => void;
};

function minutesAgo(iso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `พักไว้ ${mins} นาที`;
  return `พักไว้ ${Math.floor(mins / 60)} ชม. ${mins % 60} นาที`;
}

export function HeldBillsPanel({
  bills,
  cancelledToday,
  activeHeldId,
  cartBusy,
  busyCartAction,
  onResume,
  onParkCurrentThenResume,
  onCancelled,
  onClose,
}: Props) {
  // Captured once when the panel opens — good enough for "พักไว้ X นาที" and keeps render pure.
  const [now] = useState(() => Date.now());
  const [confirmBill, setConfirmBill] = useState<HeldBillSummary | null>(null);
  const [cancelBill, setCancelBill] = useState<HeldBillSummary | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  function open(bill: HeldBillSummary) {
    if (bill.id === activeHeldId) {
      onClose();
      return;
    }
    if (cartBusy) setConfirmBill(bill);
    else onResume(bill);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[92dvh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="text-lg font-bold text-sidebar">บิลพัก ({bills.length})</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="w-10 h-10 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted"
          >
            <X size={22} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {bills.length === 0 ? (
            <p className="text-center text-base text-muted-foreground py-10">ไม่มีบิลพัก</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {bills.map((bill) => (
                <div
                  key={bill.id}
                  className={`rounded-xl border-2 bg-white flex flex-col ${
                    bill.id === activeHeldId ? "border-accent" : "border-border"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => open(bill)}
                    className="flex-1 text-left p-4 rounded-t-xl hover:bg-muted/50 active:bg-muted transition-colors"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-3xl font-bold text-accent tabular-nums leading-none">
                        คิว {bill.queueNumber}
                      </span>
                      <span className="text-xl font-bold text-sidebar tabular-nums">
                        ฿{formatPrice(bill.total)}
                      </span>
                    </div>
                    {bill.customerLabel && (
                      <p className="text-base font-semibold text-sidebar mt-2 truncate">
                        {bill.customerLabel}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground mt-1">
                      {bill.itemCount} ชิ้น · {bill.orderType === "dine_in" ? "ทานที่ร้าน" : "Take Away"}
                    </p>
                    <p className="text-sm text-muted-foreground">{minutesAgo(bill.createdAt, now)}</p>
                    {bill.id === activeHeldId && (
                      <p className="text-sm font-semibold text-accent mt-1">กำลังเปิดอยู่ในตะกร้า</p>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCancelBill(bill)}
                    className="h-11 border-t text-sm font-semibold text-destructive hover:bg-destructive/5 rounded-b-xl"
                  >
                    ยกเลิกบิล
                  </button>
                </div>
              ))}
            </div>
          )}

          {cancelledToday.length > 0 && (
            <div className="border-t pt-3">
              <button
                type="button"
                onClick={() => setShowCancelled((v) => !v)}
                className="flex items-center gap-2 h-10 text-base font-medium text-muted-foreground"
              >
                <ChevronDown
                  size={18}
                  className={`transition-transform ${showCancelled ? "rotate-180" : ""}`}
                />
                ยกเลิกวันนี้ ({cancelledToday.length})
              </button>
              {showCancelled && (
                <ul className="mt-2 divide-y rounded-lg border">
                  {cancelledToday.map((c) => (
                    <li key={c.id} className="px-4 py-3 text-sm">
                      <p className="font-semibold text-sidebar">
                        คิว {c.queueNumber}
                        {c.customerLabel ? ` · ${c.customerLabel}` : ""}
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          ·{" "}
                          {new Date(c.cancelledAt).toLocaleTimeString("th-TH", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </p>
                      <p className="text-muted-foreground">
                        เหตุผล: {c.reason ?? "—"} · โดย {c.cancelledByName ?? "—"} · อนุมัติ{" "}
                        {c.approvedByName ?? "—"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Opening another bill would drop what's in the cart */}
      {confirmBill && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4 text-center">
            <h2 className="text-lg font-bold text-sidebar">ตะกร้ามีรายการอยู่</h2>
            <p className="text-base text-muted-foreground">
              {busyCartAction === "save"
                ? "บิลพักที่เปิดอยู่มีการแก้ไขที่ยังไม่ได้บันทึก"
                : "รายการในตะกร้ายังไม่ได้ชำระหรือพักบิล"}
            </p>
            <div className="space-y-2">
              <Button
                type="button"
                onClick={() => {
                  const bill = confirmBill;
                  setConfirmBill(null);
                  onParkCurrentThenResume(bill);
                }}
                className="w-full h-12 bg-accent hover:bg-accent/90 text-white text-base"
              >
                {busyCartAction === "save" ? "บันทึกบิลนี้ก่อน แล้วเปิดคิว " : "พักตะกร้านี้ก่อน แล้วเปิดคิว "}
                {confirmBill.queueNumber}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const bill = confirmBill;
                  setConfirmBill(null);
                  onResume(bill);
                }}
                className="w-full h-12 bg-destructive/10 text-destructive text-base hover:bg-destructive/20"
              >
                ทิ้งรายการในตะกร้า แล้วเปิดคิว {confirmBill.queueNumber}
              </Button>
              <Button
                type="button"
                onClick={() => setConfirmBill(null)}
                className="w-full h-12 bg-white border border-input text-sidebar text-base hover:bg-muted"
              >
                ยกเลิก
              </Button>
            </div>
          </div>
        </div>
      )}

      {cancelBill && (
        <CancelHeldBillModal
          billId={cancelBill.id}
          queueNumber={cancelBill.queueNumber}
          customerLabel={cancelBill.customerLabel}
          onDone={() => {
            const id = cancelBill.id;
            setCancelBill(null);
            onCancelled(id);
          }}
          onCancel={() => setCancelBill(null)}
        />
      )}
    </div>
  );
}
