"use client";
import { formatPrice } from "@/lib/cash";
import { Fragment, useId, useState } from "react";
import { Percent, Trash2, UserRound, X } from "lucide-react";
import type { CartItem } from "@/types/app";
import type { DiscountType } from "@/lib/discount";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PinPad } from "@/components/ui/pin-pad";
import { MemberModal } from "./member-modal";
import { DiscountModal } from "./discount-modal";
import { NoteModal } from "./note-modal";
import { DisabledReason } from "./disabled-reason";
import { OfflineSaleResult } from "./offline-sale-result";
import type { OfflineResult } from "./outbox-sale";
import type { Gate } from "@/lib/offline/feature-gates";
import { cartLineParts, HOUSE_GLASS_WORD, type LinePart } from "@/lib/stock/option-window";
import { MAX_BAGS, stepBags } from "@/lib/bags";

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
  /** A neutral note (e.g. the cart was restored after a reload). */
  notice?: string | null;
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
  /** The last sale stored on the device (round C2), shown in place of a bill number. */
  lastOffline: OfflineResult | null;
  /** What needs the server right now (feature-gates.ts): disabled ones show why. */
  gates: { pinDiscount: Gate; hold: Gate; member: Gate };
  /** False until the device's outbox has been read once: paying waits for it. */
  paymentReady: boolean;
  /** Why ชำระ is off right now (e.g. an earlier device save is still settling); null = none. */
  payBlockedReason?: string | null;
  /** A line's bean/sweetness words then its options, non-defaults marked (round D1). */
  lineDetail?: (item: CartItem) => LinePart[];
  /** True when tapping the line reopens the option window; otherwise the tap edits its note. */
  canEditOptions?: (item: CartItem) => boolean;
  onEditOptions?: (key: string) => void;
  /** The line's "แก้วร้าน" toggle: shown only for a menu with packaging or a house-glass default (round D2a). */
  houseGlassToggle?: (item: CartItem) => { shown: boolean; on: boolean };
  onToggleHouseGlass?: (key: string) => void;
  /** The carry-out bag counter; null = the shop has no bag material, nothing shown. */
  bags?: { count: number; onChange: (count: number) => void } | null;
};

