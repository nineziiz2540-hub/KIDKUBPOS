"use client";
import { formatPrice } from "@/lib/cash";
import { useId, useState } from "react";
import { Percent, Trash2, UserRound, X } from "lucide-react";
import type { CartItem } from "@/types/app";
import type { DiscountType } from "@/lib/discount";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PinPad } from "@/components/ui/pin-pad";
import { MemberModal } from "./member-modal";
import { DiscountModal } from "./discount-modal";
import { NoteModal } from "./note-modal";

type PaymentMethod = "cash" | "transfer";
type OrderType = "dine_in" | "take_away";

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "เงินสด",
  transfer: "โอน",
};
const PAYMENT_METHODS: PaymentMethod[] = ["cash", "transfer"];

const SECONDARY_CLS =
  "flex-1 flex items-center justify-center gap-2 h-11 rounded-lg border border-input bg-white text-base font-medium text-sidebar hover:border-accent hover:text-accent disabled:opacity-40 disabled:pointer-events-none transition-colors";

type Props = {
  cartItems: CartItem[];
  onUpdateQty: (key: string, qty: number) => void;
  onRemove: (key: string) => void;
  onSetNote: (key: string, note: string) => void;
  onClear: () => void;
  orderType: OrderType;
  onOrderTypeChange: (type: OrderType) => void;
  paymentMethod: PaymentMethod;
  onPaymentChange: (method: PaymentMethod) => void;
  customer: { id: string; phone: string | null } | null;
  onCustomerChange: (customer: { id: string; phone: string | null } | null) => void;
  discountType: DiscountType | null;
  discountValue: string;
  onApplyDiscount: (
    type: DiscountType,
    value: string,
    reason: string,
    pin: string | null
  ) => void;
  discountReason: string;
  onDiscountReasonChange: (value: string) => void;
  subtotal: number;
  discountAmount: number;
  requiresApproval: boolean;
  discountExceedsSubtotal: boolean;
  total: number;
  hasApproverPin: boolean;
  onApproverPinComplete: (pin: string) => void;
  onCancelDiscount: () => void;
  pending: boolean;
  error: string | null;
  lastOrderNumber: string | null;
  lastQueueNumber: number | null;
  lastCashTender: { received: number; change: number } | null;
  onCheckout: () => void;
  /** Set while a held bill is loaded in the cart. */
  activeHeld: { queueNumber: number; customerLabel: string | null } | null;
  /** The loaded held bill has unsaved changes. */
  heldDirty: boolean;
  onCloseHeld: () => void;
  onHold: () => void;
  holdPending: boolean;
  lastHeld: { queueNumber: number; customerLabel: string | null; saved: boolean } | null;
};

