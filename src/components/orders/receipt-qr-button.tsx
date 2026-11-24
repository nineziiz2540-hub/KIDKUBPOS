"use client";

import { useEffect, useState } from "react";
import { QrCode } from "lucide-react";
import { ReceiptQr } from "@/components/receipt/receipt-qr";
import { receiptUrl } from "@/lib/receipt-link";

/** Shows a bill's receipt QR again from bill history (any status; the page only renders it when the bill has a client_ref). */
export function ReceiptQrButton({ clientRef, orderLabel }: { clientRef: string; orderLabel: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-input bg-white text-base font-semibold text-sidebar hover:bg-muted"
      >
        <QrCode size={20} />
        QR ใบเสร็จ
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="receipt-qr-title"
            className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 text-center"
          >
            <h2 id="receipt-qr-title" className="text-lg font-bold text-sidebar">
              QR ใบเสร็จ
            </h2>
            {orderLabel && <p className="font-mono text-base text-muted-foreground">{orderLabel}</p>}
            <ReceiptQr url={receiptUrl(window.location.origin, clientRef)} size={296} />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-12 w-full rounded-xl border border-input bg-white text-base font-semibold text-sidebar hover:bg-muted"
            >
              ปิด
            </button>
          </div>
        </div>
      )}
    </>
  );
}
