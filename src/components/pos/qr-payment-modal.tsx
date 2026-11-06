"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { buildPromptPayPayload } from "@/lib/promptpay";
import { Button } from "@/components/ui/button";
import { SaveToDeviceButton } from "./save-to-device-button";

type Props = {
  total: number;
  /** The shop's PromptPay ID, loaded with the POS page; null when the shop hasn't set one. */
  promptpayId: string | null;
  /** A payment attempt is in flight. Owned by the parent so a failed confirm can be retried. */
  pending: boolean;
  /** Why the last confirm failed; the confirm button then reads ลองอีกครั้ง. */
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** Offered only after a try got no answer (see CashPaymentModal). */
  saveToDevice?: { onSave: () => void; disabledReason: string | null } | null;
};

type QrState =
  | { status: "loading" }
  | { status: "ready"; imageUrl: string }
  | { status: "error"; message: string };

const QR_SIZE = 280;
const NO_PROMPTPAY = "ร้านยังไม่ได้ตั้งค่า PromptPay ID กรุณาไปที่หน้าตั้งค่า";

export function QrPaymentModal({
  total,
  promptpayId,
  pending,
  error,
  onConfirm,
  onCancel,
  saveToDevice = null,
}: Props) {
  // Drawn entirely on the device: no request can leave this on "กำลังสร้าง QR…".
  const [image, setImage] = useState<{ key: string; state: QrState } | null>(null);
  const key = promptpayId === null ? "" : buildPromptPayPayload(promptpayId, total);

  useEffect(() => {
    if (key === "") return;
    // A run that has been superseded (a new total or ID, or React's dev-only double effect) must
    // not write its result: only the latest run decides what the modal shows.
    let cancelled = false;
    QRCode.toDataURL(key, { width: QR_SIZE, margin: 1 })
      .then((imageUrl) => {
        if (!cancelled) setImage({ key, state: { status: "ready", imageUrl } });
      })
      .catch(() => {
        if (!cancelled) setImage({ key, state: { status: "error", message: "สร้าง QR ไม่สำเร็จ" } });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const qr: QrState =
    promptpayId === null
      ? { status: "error", message: NO_PROMPTPAY }
      : image?.key === key
        ? image.state
        : { status: "loading" };

  // One fixed layout for every state: the QR area is always QR_SIZE square and the buttons are
  // always there, so the dialog never changes size (and jumps) while the QR is being made. The
  // message and every button sit in a footer that never scrolls away (บันทึกไว้ในเครื่อง included,
  // on the iPad's 740px height); only the QR part would scroll on a shorter screen.
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-6 w-full max-w-sm max-h-[95dvh] flex flex-col gap-4">
        <div className="min-h-0 flex-1 overflow-y-auto space-y-4">
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
        </div>

        <div className="shrink-0 space-y-3">
          {error && (
            <p className="text-sm font-medium text-destructive text-center" role="alert">
              {error}
            </p>
          )}

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
                  if (pending || qr.status !== "ready") return;
                  onConfirm();
                }}
                disabled={pending || qr.status !== "ready"}
                className="flex-1 bg-accent hover:bg-accent/90 text-white"
              >
                {error ? "ลองอีกครั้ง" : "ยืนยันชำระเงินแล้ว"}
              </Button>
            )}
          </div>
          {saveToDevice && <SaveToDeviceButton {...saveToDevice} pending={pending} />}
        </div>
      </div>
    </div>
  );
}