export function SmartCart({
  cartItems,
  onUpdateQty,
  onRemove,
  onSetNote,
  onClear,
  orderType,
  onOrderTypeChange,
  paymentMethod,
  onPaymentChange,
  customer,
  onCustomerChange,
  discountType,
  discountValue,
  onApplyDiscount,
  discountReason,
  onDiscountReasonChange,
  subtotal,
  discountAmount,
  requiresApproval,
  discountExceedsSubtotal,
  total,
  hasApproverPin,
  onApproverPinComplete,
  onCancelDiscount,
  pending,
  error,
  lastOrderNumber,
  lastQueueNumber,
  lastCashTender,
  onCheckout,
  activeHeld,
  heldDirty,
  onCloseHeld,
  onHold,
  holdPending,
  lastHeld,
}: Props) {
  const reasonId = useId();
  const [confirmCloseHeld, setConfirmCloseHeld] = useState(false);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [noteKey, setNoteKey] = useState<string | null>(null);
  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  function handleClearCustomer() {
    onCustomerChange(null);
  }

  // Sized for fingers on the counter iPad: 48px tall (Apple's minimum is 44) with 16px text.
  function choiceCls(active: boolean) {
    return (
      "flex-1 h-12 rounded-lg border text-base font-semibold transition-colors " +
      (active
        ? "border-accent bg-accent text-white"
        : "border-input bg-white text-sidebar hover:border-accent hover:text-accent")
    );
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border">
      {/* Header — while a held bill is loaded it becomes that bill's banner */}
      {activeHeld ? (
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b shrink-0 bg-accent/10 rounded-t-xl">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-accent">บิลพัก{heldDirty ? " · มีการแก้ไข" : ""}</p>
            <p className="text-lg font-bold text-sidebar truncate">
              คิว {activeHeld.queueNumber}
              {activeHeld.customerLabel ? ` · ${activeHeld.customerLabel}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => (heldDirty ? setConfirmCloseHeld(true) : onCloseHeld())}
            className="h-9 px-3 shrink-0 rounded-lg border border-input bg-white text-sm font-semibold text-sidebar hover:bg-muted"
          >
            ปิดบิล
          </button>
        </div>
      ) : (
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
        <h2 className="text-lg font-bold text-sidebar">
          ตะกร้า
          {itemCount > 0 && (
            <span className="ml-2 text-sm font-medium text-muted-foreground">
              {itemCount} ชิ้น
            </span>
          )}
        </h2>
        {cartItems.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-destructive/10 text-destructive text-sm font-semibold hover:bg-destructive/20 transition-colors"
          >
            <Trash2 size={16} />
            ล้างทั้งหมด
          </button>
        )}
      </div>
      )}

      {/* Cart items */}
      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {cartItems.length === 0 ? (
          <div className="py-10 text-center">
            {lastHeld && (
              <div className="mx-auto mb-3 w-fit rounded-lg bg-accent/10 px-5 py-3">
                <p className="text-sm font-medium text-accent">
                  {lastHeld.saved ? "บันทึกบิลพักแล้ว" : "พักบิลแล้ว"}
                </p>
                <p className="text-3xl font-bold text-accent tabular-nums">คิว {lastHeld.queueNumber}</p>
                {lastHeld.customerLabel && (
                  <p className="text-base font-medium text-sidebar">{lastHeld.customerLabel}</p>
                )}
              </div>
            )}
            {lastOrderNumber && lastQueueNumber !== null && (
              <div className="mb-2">
                <p className="text-sm font-medium text-muted-foreground">คิว</p>
                <p className="text-5xl font-bold text-accent tabular-nums leading-none">
                  {lastQueueNumber}
                </p>
              </div>
            )}
            {lastOrderNumber && (
              <p className="text-base font-semibold text-sidebar mb-2">
                ออเดอร์ {lastOrderNumber} สำเร็จ ✓
              </p>
            )}
            {lastOrderNumber && lastCashTender && (
              <div className="mx-auto mb-3 w-fit rounded-lg bg-success/10 px-5 py-2.5 text-success">
                <p className="text-sm tabular-nums">
                  รับเงิน ฿{lastCashTender.received.toFixed(2)}
                </p>
                <p className="text-2xl font-bold tabular-nums">
                  ทอน ฿{lastCashTender.change.toFixed(2)}
                </p>
              </div>
            )}
            <p className="text-muted-foreground text-base">แตะเมนูเพื่อเพิ่มลงตะกร้า</p>
          </div>
        ) : (
          cartItems.map((item) => (
            <div key={item.cartItemKey} className="flex items-center gap-3 px-4 py-3">
              {/* Tapping the item text opens its note — the whole block is the target, not a tiny icon */}
              <button
                type="button"
                onClick={() => setNoteKey(item.cartItemKey)}
                className="flex-1 min-w-0 text-left rounded-md -mx-1 px-1 hover:bg-muted/60 active:bg-muted transition-colors"
              >
                <p className="text-base font-semibold text-sidebar leading-snug line-clamp-2">
                  {item.name}
                </p>
                {item.selectedModifiers.length > 0 && (
                  <p className="text-sm text-muted-foreground leading-snug mt-0.5 line-clamp-2">
                    {item.selectedModifiers.map((m) => m.optionName).join(", ")}
                  </p>
                )}
                {item.note && (
                  <p className="text-sm text-accent font-medium leading-snug mt-0.5 line-clamp-2">
                    📝 {item.note}
                  </p>
                )}
                <p className="text-sm text-muted-foreground tabular-nums mt-0.5">
                  ฿{formatPrice(item.totalPrice / item.quantity)} / ชิ้น
                  {!item.note && <span className="text-accent/80"> · + หมายเหตุ</span>}
                </p>
              </button>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <p className="text-base font-bold text-sidebar tabular-nums">
                  ฿{formatPrice(item.totalPrice)}
                </p>
                {/* Qty controls */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onUpdateQty(item.cartItemKey, item.quantity - 1)}
                    className="w-10 h-10 rounded-lg border border-input text-xl font-semibold text-sidebar flex items-center justify-center hover:bg-muted active:bg-muted transition-colors"
                    aria-label="ลดจำนวน"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-lg font-semibold tabular-nums">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateQty(item.cartItemKey, item.quantity + 1)}
                    className="w-10 h-10 rounded-lg border border-input text-xl font-semibold text-sidebar flex items-center justify-center hover:bg-muted active:bg-muted transition-colors"
                    aria-label="เพิ่มจำนวน"
                  >
                    +
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(item.cartItemKey)}
                className="w-10 h-10 shrink-0 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center hover:bg-destructive/20 transition-colors"
                aria-label="ลบสินค้า"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-4 py-3 space-y-2.5 shrink-0">
        {/* Order type */}
        <div className="flex gap-2">
          {(["dine_in", "take_away"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onOrderTypeChange(type)}
              className={choiceCls(orderType === type)}
            >
              {type === "dine_in" ? "ทานที่ร้าน" : "Take Away"}
            </button>
          ))}
        </div>

        {/* Member + discount */}
        <div className="flex gap-2">
          {customer ? (
            <div className="flex-1 min-w-0 flex items-center h-11 rounded-lg border border-accent/40 bg-accent/5 pl-3 pr-1">
              <UserRound size={18} className="text-accent shrink-0" />
              <span className="flex-1 min-w-0 truncate ml-2 text-base font-medium text-sidebar tabular-nums">
                {customer.phone ?? "สมาชิก"}
              </span>
              <button
                type="button"
                onClick={handleClearCustomer}
                aria-label="ยกเลิกสมาชิก"
                className="w-9 h-9 shrink-0 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowMemberModal(true)}
              className={SECONDARY_CLS}
            >
              <UserRound size={18} />
              สมาชิก
            </button>
          )}
          {discountType === null && (
            <button
              type="button"
              onClick={() => setShowDiscountModal(true)}
              disabled={cartItems.length === 0}
              className={SECONDARY_CLS}
            >
              <Percent size={18} />
              ส่วนลด
            </button>
          )}
        </div>

        {/* Applied discount — edited in DiscountModal, not inline */}
        {discountType !== null && (
          <div className="space-y-1">
            <div className="flex items-center h-11 rounded-lg border border-destructive/30 bg-destructive/5 pl-3 pr-1 gap-2">
              <Percent size={18} className="text-destructive shrink-0" />
              <span className="flex-1 min-w-0 truncate text-base font-medium text-sidebar">
                ส่วนลด {discountType === "percent" ? `${discountValue}%` : `฿${discountValue}`}
              </span>
              <button
                type="button"
                onClick={() => setShowDiscountModal(true)}
                className="h-9 px-3 shrink-0 rounded-md text-sm font-semibold text-accent hover:bg-accent/10"
              >
                แก้ไข
              </button>
              <button
                type="button"
                onClick={onCancelDiscount}
                aria-label="ลบส่วนลด"
                className="w-9 h-9 shrink-0 rounded-md text-destructive hover:bg-destructive/10 flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>
            {discountExceedsSubtotal && (
              <p className="text-sm text-destructive">
                ส่วนลดมากกว่ายอดรวม กรุณาแก้ไขส่วนลด
              </p>
            )}
          </div>
        )}

        {/* Total */}
        <div>
          {discountType !== null && discountAmount > 0 && (
            <>
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>ยอดก่อนลด</span>
                <span className="tabular-nums">฿{formatPrice(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm text-destructive">
                <span>ส่วนลด</span>
                <span className="tabular-nums">-฿{formatPrice(discountAmount)}</span>
              </div>
            </>
          )}
          <div className="flex items-baseline justify-between text-sidebar">
            <span className="text-lg font-semibold">รวม</span>
            <span className="text-3xl font-bold tabular-nums">฿{formatPrice(total)}</span>
          </div>
        </div>

        {/* Payment method */}
        <div className="flex gap-2">
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              onClick={() => onPaymentChange(method)}
              className={choiceCls(paymentMethod === method)}
            >
              {PAYMENT_LABELS[method]}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-sm text-destructive font-medium">{error}</p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onHold}
            disabled={cartItems.length === 0 || pending || holdPending || discountExceedsSubtotal}
            className="w-[38%] h-14 shrink-0 rounded-xl border-2 border-accent bg-white text-accent text-base font-bold leading-tight hover:bg-accent/10 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            {holdPending ? "กำลังบันทึก…" : activeHeld ? "บันทึกบิลพัก" : "พักบิล"}
          </button>
          <Button
            type="button"
            onClick={onCheckout}
            disabled={
              cartItems.length === 0 ||
              pending ||
              holdPending ||
              discountExceedsSubtotal ||
              (requiresApproval && !hasApproverPin)
            }
            className="flex-1 h-14 rounded-xl bg-accent hover:bg-accent/90 text-white text-xl font-bold"
          >
            {pending ? "กำลังบันทึก…" : `ชำระ ฿${formatPrice(total)}`}
          </Button>
        </div>
      </div>

      {confirmCloseHeld && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4 text-center">
            <h2 className="text-lg font-bold text-sidebar">ปิดบิลโดยไม่บันทึก?</h2>
            <p className="text-base text-muted-foreground">
              การแก้ไขล่าสุดจะหายไป บิลพักจะยังเป็นแบบเดิม
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => setConfirmCloseHeld(false)}
                className="flex-1 h-12 bg-white border border-input text-sidebar text-base hover:bg-muted"
              >
                กลับไปแก้ไข
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setConfirmCloseHeld(false);
                  onCloseHeld();
                }}
                className="flex-1 h-12 bg-destructive hover:bg-destructive/90 text-white text-base"
              >
                ปิดโดยไม่บันทึก
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Clear-cart confirmation: the bigger, red button is also easier to hit by accident */}
      {confirmClear && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmClear(false);
          }}
        >
          <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4 text-center">
            <h2 className="text-lg font-bold text-sidebar">ล้างตะกร้าทั้งหมด?</h2>
            <p className="text-base text-muted-foreground">
              สินค้า {itemCount} ชิ้นในตะกร้าจะถูกลบออก
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="flex-1 h-12 bg-white border border-input text-sidebar text-base hover:bg-muted"
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setConfirmClear(false);
                  handleClearCustomer();
                  onClear();
                }}
                className="flex-1 h-12 bg-destructive hover:bg-destructive/90 text-white text-base"
              >
                ล้างทั้งหมด
              </Button>
            </div>
          </div>
        </div>
      )}

      {noteKey !== null &&
        (() => {
          const item = cartItems.find((i) => i.cartItemKey === noteKey);
          if (!item) return null;
          return (
            <NoteModal
              itemName={item.name}
              initialNote={item.note ?? ""}
              onSave={(note) => {
                onSetNote(item.cartItemKey, note);
                setNoteKey(null);
              }}
              onCancel={() => setNoteKey(null)}
            />
          );
        })()}

      {showDiscountModal && (
        <DiscountModal
          subtotal={subtotal}
          initialType={discountType}
          initialValue={discountValue}
          initialReason={discountReason}
          onApply={(type, value, reason, pin) => {
            onApplyDiscount(type, value, reason, pin);
            setShowDiscountModal(false);
          }}
          onCancel={() => setShowDiscountModal(false)}
        />
      )}

      {showMemberModal && (
        <MemberModal
          onLinked={(id, phone) => {
            onCustomerChange({ id, phone });
            setShowMemberModal(false);
          }}
          onCancel={() => setShowMemberModal(false)}
        />
      )}

      {/* Discount approval modal */}
      {requiresApproval && !hasApproverPin && !discountExceedsSubtotal && !showDiscountModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4">
            <h2 className="text-lg font-bold text-sidebar text-center">
              ขออนุมัติส่วนลด
            </h2>
            <p className="text-sm text-muted-foreground text-center">
              ส่วนลดนี้เกินเพดาน ต้องได้รับอนุมัติจาก Manager หรือ Owner
            </p>

            <div className="space-y-1.5">
              <Label htmlFor={reasonId}>เหตุผลที่ให้ส่วนลด</Label>
              <textarea
                id={reasonId}
                value={discountReason}
                onChange={(e) => onDiscountReasonChange(e.target.value)}
                required
                rows={2}
                className="w-full rounded-md border border-input px-3 py-2 text-sm"
                placeholder="เช่น ลูกค้าประจำ, โปรโมชั่นพิเศษ"
              />
            </div>

            <div className="space-y-1.5">
              <Label>PIN ของ Manager/Owner เพื่ออนุมัติ</Label>
              <PinPad
                disabled={discountReason.trim() === ""}
                onComplete={onApproverPinComplete}
              />
              {discountReason.trim() === "" && (
                <p className="text-xs text-muted-foreground text-center">
                  กรอกเหตุผลก่อนกดตัวเลข
                </p>
              )}
            </div>

            {error && (
              <p className="text-sm text-destructive font-medium text-center">
                {error}
              </p>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={onCancelDiscount}
              className="w-full"
            >
              ยกเลิกส่วนลด
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
