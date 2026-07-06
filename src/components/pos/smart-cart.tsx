"use client";
import { useState, useTransition } from "react";
import type { CartItem } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { findOrCreateCustomer } from "@/app/actions/customers";

type PaymentMethod = "cash" | "transfer" | "card";
type OrderType = "dine_in" | "take_away";

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "เงินสด",
  transfer: "โอน",
  card: "บัตร",
};
const PAYMENT_METHODS: PaymentMethod[] = ["cash", "transfer", "card"];

type Props = {
  cartItems: CartItem[];
  onUpdateQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
  orderType: OrderType;
  onOrderTypeChange: (type: OrderType) => void;
  tableNumber: string;
  onTableNumberChange: (value: string) => void;
  paymentMethod: PaymentMethod;
  onPaymentChange: (method: PaymentMethod) => void;
  customerId: string | null;
  onCustomerIdChange: (id: string | null) => void;
  pending: boolean;
  error: string | null;
  lastOrderNumber: string | null;
  onCheckout: () => void;
};

export function SmartCart({
  cartItems,
  onUpdateQty,
  onRemove,
  onClear,
  orderType,
  onOrderTypeChange,
  tableNumber,
  onTableNumberChange,
  paymentMethod,
  onPaymentChange,
  customerId,
  onCustomerIdChange,
  pending,
  error,
  lastOrderNumber,
  onCheckout,
}: Props) {
  const [phone, setPhone] = useState("");
  const [linkedPhone, setLinkedPhone] = useState<string | null>(null);
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null);
  const [searchPending, startSearch] = useTransition();

  const total = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);

  function handleLinkCustomer() {
    const trimmed = phone.trim();
    if (!trimmed) return;
    setCustomerSearchError(null);
    startSearch(async () => {
      // Use phone as fallback name so findOrCreateCustomer always has a non-empty name
      const result = await findOrCreateCustomer({ phone: trimmed, name: trimmed });
      if ("error" in result) {
        setCustomerSearchError(result.error);
      } else {
        onCustomerIdChange(result.customerId);
        setLinkedPhone(trimmed);
      }
    });
  }

  function handleClearCustomer() {
    setPhone("");
    setLinkedPhone(null);
    setCustomerSearchError(null);
    onCustomerIdChange(null);
  }

  function orderTypeCls(active: boolean) {
    return (
      "flex-1 rounded-md border py-1.5 text-xs font-medium transition-colors " +
      (active
        ? "border-accent bg-accent text-white"
        : "border-input text-muted-foreground hover:border-accent hover:text-accent")
    );
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border">
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

      {/* Cart items */}
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {cartItems.length === 0 ? (
          <div className="py-10 text-center">
            {lastOrderNumber && (
              <p className="text-sm font-semibold text-sidebar mb-1">
                ออเดอร์ {lastOrderNumber} สำเร็จ ✓
              </p>
            )}
            <p className="text-muted-foreground text-sm">คลิกสินค้าเพื่อเพิ่ม</p>
          </div>
        ) : (
          cartItems.map((item) => (
            <div
              key={item.cartItemKey}
              className="flex items-start gap-2 px-3 py-2.5"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar truncate">
                  {item.name}
                </p>
                {item.selectedModifiers.length > 0 && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {item.selectedModifiers.map((m) => m.optionName).join(", ")}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  ฿{(item.totalPrice / item.quantity).toFixed(0)} / ชิ้น
                </p>
              </div>
              {/* Qty controls */}
              <div className="flex items-center gap-1 mt-0.5">
                <button
                  type="button"
                  onClick={() => onUpdateQty(item.cartItemKey, item.quantity - 1)}
                  className="w-6 h-6 rounded border text-sm flex items-center justify-center hover:bg-muted transition-colors"
                  aria-label="ลดจำนวน"
                >
                  −
                </button>
                <span className="w-5 text-center text-sm tabular-nums">
                  {item.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => onUpdateQty(item.cartItemKey, item.quantity + 1)}
                  className="w-6 h-6 rounded border text-sm flex items-center justify-center hover:bg-muted transition-colors"
                  aria-label="เพิ่มจำนวน"
                >
                  +
                </button>
              </div>
              <p className="text-sm font-medium w-12 text-right text-sidebar tabular-nums mt-0.5">
                ฿{item.totalPrice.toFixed(0)}
              </p>
              <button
                type="button"
                onClick={() => onRemove(item.cartItemKey)}
                className="text-muted-foreground hover:text-destructive transition-colors text-xs w-4 mt-0.5"
                aria-label="ลบสินค้า"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-4 py-3 space-y-3 shrink-0">
        {/* Customer */}
        {customerId && linkedPhone ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-sidebar font-medium truncate">
              ลูกค้า: {linkedPhone}
            </span>
            <button
              type="button"
              onClick={handleClearCustomer}
              className="text-xs text-muted-foreground hover:text-destructive shrink-0 ml-2"
            >
              ล้าง
            </button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <Input
              type="tel"
              placeholder="เบอร์ลูกค้า (ไม่บังคับ)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLinkCustomer();
              }}
              className="h-7 text-xs"
            />
            <button
              type="button"
              onClick={handleLinkCustomer}
              disabled={!phone.trim() || searchPending}
              className="px-2.5 py-1 text-xs rounded-lg border border-border hover:bg-muted disabled:opacity-40 shrink-0 transition-colors"
            >
              {searchPending ? "…" : "บันทึก"}
            </button>
          </div>
        )}
        {customerSearchError && (
          <p className="text-xs text-destructive">{customerSearchError}</p>
        )}

        {/* Order type */}
        <div className="flex gap-2">
          {(["dine_in", "take_away"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onOrderTypeChange(type)}
              className={orderTypeCls(orderType === type)}
            >
              {type === "dine_in" ? "ทานที่ร้าน" : "Take Away"}
            </button>
          ))}
        </div>

        {/* Table number */}
        {orderType === "dine_in" && (
          <Input
            type="text"
            placeholder="หมายเลขโต๊ะ (ไม่บังคับ)"
            value={tableNumber}
            onChange={(e) => onTableNumberChange(e.target.value)}
            className="h-7 text-xs"
          />
        )}

        {/* Total */}
        <div className="flex justify-between font-semibold text-sidebar text-base">
          <span>รวม</span>
          <span className="tabular-nums">฿{total.toFixed(0)}</span>
        </div>

        {/* Payment method */}
        <div className="flex gap-2">
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => onPaymentChange(method)}
              className={orderTypeCls(paymentMethod === method)}
            >
              {PAYMENT_LABELS[method]}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-sm text-destructive font-medium">{error}</p>
        )}

        <Button
          type="button"
          onClick={onCheckout}
          disabled={cartItems.length === 0 || pending}
          className="w-full bg-accent hover:bg-accent/90 text-white"
        >
          {pending ? "กำลังบันทึก…" : `ชำระ ฿${total.toFixed(0)}`}
        </Button>
      </div>
    </div>
  );
}