function reasonOf(g: Gate): string | null {
  return g.enabled ? null : g.reason;
}

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
  notice = null,
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
  lastOffline,
  gates,
  paymentReady,
  payBlockedReason = null,
  lineDetail,
  canEditOptions,
  onEditOptions,
  houseGlassToggle,
  onToggleHouseGlass,
  bags = null,
}: Props) {
  const reasonId = useId();
  const pinReason = reasonOf(gates.pinDiscount);
  const holdReason = reasonOf(gates.hold);
  const memberReason = reasonOf(gates.member);
  // A discount that needs a manager PIN never goes into a bill stored on the device (spec 6b).
  const pinDiscountBlocked = requiresApproval && pinReason !== null;
  // The mockup's one grey line: "ส่วนลดที่ต้องใช้ PIN · พักบิล — ใช้ไม่ได้ตอนเน็ตหลุด". Grouped by
  // reason, though every server feature shares the same one at any moment.
  const disabledGroups = new Map<string, string[]>();
  for (const [what, reason] of [
    ["ส่วนลดที่ต้องใช้ PIN", pinReason],
    [activeHeld ? "บันทึกบิลพัก" : "พักบิล", holdReason],
    ["สมาชิก", customer ? null : memberReason],
  ] as const) {
    if (reason === null) continue;
    disabledGroups.set(reason, [...(disabledGroups.get(reason) ?? []), what]);
  }
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
            {lastOffline && (
              <OfflineSaleResult
                queueNumber={lastOffline.queueNumber}
                cashReceived={lastOffline.cashReceived}
                changeAmount={lastOffline.changeAmount}
                orderNumber={lastOffline.orderNumber}
              />
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
          cartItems.map((item) => {
            // Menus with options reopen the option window (pre-filled; saving replaces the line);
            // the rest open the note editor. The whole text block is the target, not a tiny icon.
            const editsOptions = canEditOptions?.(item) === true && onEditOptions !== undefined;
            // Without the catalog (no lineDetail) the words still show, just none marked as a choice.
            const parts = lineDetail?.(item) ?? cartLineParts(item, null);
            const openEditor = () => (editsOptions ? onEditOptions(item.cartItemKey) : setNoteKey(item.cartItemKey));
            const hint = editsOptions ? "แตะเพื่อแก้ไข" : !item.note ? "+ หมายเหตุ" : null;
            const glass = houseGlassToggle?.(item);
            return (
              <div key={item.cartItemKey} className="px-4 py-3">
                {/* Rows 1-2 and the note are one button (opens the editor); the controls row below holds
                    sibling buttons, so no button nests in another. */}
                <button
                  type="button"
                  onClick={openEditor}
                  className="block w-[calc(100%+0.5rem)] text-left rounded-md -mx-1 px-1 hover:bg-muted/60 active:bg-muted transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <p className="flex-1 min-w-0 text-[17px] font-semibold text-sidebar leading-snug line-clamp-2">
                      {item.name}
                    </p>
                    <div className="shrink-0 text-right">
                      <p className="text-[17px] font-bold text-sidebar tabular-nums leading-snug">
                        ฿{formatPrice(item.totalPrice)}
                      </p>
                      {item.quantity > 1 && (
                        <p className="text-[13px] text-muted-foreground tabular-nums">
                          ฿{formatPrice(item.totalPrice / item.quantity)} / ชิ้น
                        </p>
                      )}
                    </div>
                  </div>
                  {parts.length > 0 && (
                    // Every brew choice — bean, sweetness, then each chosen option — with the ones that
                    // are not the menu default (every option, R42) bold accent, so the barista sees at a
                    // glance which cup is different. Never clamped: a hidden choice is a wrong cup.
                    <p className="text-sm text-sidebar leading-snug mt-0.5">
                      {parts.map((part, i) => (
                        <Fragment key={i}>
                          {i > 0 && " · "}
                          <span className={part.changed ? "font-bold text-accent" : undefined}>{part.text}</span>
                        </Fragment>
                      ))}
                    </p>
                  )}
                  {item.note && (
                    <p className="text-sm text-accent font-medium leading-snug mt-0.5 line-clamp-2">
                      📝 {item.note}
                    </p>
                  )}
                </button>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => onRemove(item.cartItemKey)}
                    className="w-12 h-12 shrink-0 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center hover:bg-destructive/20 transition-colors"
                    aria-label={`ลบ ${item.name}`}
                  >
                    <Trash2 size={18} />
                  </button>
                  {hint ? (
                    <button
                      type="button"
                      onClick={openEditor}
                      className="flex-1 min-w-0 min-h-12 text-left text-[13px] text-accent/80 truncate"
                    >
                      {hint}
                    </button>
                  ) : (
                    <div className="flex-1 min-w-0" />
                  )}
                  {glass?.shown && onToggleHouseGlass && (
                    // A word in both states ("แก้วร้าน" / "แก้วร้าน ✓"), never colour alone. Same cup,
                    // same price: it only changes what stock is used.
                    <button
                      type="button"
                      onClick={() => onToggleHouseGlass(item.cartItemKey)}
                      aria-pressed={glass.on}
                      className={
                        "h-12 min-w-12 shrink-0 rounded-lg border px-2.5 text-sm font-semibold whitespace-nowrap transition-colors " +
                        (glass.on
                          ? "border-accent bg-accent text-white"
                          : "border-input bg-white text-sidebar hover:border-accent hover:text-accent")
                      }
                    >
                      {glass.on ? `${HOUSE_GLASS_WORD} ✓` : HOUSE_GLASS_WORD}
                    </button>
                  )}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onUpdateQty(item.cartItemKey, item.quantity - 1)}
                      className="w-12 h-12 rounded-lg border border-input text-xl font-semibold text-sidebar flex items-center justify-center hover:bg-muted active:bg-muted transition-colors"
                      aria-label="ลดจำนวน"
                    >
                      −
                    </button>
                    <span className="w-7 text-center text-lg font-semibold tabular-nums">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => onUpdateQty(item.cartItemKey, item.quantity + 1)}
                      className="w-12 h-12 rounded-lg border border-input text-xl font-semibold text-sidebar flex items-center justify-center hover:bg-muted active:bg-muted transition-colors"
                      aria-label="เพิ่มจำนวน"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            );
          })
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
              disabled={memberReason !== null}
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

        {/* Carry-out bags: only for a shop that counts bags; starts at the automatic count */}
        {bags && (
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold text-sidebar">ถุง</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => bags.onChange(stepBags(bags.count, -1))}
                disabled={bags.count <= 0}
                className="w-12 h-12 rounded-lg border border-input text-xl font-semibold text-sidebar flex items-center justify-center hover:bg-muted active:bg-muted disabled:opacity-40 disabled:pointer-events-none transition-colors"
                aria-label="ลดจำนวนถุง"
              >
                −
              </button>
              <span className="w-10 text-center text-lg font-semibold tabular-nums" aria-live="polite">
                {bags.count}
              </span>
              <button
                type="button"
                onClick={() => bags.onChange(stepBags(bags.count, 1))}
                disabled={bags.count >= MAX_BAGS}
                className="w-12 h-12 rounded-lg border border-input text-xl font-semibold text-sidebar flex items-center justify-center hover:bg-muted active:bg-muted disabled:opacity-40 disabled:pointer-events-none transition-colors"
                aria-label="เพิ่มจำนวนถุง"
              >
                +
              </button>
            </div>
          </div>
        )}

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

        {notice && !error && <p className="text-sm text-info font-medium">{notice}</p>}
        {error && (
          <p className="text-sm text-destructive font-medium">{error}</p>
        )}

        {[...disabledGroups].map(([reason, what]) => (
          <DisabledReason key={reason} what={what} reason={reason} />
        ))}
        {payBlockedReason && (
          <p className="text-sm font-medium text-muted-foreground">{payBlockedReason}</p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onHold}
            disabled={
              cartItems.length === 0 ||
              pending ||
              holdPending ||
              discountExceedsSubtotal ||
              holdReason !== null
            }
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
              (requiresApproval && !hasApproverPin) ||
              pinDiscountBlocked ||
              !paymentReady
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
          approvalBlockedReason={pinReason}
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

            {pinReason !== null ? (
              // The PIN is checked by the server and never stored on the device, so a discount that
              // needs it waits until the connection is back and no bills are waiting.
              <DisabledReason what={["ส่วนลดที่ต้องใช้ PIN"]} reason={pinReason} className="text-sm" />
            ) : (
            <>
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
            </>
            )}

            {notice && !error && (
              <p className="text-sm text-info font-medium text-center">{notice}</p>
            )}
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
