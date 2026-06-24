"use client";
import type { CartItem } from "@/app/actions/orders";
import { Button } from "@/components/ui/button";

type PaymentMethod = "cash" | "transfer" | "card";

type Props = {
  cartItems: CartItem[];
  onUpdateQty: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
  onClear: () => void;
  paymentMethod: PaymentMethod;
  onPaymentChange: (method: PaymentMethod) => void;
  onCheckout: () => void;
  pending: boolean;
  error: string | null;
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "เงินสด",
  transfer: "โอน",
  card: "บัตร",
};

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "transfer", "card"];

export function CartPanel({
  cartItems,
  onUpdateQty,
  onRemove,
  onClear,
  paymentMethod,
  onPaymentChange,
  onCheckout,
  pending,
  error,
}: Props) {
  const total = cartItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h2 className="font-semibold text-sidebar">ตะกร้า</h2>
        {cartItems.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-destructive transition-colors"
          >
            ล้างทั้งหมด
          </button>
        )}
      </div>

      {/* Cart items — scrollable */}
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {cartItems.length === 0 ? (
          <p className="text-center text-muted-foreground py-12 text-sm">
            คลิกสินค้าเพื่อเพิ่ม
          </p>
        ) : (
          cartItems.map((item) => (
            <div
              key={item.productId}
              className="flex items-center gap-2 px-3 py-2.5"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar truncate">
                  {item.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  ฿{item.price.toFixed(2)}
                </p>
              </div>
              {/* Qty controls */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onUpdateQty(item.productId, item.quantity - 1)}
                  className="w-6 h-6 rounded border text-sm leading-none hover:bg-surface transition-colors flex items-center justify-center"
                  aria-label="ลดจำนวน"
                >
                  −
                </button>
                <span className="w-6 text-center text-sm tabular-nums">
                  {item.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => onUpdateQty(item.productId, item.quantity + 1)}
                  className="w-6 h-6 rounded border text-sm leading-none hover:bg-surface transition-colors flex items-center justify-center"
                  aria-label="เพิ่มจำนวน"
                >
                  +
                </button>
              </div>
              <p className="text-sm font-medium w-16 text-right text-sidebar tabular-nums">
                ฿{(item.price * item.quantity).toFixed(2)}
              </p>
              <button
                type="button"
                onClick={() => onRemove(item.productId)}
                className="text-muted-foreground hover:text-destructive transition-colors text-xs w-4 text-center"
                aria-label="ลบสินค้า"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer: total + payment + checkout */}
      <div className="border-t px-4 py-4 space-y-3 shrink-0">
        <div className="flex justify-between font-semibold text-sidebar text-base">
          <span>รวมทั้งหมด</span>
          <span className="tabular-nums">฿{total.toFixed(2)}</span>
        </div>

        {/* Payment method selector */}
        <div className="flex gap-2">
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => onPaymentChange(method)}
              className={`flex-1 rounded-md border py-1.5 text-xs font-medium transition-colors ${
                paymentMethod === method
                  ? "border-accent bg-accent text-white"
                  : "border-input text-muted-foreground hover:border-accent hover:text-accent"
              }`}
            >
              {PAYMENT_LABELS[method]}
            </button>
          ))}
        </div>

        {error !== null && (
          <p className="text-sm text-destructive font-medium">{error}</p>
        )}

        <Button
          type="button"
          onClick={onCheckout}
          disabled={cartItems.length === 0 || pending}
          className="w-full bg-accent hover:bg-accent/90 text-white"
        >
          {pending ? "กำลังบันทึก…" : "ชำระเงิน"}
        </Button>
      </div>
    </div>
  );
}
