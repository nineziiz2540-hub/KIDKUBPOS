import type { Metadata } from "next";
import { getReceipt } from "@/lib/receipt-data";
import { ReceiptBrand } from "@/components/receipt/receipt-brand";
import { RECEIPT_HEADING, RECEIPT_THANKS, receiptTitle, toReceiptView } from "@/lib/receipt-view";

// Public, per-request: a bill's state (cancelled/refunded) must never be served from a cache.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const view = toReceiptView(await getReceipt(token));
  return {
    title: receiptTitle(view),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    // The customer's page is not the POS app: no install manifest, no home-screen app title.
    manifest: null,
    appleWebApp: null,
  };
}

const NUM = "font-mono tabular-nums";
const DIVIDER = <hr className="my-4 border-0 border-t border-dashed border-border" />;

export default async function ReceiptPage({ params }: Props) {
  const { token } = await params;
  const view = toReceiptView(await getReceipt(token));

  return (
    <main lang="th" className="min-h-screen bg-background px-4 py-6">
      <div className="mx-auto w-full max-w-sm rounded-2xl border border-border bg-white p-6 text-sm text-foreground">
        {view.kind === "not_found" && (
          <p className="text-center text-muted-foreground">{view.message}</p>
        )}

        {view.kind === "notice" && (
          <div className="text-center">
            <ReceiptBrand logoUrl={view.logoUrl} shopName={view.shopName} size="small" />
            <p className={`mt-3 text-xs text-muted-foreground ${NUM}`}>{view.billLine}</p>
            <p className="text-xs text-muted-foreground">{view.dateTime}</p>
            <p className={`mt-4 font-semibold ${view.tone === "destructive" ? "text-destructive" : "text-warning"}`}>
              {view.message}
            </p>
          </div>
        )}

        {view.kind === "receipt" && (
          <div>
            <ReceiptBrand logoUrl={view.logoUrl} shopName={view.shopName} size="full" />
            <p className="mt-2 text-center text-xs text-muted-foreground">{RECEIPT_HEADING}</p>
            <p className={`mt-3 text-center ${NUM}`}>{view.billLine}</p>
            <p className="text-center text-xs text-muted-foreground">{view.dateTime}</p>
            {DIVIDER}
            <ul className="space-y-3">
              {view.lines.map((l, i) => (
                <li key={i}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 break-words">{l.text}</span>
                    <span className={`shrink-0 ${NUM}`}>{l.amount}</span>
                  </div>
                  {l.detail && <p className="mt-0.5 text-xs text-muted-foreground">{l.detail}</p>}
                </li>
              ))}
            </ul>
            {DIVIDER}
            <div className="space-y-1">
              {view.discount && view.subtotal && (
                <div className="flex justify-between text-muted-foreground">
                  <span>รวม</span>
                  <span className={NUM}>{view.subtotal}</span>
                </div>
              )}
              {view.discount && (
                <div className="flex justify-between text-muted-foreground">
                  <span>ส่วนลด</span>
                  <span className={NUM}>{view.discount}</span>
                </div>
              )}
              <div className="flex items-baseline justify-between text-lg font-semibold">
                <span>ยอดสุทธิ</span>
                <span className={NUM}>{view.total}</span>
              </div>
            </div>
            {(view.payment || view.cash) && (
              <div className="mt-3 space-y-0.5 text-xs text-muted-foreground">
                {view.payment && <p>{view.payment}</p>}
                {view.cash && <p className={NUM}>{view.cash}</p>}
              </div>
            )}
            {DIVIDER}
            <p className="text-center text-muted-foreground">{RECEIPT_THANKS}</p>
          </div>
        )}
      </div>
    </main>
  );
}
