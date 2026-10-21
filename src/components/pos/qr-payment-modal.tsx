"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { generatePaymentQr } from "@/app/actions/payment";
import { Button } from "@/components/ui/button";

type Props = {
  total: number;
  onConfirm: () => void;
  onCancel: () => void;
};

type QrState =
  | { status: "loading" }
  | { status: "ready"; imageUrl: string }
  | { status: "error"; message: string };

const QR_SIZE = 280;

export function QrPaymentModal({ total, onConfirm, onCancel }: Props) {
  const [qr, setQr] = useState<QrState>({ status: "loading" });
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    // A run that has been superseded (a new total, or React's dev-only double effect) must not
    // write its result: only the latest run decides what the modal shows.
    let cancelled = false;
    (async () => {
      const result = await generatePaymentQr(total);
      if (cancelled) return;
      if ("error" in result) {
        setQr({ status: "error", message: result.error });
        return;
      }
      const imageUrl = await QRCode.toDataURL(result.qrPayload, { width: QR_SIZE, margin: 1 });
      if (!cancelled) setQr({ status: "ready", imageUrl });
    })();
    return () => {
      cancelled = true;
    };
  }, [total]);

  // One fixed layout for every state: the QR area is always QR_SIZE square and the buttons are
  // always there, so the dialog never changes size (and jumps) while the QR is being made.
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4">
        <h2 className="text-lg font-bold text-sidebar text-center">
          สแกนจ่ายด้วย PromptPay
        </h2>
        <p className="text-2xl font-bold text-center text-sidebar tabular-nums">
          ฿{total.toFixed(2)}
        </p>

        <div
          className="mx-auto flex w-full max-w-[280px] aspect-square items-center justify-center"
          aria-live="polite"
        >
          {qr.status === "loading" && (
            <p className="text-sm text-muted-foreground text-center">กำลังสร้าง QR…</p>
          )}
          {qr.status === "error" && (
            <p className="text-sm text-destructive text-center">{qr.message}</p>
          )}
          {qr.status === "ready" && (
            <img
              src={qr.imageUrl}
              alt="PromptPay QR"
              width={QR_SIZE}
              height={QR_SIZE}
              className="h-full w-full"
            />
          )}
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            onClick={onCancel}
            className="flex-1 bg-white border border-input text-sidebar hover:bg-muted"
          >
            {qr.status === "error" ? "ปิด" : "ยกเลิก"}
          </Button>
          {qr.status !== "error" && (
            <Button
              type="button"
              onClick={() => {
                if (isConfirming || qr.status !== "ready") return;
                setIsConfirming(true);
                onConfirm();
              }}
              disabled={isConfirming || qr.status !== "ready"}
              className="flex-1 bg-accent hover:bg-accent/90 text-white"
            >
              ยืนยันชำระเงินแล้ว
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
