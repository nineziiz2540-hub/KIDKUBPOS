"use client";
import { useEffect, useState, useTransition } from "react";
import QRCode from "qrcode";
import { generatePaymentQr } from "@/app/actions/payment";
import { Button } from "@/components/ui/button";

type Props = {
  total: number;
  onConfirm: () => void;
  onCancel: () => void;
};

export function QrPaymentModal({ total, onConfirm, onCancel }: Props) {
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await generatePaymentQr(total);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const dataUrl = await QRCode.toDataURL(result.qrPayload, {
        width: 280,
        margin: 1,
      });
      setQrImageUrl(dataUrl);
    });
  }, [total]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4">
        <h2 className="text-lg font-bold text-sidebar text-center">
          สแกนจ่ายด้วย PromptPay
        </h2>
        <p className="text-2xl font-bold text-center text-sidebar tabular-nums">
          ฿{total.toFixed(2)}
        </p>

        {isPending && (
          <p className="text-sm text-muted-foreground text-center py-8">
            กำลังสร้าง QR…
          </p>
        )}

        {error && (
          <div className="space-y-3">
            <p className="text-sm text-destructive text-center">{error}</p>
            <Button type="button" onClick={onCancel} className="w-full">
              ปิด
            </Button>
          </div>
        )}

        {qrImageUrl && !error && (
          <>
            <img
              src={qrImageUrl}
              alt="PromptPay QR"
              className="w-full max-w-[280px] mx-auto"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={onCancel}
                className="flex-1 bg-white border border-input text-sidebar hover:bg-muted"
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (isConfirming) return;
                  setIsConfirming(true);
                  onConfirm();
                }}
                disabled={isConfirming}
                className="flex-1 bg-accent hover:bg-accent/90 text-white"
              >
                ยืนยันชำระเงินแล้ว
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
