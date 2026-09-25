"use client";
import { formatPrice } from "@/lib/cash";
import { useState, useTransition, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { createOrder } from "@/app/actions/orders";
import { holdBill, updateHeldBill, type HeldBillInput } from "@/app/actions/held-bills";
import type { CancelledHeldBill, HeldBillSummary } from "@/lib/dal";
import { computeDiscount, type DiscountType } from "@/lib/discount";
import type {
  CartItem,
  ModifierWithOptions,
  PosCategory,
  PosProduct,
} from "@/types/app";
import { PosHeader } from "./pos-header";
import { ProductGrid } from "./product-grid";
import { ModifierModal } from "./modifier-modal";
import { SmartCart } from "./smart-cart";
import { QrPaymentModal } from "./qr-payment-modal";
import { CashPaymentModal } from "./cash-payment-modal";
import { HoldBillModal } from "./hold-bill-modal";
import { HeldBillsPanel } from "./held-bills-panel";

const MAX_DISCOUNT_PIN_ATTEMPTS = 5;

type Props = {
  products: PosProduct[];
  categories: PosCategory[];
  productModifierRecord: Record<string, string[]>;
  allModifiers: ModifierWithOptions[];
  userName: string;
  todayOrderCount: number;
  activeShiftId: string | null;
  heldBills: HeldBillSummary[];
  cancelledHeldToday: CancelledHeldBill[];
};

type ActiveHeld = { id: string; version: number; queueNumber: number; customerLabel: string | null };
type Customer = { id: string; phone: string | null };

export function PosScreen({
  products,
  categories,
  productModifierRecord,
  allModifiers,
  userName,
  todayOrderCount,
  activeShiftId,
  heldBills,
  cancelledHeldToday,
}: Props) {
  const router = useRouter();
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [pendingProduct, setPendingProduct] = useState<PosProduct | null>(null);
  const [orderType, setOrderType] = useState<"dine_in" | "take_away">("dine_in");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer">("cash");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [discountType, setDiscountType] = useState<DiscountType | null>(null);
  const [discountValue, setDiscountValue] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [approverPin, setApproverPin] = useState<string | null>(null);
  const [approvedForAmount, setApprovedForAmount] = useState<number | null>(null);
  const [pinAttempts, setPinAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastOrderNumber, setLastOrderNumber] = useState<string | null>(null);
  const [lastQueueNumber, setLastQueueNumber] = useState<number | null>(null);
  const [lastCashTender, setLastCashTender] = useState<{ received: number; change: number } | null>(
    null
  );
  const [showQrModal, setShowQrModal] = useState(false);
  const [showCashModal, setShowCashModal] = useState(false);
  const [showMobileCart, setShowMobileCart] = useState(false);
  // Held bill currently loaded in the cart, and the items it had when loaded (for the dirty check).
  const [activeHeld, setActiveHeld] = useState<ActiveHeld | null>(null);
  const [loadedSnapshot, setLoadedSnapshot] = useState<string | null>(null);
  const [lastHeld, setLastHeld] = useState<
    { queueNumber: number; customerLabel: string | null; saved: boolean } | null
  >(null);
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [holdError, setHoldError] = useState<string | null>(null);
  const [showHeldPanel, setShowHeldPanel] = useState(false);
  const [holdPending, startHold] = useTransition();
  const [checkoutPending, startCheckout] = useTransition();
  // Set synchronously on the first confirm tap, so a fast double-tap can't slip a second
  // createOrder in before checkoutPending re-renders the confirm button as disabled.
  const submittingRef = useRef(false);

  const productsWithModifiers = useMemo(
    () => new Set(Object.keys(productModifierRecord)),
    [productModifierRecord]
  );

  const productModifierMap = useMemo(
    () => new Map(Object.entries(productModifierRecord)),
    [productModifierRecord]
  );

  const subtotal = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const parsedDiscountValue = Number(discountValue);
  const { discountAmount, requiresApproval, total } = computeDiscount(
    subtotal,
    discountType,
    Number.isFinite(parsedDiscountValue) ? parsedDiscountValue : 0
  );
  const hasApproverPin = approverPin !== null && approvedForAmount === discountAmount;
  const discountExceedsSubtotal =
    (discountType === "amount" &&
      Number.isFinite(parsedDiscountValue) &&
      parsedDiscountValue > 0 &&
      parsedDiscountValue > subtotal) ||
    (discountType === "percent" &&
      Number.isFinite(parsedDiscountValue) &&
      parsedDiscountValue > 100);

  function resetDiscount() {
    setDiscountType(null);
    setDiscountValue("");
    setDiscountReason("");
    setApproverPin(null);
    setApprovedForAmount(null);
    setPinAttempts(0);
  }

  // Commits a discount from DiscountModal in one step. The approval is bound to the amount computed
  // here from the *new* values — handleApproverPinCapture's discountAmount would still be the old
  // render's value at this point — so hasApproverPin only holds for exactly this discount, and any
  // later cart change that moves the amount drops back to the cart's re-approval dialog.
  function applyDiscount(
    type: DiscountType,
    value: string,
    reason: string,
    pin: string | null
  ) {
    setDiscountType(type);
    setDiscountValue(value);
    setDiscountReason(reason);
    if (pin !== null) {
      setApproverPin(pin);
      setApprovedForAmount(computeDiscount(subtotal, type, Number(value)).discountAmount);
    } else {
      setApproverPin(null);
      setApprovedForAmount(null);
    }
  }

  function handleApproverPinCapture(pin: string) {
    setApproverPin(pin);
    setApprovedForAmount(discountAmount);
  }

  function handleProductClick(product: PosProduct) {
    if (productsWithModifiers.has(product.id)) {
      setPendingProduct(product);
    } else {
      addDirectToCart(product);
    }
  }

  function addDirectToCart(product: PosProduct) {
    setCartItems((prev) => {
      const existing = prev.find((i) => i.cartItemKey === product.id);
      if (existing) {
        return prev.map((i) => {
          if (i.cartItemKey !== product.id) return i;
          const unitPrice =
            i.basePrice +
            i.selectedModifiers.reduce((s, m) => s + m.priceDelta, 0);
          return {
            ...i,
            quantity: i.quantity + 1,
            totalPrice: unitPrice * (i.quantity + 1),
          };
        });
      }
      return [
        ...prev,
        {
          cartItemKey: product.id,
          productId: product.id,
          name: product.name,
          basePrice: product.price,
          quantity: 1,
          selectedModifiers: [],
          note: null,
          totalPrice: product.price,
        },
      ];
    });
  }

  // A direct-tap line is keyed by product.id so repeat taps merge into it. Once it carries a note
  // it gets its own key, so the next plain tap starts a fresh, note-less line instead of silently
  // adding un-noted cups to a noted one.
  function setItemNote(key: string, rawNote: string) {
    const trimmed = rawNote.trim();
    const note = trimmed === "" ? null : trimmed;
    setCartItems((prev) =>
      prev.map((i) => {
        if (i.cartItemKey !== key) return i;
        const cartItemKey =
          note !== null && i.cartItemKey === i.productId
            ? `${i.productId}-${Date.now()}`
            : i.cartItemKey;
        return { ...i, note, cartItemKey };
      })
    );
  }

  function handleAddFromModal(item: CartItem) {
    setCartItems((prev) => [...prev, item]);
    setPendingProduct(null);
  }

  function updateQty(key: string, qty: number) {
    if (qty <= 0) {
      setCartItems((prev) => prev.filter((i) => i.cartItemKey !== key));
    } else {
      setCartItems((prev) =>
        prev.map((i) => {
          if (i.cartItemKey !== key) return i;
          const unitPrice =
            i.basePrice +
            i.selectedModifiers.reduce((s, m) => s + m.priceDelta, 0);
          return { ...i, quantity: qty, totalPrice: unitPrice * qty };
        })
      );
    }
  }

  function removeItem(key: string) {
    setCartItems((prev) => prev.filter((i) => i.cartItemKey !== key));
  }

  function clearCart() {
    setCartItems([]);
    setError(null);
    setLastOrderNumber(null);
    setLastQueueNumber(null);
    setLastCashTender(null);
    setLastHeld(null);
    setCustomer(null);
    setActiveHeld(null);
    setLoadedSnapshot(null);
    resetDiscount();
  }

  function submitOrder(
    cashReceived: number | undefined,
    onSettled?: (errorMessage: string | null, mayHaveSaved: boolean) => void
  ) {
    // Re-checked here, not just in handleCheckout: this is the single write path (also reached
    // via the QR/transfer confirm flow), so the approval invariant must hold regardless of how
    // we got here, not just at the moment the "ชำระ" button was tapped.
    if (requiresApproval && !hasApproverPin) return;
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setLastOrderNumber(null);
    setLastQueueNumber(null);
    setLastCashTender(null);
    setLastHeld(null);
    startCheckout(async () => {
      let result: Awaited<ReturnType<typeof createOrder>>;
      try {
        result = await createOrder({
          items: cartItems,
          paymentMethod,
          orderType,
          customerId: customer?.id ?? undefined,
          discountType: discountAmount > 0 ? (discountType ?? undefined) : undefined,
          discountValue: discountAmount > 0 ? parsedDiscountValue : undefined,
          discountReason: discountReason.trim() !== "" ? discountReason.trim() : undefined,
          approverPin: approverPin ?? undefined,
          cashReceived,
          heldBillId: activeHeld?.id,
          heldBillVersion: activeHeld?.version,
        });
      } catch {
        // A dropped connection doesn't mean the sale failed — the server may have saved it
        // before the response was lost, so warn against blindly re-charging the customer.
        result = {
          error: "เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบหน้ารายการบิลก่อนกดชำระซ้ำ",
          mayHaveSaved: true,
        };
      } finally {
        submittingRef.current = false;
      }
      if ("error" in result) {
        setError(result.error);
        if (result.error === "PIN ไม่ถูกต้อง" && requiresApproval) {
          const next = pinAttempts + 1;
          if (next >= MAX_DISCOUNT_PIN_ATTEMPTS) {
            resetDiscount();
          } else {
            setApproverPin(null);
            setPinAttempts(next);
          }
        }
      } else {
        setLastOrderNumber(result.orderNumber);
        setLastQueueNumber(result.queueNumber);
        setLastCashTender(
          result.cashReceived !== null && result.changeAmount !== null
            ? { received: result.cashReceived, change: result.changeAmount }
            : null
        );
        setCartItems([]);
        setCustomer(null);
        resetDiscount();
        if (activeHeld) {
          setActiveHeld(null);
          setLoadedSnapshot(null);
          router.refresh();
        }
      }
      onSettled?.(
        "error" in result ? result.error : null,
        "error" in result && result.mayHaveSaved === true
      );
    });
  }

  function handleCheckout() {
    if (requiresApproval && !hasApproverPin) return;
    if (paymentMethod === "transfer") {
      setError(null);
      setShowMobileCart(false);
      setShowQrModal(true);
      return;
    }
    setError(null);
    setShowMobileCart(false);
    setShowCashModal(true);
  }

  function handleQrConfirm() {
    submitOrder(undefined, () => setShowQrModal(false));
  }

  function handleCashConfirm(cashReceived: number) {
    submitOrder(cashReceived, (errorMessage, mayHaveSaved) => {
      // On most failures the modal stays open showing the error, so the cashier can retry
      // without re-typing the amount. Exceptions: a rejected discount PIN has to be re-entered in
      // the cart's approval dialog (which this modal would cover), and when the sale may already
      // be saved, a ready-to-tap confirm button is exactly how a customer gets charged twice.
      if (errorMessage === null || errorMessage === "PIN ไม่ถูกต้อง" || mayHaveSaved) {
        setShowCashModal(false);
      }
    });
  }

  const heldDirty = activeHeld !== null && loadedSnapshot !== JSON.stringify(cartItems);
  // Opening another held bill would drop these items: a new unsaved order, or unsaved edits.
  const cartBusy = activeHeld ? heldDirty : cartItems.length > 0;

  function heldInput(customerLabel: string): HeldBillInput {
    return {
      items: cartItems,
      orderType,
      customerId: customer?.id ?? null,
      customerLabel,
      discountType: discountType !== null && discountAmount > 0 ? discountType : null,
      discountValue: discountType !== null && discountAmount > 0 ? parsedDiscountValue : null,
      discountReason,
    };
  }

  function resetAfterPark(queueNumber: number, customerLabel: string | null, saved: boolean) {
    setCartItems([]);
    setCustomer(null);
    resetDiscount();
    setActiveHeld(null);
    setLoadedSnapshot(null);
    setError(null);
    setLastOrderNumber(null);
    setLastQueueNumber(null);
    setLastCashTender(null);
    setLastHeld({ queueNumber, customerLabel, saved });
    router.refresh();
  }

  /** Saves (resumed bill) or holds (new cart) the current cart; resolves true on success so a
   *  resume can be chained after it. */
  function parkCurrent(customerLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
      setHoldError(null);
      startHold(async () => {
        try {
          if (activeHeld) {
            const res = await updateHeldBill(
              activeHeld.id,
              activeHeld.version,
              heldInput(activeHeld.customerLabel ?? "")
            );
            if ("error" in res) {
              setError(res.error);
              resolve(false);
              return;
            }
            resetAfterPark(activeHeld.queueNumber, activeHeld.customerLabel, true);
          } else {
            const res = await holdBill(heldInput(customerLabel));
            if ("error" in res) {
              setHoldError(res.error);
              setError(res.error);
              resolve(false);
              return;
            }
            setShowHoldModal(false);
            const label = customerLabel.trim();
            resetAfterPark(res.queueNumber, label === "" ? null : label, false);
          }
          resolve(true);
        } catch {
          const message = "เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบรายการบิลพักก่อนลองอีกครั้ง";
          setHoldError(message);
          setError(message);
          resolve(false);
        }
      });
    });
  }

  function handleHold() {
    if (cartItems.length === 0) return;
    setError(null);
    if (activeHeld) {
      void parkCurrent("");
    } else {
      setHoldError(null);
      setShowMobileCart(false);
      setShowHoldModal(true);
    }
  }

  function resumeHeld(bill: HeldBillSummary) {
    setCartItems(bill.items);
    setOrderType(bill.orderType);
    setCustomer(bill.customerId ? { id: bill.customerId, phone: bill.customerPhone } : null);
    // The discount comes back without its approval — an over-threshold one is re-approved here.
    resetDiscount();
    if (bill.discountType !== null && bill.discountValue !== null) {
      setDiscountType(bill.discountType);
      setDiscountValue(String(bill.discountValue));
      setDiscountReason(bill.discountReason ?? "");
    }
    setActiveHeld({
      id: bill.id,
      version: bill.version,
      queueNumber: bill.queueNumber,
      customerLabel: bill.customerLabel,
    });
    setLoadedSnapshot(JSON.stringify(bill.items));
    setError(null);
    setLastOrderNumber(null);
    setLastQueueNumber(null);
    setLastCashTender(null);
    setLastHeld(null);
    setShowHeldPanel(false);
  }

  async function parkThenResume(bill: HeldBillSummary) {
    setShowHeldPanel(false);
    const ok = await parkCurrent("");
    if (ok) resumeHeld(bill);
  }

  function handleHeldCancelled(billId: string) {
    if (activeHeld?.id === billId) clearCart();
    router.refresh();
  }

  const pendingProductModifiers: ModifierWithOptions[] = pendingProduct
    ? (productModifierMap.get(pendingProduct.id) ?? [])
        .map((modId) => allModifiers.find((m) => m.id === modId))
        .filter((m): m is ModifierWithOptions => m !== undefined)
    : [];

  // 8rem = the phone layout's top bar + bottom nav. From md up neither exists (sidebar instead), so
  // only main's p-6 (3rem) is subtracted — the old 8rem left ~80px unused under the cart on iPad.
  // dvh tracks Safari's toolbar showing/hiding.
  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] md:h-[calc(100dvh-3rem)]">
      <PosHeader
        userName={userName}
        todayOrderCount={todayOrderCount}
        hasActiveShift={activeShiftId !== null}
        heldCount={heldBills.length}
        onOpenHeld={() => {
          setShowMobileCart(false);
          setShowHeldPanel(true);
        }}
      />
      <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0 mt-2">
        <div className="flex-1 min-w-0 pb-20 md:pb-0">
          <ProductGrid
            products={products}
            categories={categories}
            productsWithModifiers={productsWithModifiers}
            onProductClick={handleProductClick}
          />
        </div>
        <div className="hidden md:block md:w-80 lg:w-[22rem] md:shrink-0">
          <SmartCart
            cartItems={cartItems}
            onUpdateQty={updateQty}
            onRemove={removeItem}
            onSetNote={setItemNote}
            onClear={clearCart}
            orderType={orderType}
            onOrderTypeChange={setOrderType}
            paymentMethod={paymentMethod}
            onPaymentChange={setPaymentMethod}
            customer={customer}
            onCustomerChange={setCustomer}
            discountType={discountType}
            discountValue={discountValue}
            onApplyDiscount={applyDiscount}
            discountReason={discountReason}
            onDiscountReasonChange={setDiscountReason}
            subtotal={subtotal}
            discountAmount={discountAmount}
            requiresApproval={requiresApproval}
            discountExceedsSubtotal={discountExceedsSubtotal}
            total={total}
            hasApproverPin={hasApproverPin}
            onApproverPinComplete={handleApproverPinCapture}
            onCancelDiscount={resetDiscount}
            pending={checkoutPending}
            error={error}
            lastOrderNumber={lastOrderNumber}
            lastQueueNumber={lastQueueNumber}
            lastCashTender={lastCashTender}
            onCheckout={handleCheckout}
            activeHeld={activeHeld}
            heldDirty={heldDirty}
            onCloseHeld={clearCart}
            onHold={handleHold}
            holdPending={holdPending}
            lastHeld={lastHeld}
          />
        </div>
      </div>

      {/* Mobile sticky cart summary bar */}
      <button
        type="button"
        onClick={() => setShowMobileCart(true)}
        className="md:hidden fixed left-0 right-0 bottom-16 z-40 bg-sidebar text-white px-4 py-3 flex items-center justify-between shadow-lg"
      >
        <span className="text-sm">
          <span className="font-semibold tabular-nums">{itemCount}</span> ชิ้น ·{" "}
          <span className="font-bold tabular-nums">฿{formatPrice(total)}</span>
        </span>
        <span className="text-sm font-semibold text-accent">ดูตะกร้า</span>
      </button>

      {/* Mobile cart bottom sheet */}
      {showMobileCart && (
        <div
          className="md:hidden fixed inset-0 z-[60] bg-black/50 flex items-end"
          onClick={() => setShowMobileCart(false)}
        >
          <div
            className="w-full max-h-[85vh] bg-white rounded-t-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <SmartCart
                cartItems={cartItems}
                onUpdateQty={updateQty}
                onRemove={removeItem}
                onSetNote={setItemNote}
                onClear={clearCart}
                orderType={orderType}
                onOrderTypeChange={setOrderType}
                paymentMethod={paymentMethod}
                onPaymentChange={setPaymentMethod}
                customer={customer}
                onCustomerChange={setCustomer}
                discountType={discountType}
                discountValue={discountValue}
                onApplyDiscount={applyDiscount}
                discountReason={discountReason}
                onDiscountReasonChange={setDiscountReason}
                subtotal={subtotal}
                discountAmount={discountAmount}
                requiresApproval={requiresApproval}
                discountExceedsSubtotal={discountExceedsSubtotal}
                total={total}
                hasApproverPin={hasApproverPin}
                onApproverPinComplete={handleApproverPinCapture}
                onCancelDiscount={resetDiscount}
                pending={checkoutPending}
                error={error}
                lastOrderNumber={lastOrderNumber}
                lastQueueNumber={lastQueueNumber}
                lastCashTender={lastCashTender}
                onCheckout={handleCheckout}
                activeHeld={activeHeld}
                heldDirty={heldDirty}
                onCloseHeld={clearCart}
                onHold={handleHold}
                holdPending={holdPending}
                lastHeld={lastHeld}
              />
            </div>
          </div>
        </div>
      )}
      {pendingProduct !== null && (
        <ModifierModal
          product={pendingProduct}
          modifiers={pendingProductModifiers}
          onAddToCart={handleAddFromModal}
          onClose={() => setPendingProduct(null)}
        />
      )}
      {showQrModal && (
        <QrPaymentModal
          total={total}
          onConfirm={handleQrConfirm}
          onCancel={() => setShowQrModal(false)}
        />
      )}
      {showHoldModal && (
        <HoldBillModal
          total={total}
          itemCount={itemCount}
          pending={holdPending}
          error={holdError}
          onConfirm={(label) => void parkCurrent(label)}
          onCancel={() => setShowHoldModal(false)}
        />
      )}
      {showHeldPanel && (
        <HeldBillsPanel
          bills={heldBills}
          cancelledToday={cancelledHeldToday}
          activeHeldId={activeHeld?.id ?? null}
          cartBusy={cartBusy}
          busyCartAction={activeHeld ? "save" : "hold"}
          onResume={resumeHeld}
          onParkCurrentThenResume={(bill) => void parkThenResume(bill)}
          onCancelled={handleHeldCancelled}
          onClose={() => setShowHeldPanel(false)}
        />
      )}
      {showCashModal && (
        <CashPaymentModal
          total={total}
          pending={checkoutPending}
          error={error}
          onConfirm={handleCashConfirm}
          onCancel={() => {
            setError(null);
            setShowCashModal(false);
          }}
        />
      )}
    </div>
  );
}
