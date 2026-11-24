"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { RECEIPT_QR_CAPTION } from "@/lib/receipt-link";

type Props = {
  url: string;
  size: number;
  /** A line under the caption (e.g. the bill is not on the system yet). */
  note?: string | null;
};

type Drawn = { url: string; size: number; state: "ready" | "error"; imageUrl?: string };

/**
 * The receipt QR for a paid bill, drawn on the device (works offline). It holds a fixed
 * size×size box while drawing, and shows nothing at all if drawing fails: it must never get in
 * the way of the next sale.
 */
export function ReceiptQr({ url, size, note = null }: Props) {
  const [drawn, setDrawn] = useState<Drawn | null>(null);

  useEffect(() => {
    // A superseded run (new url or size, or React's dev-only double effect) must not write.
    let cancelled = false;
    QRCode.toDataURL(url, { width: size, margin: 2, errorCorrectionLevel: "L" })
      .then((imageUrl) => {
        if (!cancelled) setDrawn({ url, size, state: "ready", imageUrl });
      })
      .catch(() => {
        if (!cancelled) setDrawn({ url, size, state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  const current = drawn !== null && drawn.url === url && drawn.size === size ? drawn : null;
  if (current?.state === "error") return null;

  return (
    <div className="mx-auto flex w-fit flex-col items-center" data-receipt-url={url}>
      <div style={{ width: size, height: size }}>
        {current?.state === "ready" && current.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.imageUrl} alt="QR ใบเสร็จ" width={size} height={size} />
        )}
      </div>
      {current?.state === "ready" && (
        <>
          <p className="text-sm font-medium text-sidebar">{RECEIPT_QR_CAPTION}</p>
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
        </>
      )}
    </div>
  );
}
