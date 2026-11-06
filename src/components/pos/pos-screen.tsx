"use client";
import { formatPrice } from "@/lib/cash";
import { cartSubtotal, lineTotal } from "@/lib/cart-math";
import { useEffect, useState, useTransition, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { checkOrderSaved, createOrder } from "@/app/actions/orders";
import {
  attemptFingerprint,
  cartWarning,
  CONNECTION_RETRY_MESSAGE,
  PAYMENT_DEADLINE_MS,
  UNRESOLVED_PAYMENT_MESSAGE,
  withDeadline,
} from "@/lib/payment-attempt";
import { holdBill, updateHeldBill, type HeldBillInput } from "@/app/actions/held-bills";
import type { CancelledHeldBill, HeldBillSummary } from "@/lib/dal";
import { computeDiscount, type DiscountType } from "@/lib/discount";
import type {
  CartItem,
  ModifierWithOptions,
  OfflineSale,
  PosCategory,
  PosProduct,
  SavedOrder,
} from "@/types/app";
import { gate, type Gate } from "@/lib/offline/feature-gates";
import { requestPersistentStorage } from "@/lib/offline/idb";
import type { OutboxEntry } from "@/lib/offline/outbox-rules";
import { useOutbox } from "./use-outbox";
import {
  deviceQueueOf,
  dropAttempt,
  isFinal,
  makeEntry,
  readEntry,
  saleDisplay,
  SAVE_ON_DEVICE_FAILED,
  type OfflineResult,
  type SaleDisplay,
  type SaleInput,
} from "./outbox-sale";
import { PosHeader } from "./pos-header";
import { ProductGrid } from "./product-grid";
import { ModifierModal } from "./modifier-modal";
import { SmartCart } from "./smart-cart";
import { QrPaymentModal } from "./qr-payment-modal";
import { NoShiftDialog } from "./no-shift-dialog";
import { NO_OPEN_SHIFT_MESSAGE } from "@/lib/shift-errors";
import { CashPaymentModal } from "./cash-payment-modal";
import { StatusBanners } from "./status-banners";
import { useHeartbeat } from "./use-heartbeat";
import { useDeviceSnapshot } from "./use-device-snapshot";
import { canAutoReload, RESULT_HOLD_MS } from "@/lib/connectivity";
import { HoldBillModal } from "./hold-bill-modal";
import { HeldBillsPanel } from "./held-bills-panel";
import { ReviewPanel } from "./review-panel";
import { useCartDraft } from "./use-cart-draft";
import type { CartDraft } from "@/lib/offline/cart-draft";

const MAX_DISCOUNT_PIN_ATTEMPTS = 5;
/** The online attempt's crash backup is best-effort: a slow device store never holds up a sale. */
const ATTEMPT_BACKUP_DEADLINE_MS = 3000;
const ENTRY_MISSING = "outbox_entry_missing";

/**
 * Date.now() for code that runs only in event handlers and async callbacks. The React Compiler lint
 * (react-hooks/purity) treats closures passed as custom-hook arguments as possibly run during
 * render (useOutbox's onChecked → handleChecked → applySuccess), so it flags a direct Date.now()
 * there. Nothing impure actually runs during render.
 */
function eventTime(): number {
  return Date.now();
}

function reasonOf(g: Gate): string | null {
  return g.enabled ? null : g.reason;
}

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
  /** The shop's PromptPay ID; the QR is drawn on the device from it. */
  promptpayId: string | null;
  tenantId: string;
  /** The signed-in user (profile.id); recorded on offline sales. */
  sellerId: string;
  /** Server Date.now() when this page was rendered. */
  renderedAt: number;
  todayQueueLast: number;
  todayQueueDate: string;
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
  promptpayId,
  tenantId,
  sellerId,
  renderedAt,
  todayQueueLast,
  todayQueueDate,
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
  const [showNoShift, setShowNoShift] = useState(false);
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
  const [checkoutPending, setCheckoutPending] = useState(false);
  // Set synchronously on the first confirm tap, so a fast double-tap can't slip a second
  // createOrder in before checkoutPending re-renders the confirm button as disabled.
  const submittingRef = useRef(false);
  // The payment attempt in progress: its client_ref is reused by every retry of the same cart.
  const attemptRef = useRef<{ fingerprint: string; clientRef: string } | null>(null);
  // The last try of that attempt got no answer, so it may or may not have been saved.
  const [uncertain, setUncertain] = useState(false);
  // An attempt nobody could confirm (even checkOrderSaved got no answer), set by this screen. The
  // warning also shows for every check-only entry in the outbox (unresolvedRef below), so it
  // survives a reload; it is re-checked before a new attempt.
  const [localUnresolved, setLocalUnresolved] = useState<string | null>(null);
  // When the current result (order number, change, parked bill) appeared; holds off auto-reload.
  const [resultShownAt, setResultShownAt] = useState<number | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const paymentWindowOpenRef = useRef(false);
  // Round C2: the last sale stored on the device, why storing failed (shown in the payment
  // window), the review list, and bills the server gave another queue number (spec call 15).
  const [lastOffline, setLastOffline] = useState<OfflineResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [queueChanges, setQueueChanges] = useState<{ device: number; server: number }[]>([]);
  // What the last online try sent (never the PIN): บันทึกไว้ในเครื่อง stores exactly that.
  const lastTryRef = useRef<{ clientRef: string; input: SaleInput; display: SaleDisplay } | null>(
    null
  );
  // The cart in progress is kept on the device so a reload brings it back (spec call 16). The
  // draft never holds the manager PIN: a restored discount that needs approval has no approval
  // (hasApproverPin is false), so the cart asks for it again like a resumed held bill's.
  const draftDiscount = useMemo(
    () => (discountType === null ? null : { type: discountType, value: discountValue, reason: discountReason }),
    [discountType, discountValue, discountReason]
  );
  const { discard: discardDraft } = useCartDraft({
    tenantId,
    sellerId,
    items: cartItems,
    orderType,
    paymentMethod,
    customer,
    activeHeld,
    discount: draftDiscount,
    onRestore: restoreDraft,
  });
  const heartbeat = useHeartbeat();
  // C1's no-crying-wolf rule: offline only after two failed checks (or the browser says so).
  const online = heartbeat.connectivity.status === "online";
  // The device snapshot starts from this page and follows the heartbeat, so a tab left open never
  // draws a QR to an account the owner has since changed, and keeps the latest shift and queue
  // for offline sales.
  const snapshot = useDeviceSnapshot({
    tenantId,
    page: {
      at: renderedAt,
      shiftId: activeShiftId,
      promptpayId,
      queue: { date: todayQueueDate, last: todayQueueLast },
    },
    heartbeat,
  });
  const currentPromptpayId = snapshot.promptpayId;
  useEffect(() => {
    paymentWindowOpenRef.current = showCashModal || showQrModal;
  }, [showCashModal, showQrModal]);

  // The device's outbox and its sender. Sending pauses for the whole payment window (retries
  // included, note D) so it never competes with the cashier's own payment.
  const outbox = useOutbox({
    tenantId,
    online,
    paused: showCashModal || showQrModal || checkoutPending,
    wakeAt: heartbeat.lastSuccessAt,
    onSynced: (e, saved) => handleSynced(e, saved),
    onChecked: (clientRef, saved) => handleChecked(clientRef, saved),
  });
  // Offline, or bills still waiting: sales take a device queue number and go to the outbox.
  const deviceNumbered = outbox.deviceNumbered;
  const gateState = { online, pendingCount: outbox.counts.pending };
  const pinDiscountGate = gate("pin_discount", gateState);
  const holdGate = gate("hold", gateState);
  const resumeHeldGate = gate("resume_held", gateState);
  const memberGate = gate("member", gateState);
  const shiftGate = gate("shift", gateState);
  const checkOnlyRef = outbox.entries.find((e) => e.state === "check-only")?.clientRef ?? null;
  const unresolvedRef = localUnresolved ?? checkOnlyRef;

  // Ask once for storage the browser won't clear on its own (spec call 13).
  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  // The queue-number notes belong to the green bar they were sent in: drop them once it hides.
  const [prevJustFinished, setPrevJustFinished] = useState<number | null>(null);
  if (outbox.justFinished !== prevJustFinished) {
    setPrevJustFinished(outbox.justFinished);
    if (outbox.justFinished === null && queueChanges.length > 0) setQueueChanges([]);
  }

  const productsWithModifiers = useMemo(
    () => new Set(Object.keys(productModifierRecord)),
    [productModifierRecord]
  );

  const productModifierMap = useMemo(
    () => new Map(Object.entries(productModifierRecord)),
    [productModifierRecord]
  );

  const subtotal = cartSubtotal(cartItems);
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
          return {
            ...i,
            quantity: i.quantity + 1,
            totalPrice: lineTotal(i.basePrice, i.selectedModifiers, i.quantity + 1),
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
          return { ...i, quantity: qty, totalPrice: lineTotal(i.basePrice, i.selectedModifiers, qty) };
        })
      );
    }
  }

  function removeItem(key: string) {
    setCartItems((prev) => prev.filter((i) => i.cartItemKey !== key));
  }

  function restoreDraft(d: CartDraft) {
    setCartItems(repriceFromMenu(d.items));
    setOrderType(d.orderType);
    setPaymentMethod(d.paymentMethod);
    setCustomer(d.customer);
    if (d.discount) {
      setDiscountType(d.discount.type);
      setDiscountValue(d.discount.value);
      setDiscountReason(d.discount.reason);
    }
    setActiveHeld(d.activeHeld);
    // The held bill's loaded items are not known any more: treat it as edited (never loses edits).
    setLoadedSnapshot(null);
    setError("กู้ตะกร้าที่ค้างไว้");
  }

  function clearCart() {
    discardDraft();
    attemptRef.current = null;
    setUncertain(false);
    setLocalUnresolved(null);
    setResultShownAt(null);
    setCartItems([]);
    setError(null);
    setSaveError(null);
    setLastOrderNumber(null);
    setLastQueueNumber(null);
    setLastCashTender(null);
    setLastHeld(null);
    setLastOffline(null);
    setCustomer(null);
    setActiveHeld(null);
    setLoadedSnapshot(null);
    resetDiscount();
  }

  type SavedSale = {
    orderNumber: string;
    queueNumber: number;
    cashReceived: number | null;
    changeAmount: number | null;
  };

  // A sale is done: show its numbers and empty the cart. Shared by a normal success and by a
  // payment that ended without an answer and turned out (checkOrderSaved) to be saved.
  function applySuccess(sale: SavedSale) {
    discardDraft();
    attemptRef.current = null;
    setUncertain(false);
    setLocalUnresolved(null);
    setError(null);
    setSaveError(null);
    setLastOffline(null);
    setResultShownAt(eventTime());
    setLastOrderNumber(sale.orderNumber);
    setLastQueueNumber(sale.queueNumber);
    snapshot.observe(sale.queueNumber);
    setLastCashTender(
      sale.cashReceived !== null && sale.changeAmount !== null
        ? { received: sale.cashReceived, change: sale.changeAmount }
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

  // Asks whether an attempt that got no answer was saved. Saved → the normal success state, or, if
  // the cashier has changed the cart since, a notice that leaves the new cart alone; not saved →
  // the cart stays for another try; no answer at all → the warning stays (unresolvedRef).
  async function resolveUncertain(clientRef: string): Promise<"saved" | "not-saved" | "unknown"> {
    let res: Awaited<ReturnType<typeof checkOrderSaved>>;
    try {
      res = await withDeadline(checkOrderSaved(clientRef, tenantId), PAYMENT_DEADLINE_MS);
    } catch {
      res = { error: UNRESOLVED_PAYMENT_MESSAGE };
    }
    // `uncertain` is about the attempt in the payment window; another check-only entry (an
    // earlier one, or another tab's) being answered must not touch it.
    if (attemptRef.current === null || attemptRef.current.clientRef === clientRef) {
      setUncertain(false);
    }
    if ("saved" in res && res.saved) {
      // Settled: the outbox's crash backup of this attempt goes (a final bill would stay).
      void dropAttempt(clientRef, tenantId);
      if (
        attemptRef.current?.clientRef === clientRef &&
        attemptRef.current.fingerprint === fingerprintRef.current
      ) {
        applySuccess(res);
      } else {
        setLocalUnresolved((ref) => (ref === clientRef ? null : ref));
        // Already on screen as this sale's result (e.g. its late answer arrived): no notice.
        if (res.orderNumber !== lastOrderNumberRef.current) {
          setError(`บิลก่อนหน้าบันทึกแล้ว (${res.orderNumber}) · ตรวจตะกร้าก่อนชำระ`);
        }
      }
      return "saved";
    }
    if ("saved" in res) {
      void dropAttempt(clientRef, tenantId);
      setLocalUnresolved((ref) => (ref === clientRef ? null : ref));
      setError(null);
      return "not-saved";
    }
    // Nobody could tell: keep it as check-only, so the warning survives a reload and the sender
    // asks again once the connection is back. If even that write fails, the warning still stays
    // here (note B).
    setLocalUnresolved(clientRef);
    setError(null);
    outbox.markCheckOnly(clientRef).catch(() => {});
    return "unknown";
  }

  /** A bill the outbox sent reached the server; nothing shows per bill, the bars carry the news. */
  function handleSynced(e: OutboxEntry, saved: SavedOrder) {
    snapshot.observe(saved.queueNumber);
    const device = e.offline?.queueNumber;
    if (device !== undefined && saved.queueNumber !== device) {
      setQueueChanges((list) => [...list, { device, server: saved.queueNumber }]);
    }
    // A held bill paid offline is now closed on the server: drop it from the held list.
    if (e.input.heldBillId !== undefined) router.refresh();
  }

  /** The sender answered a check-only entry: saved, or not saved (null). */
  function handleChecked(clientRef: string, saved: Omit<SavedOrder, "orderId"> | null) {
    setLocalUnresolved((ref) => (ref === clientRef ? null : ref));
    if (saved === null) return;
    snapshot.observe(saved.queueNumber);
    if (
      attemptRef.current?.clientRef === clientRef &&
      attemptRef.current.fingerprint === fingerprintRef.current
    ) {
      applySuccess(saved);
    } else if (clientRef === unresolvedRef && saved.orderNumber !== lastOrderNumberRef.current) {
      setError(`บิลก่อนหน้าบันทึกแล้ว (${saved.orderNumber}) · ตรวจตะกร้าก่อนชำระ`);
    }
  }

  // The current cart as a payment attempt; mirrored in a ref so an answer that arrives later can
  // tell whether the cashier has changed the cart since.
  const currentFingerprint = attemptFingerprint({
    items: cartItems,
    paymentMethod,
    orderType,
    customerId: customer?.id ?? null,
    discountType,
    discountValue,
    heldBillId: activeHeld?.id ?? null,
    heldBillVersion: activeHeld?.version ?? null,
  });
  const fingerprintRef = useRef(currentFingerprint);
  useEffect(() => {
    fingerprintRef.current = currentFingerprint;
  }, [currentFingerprint]);
  // The bill number on screen, for answers that arrive later (a check must not announce as
  // "previous" the very sale whose result is already showing).
  const lastOrderNumberRef = useRef(lastOrderNumber);
  useEffect(() => {
    lastOrderNumberRef.current = lastOrderNumber;
  }, [lastOrderNumber]);

  /** This cart as a sale for createOrder and the outbox. It never carries the manager PIN. */
  function saleInput(clientRef: string, cashReceived: number | undefined): SaleInput {
    return {
      items: cartItems,
      paymentMethod,
      orderType,
      customerId: customer?.id ?? undefined,
      discountType: discountAmount > 0 ? (discountType ?? undefined) : undefined,
      discountValue: discountAmount > 0 ? parsedDiscountValue : undefined,
      discountReason: discountReason.trim() !== "" ? discountReason.trim() : undefined,
      cashReceived,
      heldBillId: activeHeld?.id,
      heldBillVersion: activeHeld?.version,
      clientRef,
    };
  }

  /** One client_ref per payment attempt: a retry of the same cart reuses it (payment-attempt.ts). */
  function clientRefForCart(): string {
    const fingerprint = currentFingerprint;
    if (attemptRef.current?.fingerprint !== fingerprint) {
      attemptRef.current = { fingerprint, clientRef: crypto.randomUUID() };
    }
    return attemptRef.current.clientRef;
  }

  // A sale stored on the device: show its queue number and empty the cart (spec goal 2). Called
  // only once the outbox write has resolved.
  function showOfflineResult(result: OfflineResult, clientRef: string) {
    discardDraft();
    attemptRef.current = null;
    lastTryRef.current = null;
    setUncertain(false);
    setLocalUnresolved((ref) => (ref === clientRef ? null : ref));
    setError(null);
    setSaveError(null);
    setLastOrderNumber(null);
    setLastQueueNumber(null);
    setLastCashTender(null);
    setLastHeld(null);
    setLastOffline(result);
    setResultShownAt(eventTime());
    setCartItems([]);
    setCustomer(null);
    resetDiscount();
    // No router.refresh() here: offline it can't load. The held list refreshes once it is sent.
    setActiveHeld(null);
    setLoadedSnapshot(null);
    setShowCashModal(false);
    setShowQrModal(false);
    paymentWindowOpenRef.current = false;
  }

  // A device-numbered cash sale with no shift the device knows is open: the cash window gives way
  // to NoShiftDialog. If a try of this attempt got no answer, it may have been saved, so it is
  // kept as check-only (the cart's warning, re-checked before the next payment) instead of being
  // left behind by the window that offered ลองอีกครั้ง.
  function leaveCashForNoShift() {
    if (uncertain && attemptRef.current) {
      const ref = attemptRef.current.clientRef;
      setLocalUnresolved(ref);
      outbox.markCheckOnly(ref).catch(() => {});
    }
    setUncertain(false);
    setShowCashModal(false);
    paymentWindowOpenRef.current = false;
    setError(null);
    setShowNoShift(true);
  }

  /** "A PIN discount waits for the connection" (spec 6b), in the payment window. */
  function pinDiscountMessage(): string {
    return `ส่วนลดที่ต้องใช้ PIN — ${reasonOf(pinDiscountGate) ?? "ใช้ไม่ได้ตอนเน็ตหลุด"}`;
  }

  // Device-numbered mode at confirm: the server is never called. The bill takes a device queue
  // number and goes into the outbox as a final `pending` entry; the sender sends it later.
  async function sellOnDevice(cashReceived: number | undefined) {
    // A sale whose discount needed a manager PIN never goes to the device (spec 6b).
    if (requiresApproval) {
      setSaveError(pinDiscountMessage());
      return;
    }
    // Cash needs a shift the device knows is open.
    if (paymentMethod === "cash" && snapshot.shiftId === null) {
      leaveCashForNoShift();
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    // The same attempt as an earlier try that got no answer keeps its client_ref: if the server
    // did save it, sending it later just returns that bill.
    const clientRef = clientRefForCart();
    const input = saleInput(clientRef, cashReceived);
    setError(null);
    setSaveError(null);
    setCheckoutPending(true);
    try {
      // Already stored as a final bill (a tap that raced the result): show it, take no new number.
      const existing = await readEntry(clientRef, tenantId);
      if (existing && isFinal(existing)) {
        showOfflineResult(
          {
            queueNumber: deviceQueueOf(existing) ?? 0,
            cashReceived: existing.display.cashReceived,
            changeAmount: existing.display.changeAmount,
          },
          clientRef
        );
        return;
      }
      // Rejects when the device can't store the number (note I): the sale is blocked.
      const queueNumber = await snapshot.takeNext();
      const offline: OfflineSale = {
        tenantId,
        sellerId,
        soldAt: new Date().toISOString(),
        queueNumber,
        shiftId: snapshot.shiftId,
      };
      const entry = makeEntry({
        clientRef,
        tenantId,
        sellerId,
        state: "pending",
        input,
        display: saleDisplay(input, total, queueNumber),
        offline,
      });
      // Replaces this attempt's own attempt/check-only backup, if any (same client_ref).
      await outbox.put(entry);
      showOfflineResult(
        {
          queueNumber,
          cashReceived: entry.display.cashReceived,
          changeAmount: entry.display.changeAmount,
        },
        clientRef
      );
    } catch {
      // Nothing was stored: the cart stays and the window says so.
      setSaveError(SAVE_ON_DEVICE_FAILED);
    } finally {
      submittingRef.current = false;
      setCheckoutPending(false);
    }
  }

  // บันทึกไว้ในเครื่อง after a try got no answer (spec goal 11): the attempt becomes a final
  // pending bill with the same client_ref, so it can never record twice.
  async function saveAttemptToDevice() {
    const last = lastTryRef.current;
    if (!last || attemptRef.current?.clientRef !== last.clientRef) return;
    if (requiresApproval) return; // the button is disabled for these (spec 6b)
    // Same rule as sellOnDevice: a stored cash bill needs a shift the device knows is open.
    if (last.input.paymentMethod === "cash" && snapshot.shiftId === null) {
      leaveCashForNoShift();
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaveError(null);
    setCheckoutPending(true);
    try {
      const existing = await readEntry(last.clientRef, tenantId);
      if (existing && isFinal(existing)) {
        showOfflineResult(
          {
            queueNumber: deviceQueueOf(existing) ?? 0,
            cashReceived: existing.display.cashReceived,
            changeAmount: existing.display.changeAmount,
          },
          last.clientRef
        );
        return;
      }
      const queueNumber = await snapshot.takeNext();
      const offline: OfflineSale = {
        tenantId,
        sellerId,
        soldAt: new Date().toISOString(),
        queueNumber,
        shiftId: snapshot.shiftId,
      };
      try {
        await outbox.finalize(last.clientRef, offline);
      } catch (err) {
        if (!(err instanceof Error && err.message === ENTRY_MISSING)) throw err;
        // The attempt is gone (e.g. another tab found it "not saved"): store the bill afresh with
        // the same client_ref (note B). The server replays it if it was in fact saved.
        await outbox.put(
          makeEntry({
            clientRef: last.clientRef,
            tenantId,
            sellerId,
            state: "pending",
            input: last.input,
            display: { ...last.display, queueNumber },
            offline,
          })
        );
      }
      showOfflineResult(
        {
          queueNumber,
          cashReceived: last.display.cashReceived,
          changeAmount: last.display.changeAmount,
        },
        last.clientRef
      );
    } catch {
      setSaveError(SAVE_ON_DEVICE_FAILED);
    } finally {
      submittingRef.current = false;
      setCheckoutPending(false);
    }
  }

  /** The online try's crash backup: an `attempt` entry, put fresh before every try (note A). */
  async function backUpAttempt(clientRef: string, input: SaleInput, display: SaleDisplay) {
    // Never over a final bill with this ref (it must not drop back to an attempt).
    const existing = await readEntry(clientRef, tenantId);
    if (existing && isFinal(existing)) return;
    await outbox.put(
      makeEntry({ clientRef, tenantId, sellerId, state: "attempt", input, display, offline: null })
    );
  }

  function submitOrder(
    cashReceived: number | undefined,
    onSettled?: (errorMessage: string | null, noAnswer: boolean) => void
  ) {
    // Re-checked here, not just in handleCheckout: this is the single write path (also reached
    // via the QR/transfer confirm flow), so the approval invariant must hold regardless of how
    // we got here, not just at the moment the "ชำระ" button was tapped.
    if (requiresApproval && !hasApproverPin) return;
    // Offline, or bills still waiting: the sale goes to the device's outbox instead.
    if (deviceNumbered) {
      void sellOnDevice(cashReceived);
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    // One client_ref per payment attempt: a retry of the same cart reuses it, so a sale whose
    // response was lost is returned instead of being recorded twice (see payment-attempt.ts).
    const clientRef = clientRefForCart();
    const input = saleInput(clientRef, cashReceived);
    const display = saleDisplay(input, total, null);
    lastTryRef.current = { clientRef, input, display };
    setError(null);
    setSaveError(null);
    setLastOrderNumber(null);
    setLastQueueNumber(null);
    setLastCashTender(null);
    setLastHeld(null);
    setLastOffline(null);
    setResultShownAt(null);
    // Not a transition: Next.js runs server actions one at a time, and a transition stays pending
    // for as long as a stalled createOrder does — the window would read "กำลังบันทึก…" long after
    // PAYMENT_DEADLINE_MS gave up on it. This flag tracks only this try.
    setCheckoutPending(true);
    void (async () => {
      let result: Awaited<ReturnType<typeof createOrder>>;
      let noAnswer = false;
      try {
        await withDeadline(backUpAttempt(clientRef, input, display), ATTEMPT_BACKUP_DEADLINE_MS);
      } catch {
        // Only a crash backup: the sale goes on without it.
      }
      try {
        const call = createOrder({ ...input, approverPin: approverPin ?? undefined });
        // A stalled connection must not trap the cashier: after PAYMENT_DEADLINE_MS it counts as no
        // answer (a retry reuses the client_ref, so giving up is safe). If the call still succeeds
        // later and the cart is still this attempt, show that sale.
        call
          .then((late) => {
            if ("error" in late) return;
            void dropAttempt(clientRef, tenantId);
            if (attemptRef.current?.clientRef === clientRef) applySuccess(late);
          })
          .catch(() => {});
        result = await withDeadline(call, PAYMENT_DEADLINE_MS);
      } catch {
        // A dropped connection doesn't mean the sale failed — the server may have saved it before
        // the response was lost. Retrying sends the same client_ref, so it is always safe.
        noAnswer = true;
        result = { error: CONNECTION_RETRY_MESSAGE, outcome: "retry", mayHaveSaved: true };
      } finally {
        submittingRef.current = false;
      }
      // The server itself may say it can't tell (database connection lost): same as no answer.
      if ("error" in result && result.mayHaveSaved) noAnswer = true;
      if ("error" in result) {
        // A definite refusal goes back to the cart and its backup goes; no answer keeps the
        // `attempt` entry (it may have saved).
        if (!noAnswer) void dropAttempt(clientRef, tenantId);
        setUncertain(noAnswer);
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
        // The cashier closed the payment window while this was in flight: nobody is there to
        // tap ลองอีกครั้ง, so find out right away whether it was saved.
        if (noAnswer) heartbeat.checkNow();
        if (noAnswer && !paymentWindowOpenRef.current) void resolveUncertain(clientRef);
      } else {
        applySuccess(result);
      }
      onSettled?.("error" in result ? result.error : null, noAnswer);
    })().finally(() => setCheckoutPending(false));
  }

  // Cancel/close of a payment window. A try in flight keeps running and settles on its own; an
  // attempt that got no answer is resolved (checkOrderSaved) before the cart is offered again.
  function closePaymentWindow() {
    setShowCashModal(false);
    setShowQrModal(false);
    paymentWindowOpenRef.current = false;
    setSaveError(null);
    if (checkoutPending) return;
    if (uncertain && attemptRef.current) {
      void resolveUncertain(attemptRef.current.clientRef);
    } else {
      setError(null);
    }
  }

  async function handleCheckout() {
    // Until the outbox has been read, nobody knows whether bills are already waiting (which
    // would make this a device-numbered sale): wait for it, never guess either way.
    if (!outbox.loaded) return;
    if (requiresApproval && !hasApproverPin) return;
    // Offline or bills still waiting: a discount that needs a PIN waits (the button says why).
    if (deviceNumbered && requiresApproval) return;
    setSaveError(null);
    // An earlier attempt nobody could confirm: find out first, before this cart gets a new
    // client_ref and the same customer is charged twice. Offline there is nobody to ask; the
    // same cart keeps that attempt's client_ref, so storing it can't record it twice.
    if (
      unresolvedRef !== null &&
      online &&
      (await resolveUncertain(unresolvedRef)) === "saved"
    ) {
      return;
    }
    // Device-numbered cash needs a shift the device knows is open (the latest it has seen).
    const shiftOpen = deviceNumbered ? snapshot.shiftId !== null : activeShiftId !== null;
    if (paymentMethod === "cash" && !shiftOpen) {
      setError(null);
      setShowMobileCart(false);
      setShowNoShift(true);
      return;
    }
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
    submitOrder(undefined, (errorMessage, noAnswer) => {
      // No answer: the window stays open on ลองอีกครั้ง. A definite refusal is shown in the cart.
      if (!noAnswer) setShowQrModal(false);
    });
  }

  function handleCashConfirm(cashReceived: number) {
    submitOrder(cashReceived, (errorMessage, noAnswer) => {
      // On most failures the modal stays open showing the error, so the cashier can retry
      // without re-typing the amount — including no answer at all, where ลองอีกครั้ง resends the
      // same attempt. Exception: a rejected discount PIN has to be re-entered in the cart's
      // approval dialog, which this modal would cover.
      if (errorMessage === null || (errorMessage === "PIN ไม่ถูกต้อง" && !noAnswer)) {
        setShowCashModal(false);
      }
      // The shift was closed (e.g. on another device) after this page loaded.
      if (errorMessage === NO_OPEN_SHIFT_MESSAGE) {
        setShowCashModal(false);
        setError(null);
        setShowNoShift(true);
        router.refresh();
      }
    });
  }

  function payByTransferInstead() {
    setShowNoShift(false);
    setPaymentMethod("transfer");
    setShowQrModal(true);
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
    discardDraft();
    setCartItems([]);
    setCustomer(null);
    resetDiscount();
    setActiveHeld(null);
    setLoadedSnapshot(null);
    setError(null);
    setLastOrderNumber(null);
    setLastQueueNumber(null);
    setLastCashTender(null);
    setLastOffline(null);
    setLastHeld({ queueNumber, customerLabel, saved });
    setResultShownAt(eventTime());
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
            snapshot.observe(res.queueNumber);
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
    if (!holdGate.enabled) return; // needs the server (the cart says why)
    setError(null);
    if (activeHeld) {
      void parkCurrent("");
    } else {
      setHoldError(null);
      setShowMobileCart(false);
      setShowHoldModal(true);
    }
  }

  // A held bill stores prices as of when it was parked. If the menu price changed since, paying it
  // as-is would be rejected by the server's re-pricing — and a refresh wouldn't help, because the
  // old price lives in the held bill itself. So lines are re-priced from the current menu on load;
  // anything no longer on sale is left untouched for the server to reject with a clear message.
  function repriceFromMenu(items: CartItem[]): CartItem[] {
    return items.map((item) => {
      const product = products.find((p) => p.id === item.productId);
      if (!product) return item;
      const selectedModifiers = item.selectedModifiers.map((m) => {
        const option = allModifiers
          .find((mod) => mod.id === m.modifierId)
          ?.options.find((o) => o.id === m.optionId);
        return option ? { ...m, priceDelta: option.priceDelta } : m;
      });
      return {
        ...item,
        basePrice: product.price,
        selectedModifiers,
        totalPrice: lineTotal(product.price, selectedModifiers, item.quantity),
      };
    });
  }

  function resumeHeld(bill: HeldBillSummary) {
    const items = repriceFromMenu(bill.items);
    setCartItems(items);
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
    // Snapshot the re-priced items so a price refresh alone doesn't count as an unsaved edit.
    setLoadedSnapshot(JSON.stringify(items));
    setError(null);
    setLastOrderNumber(null);
    setLastQueueNumber(null);
    setLastCashTender(null);
    setLastHeld(null);
    setLastOffline(null);
    setShowHeldPanel(false);
  }

  async function parkThenResume(bill: HeldBillSummary) {
    if (!holdGate.enabled || !resumeHeldGate.enabled) return;
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

  // A newer deployment is live: reload into it by itself, but only when nothing on the POS can be
  // lost. Dialogs owned by child components (discount, note, approval PIN pad) are caught by the
  // DOM check; otherwise the update bar waits for the cashier's tap.
  const anyDialogOpen =
    showQrModal ||
    showCashModal ||
    showHoldModal ||
    showHeldPanel ||
    showNoShift ||
    showMobileCart ||
    showReview ||
    pendingProduct !== null;
  const paymentUnresolved = uncertain || checkoutPending || unresolvedRef !== null;
  const cartGates = { pinDiscount: pinDiscountGate, hold: holdGate, member: memberGate };
  // บันทึกไว้ในเครื่อง: only after a try got no answer, and never for a PIN discount (spec 6b).
  const saveToDevice = uncertain
    ? {
        onSave: () => void saveAttemptToDevice(),
        disabledReason: reasonOf(
          gate("save_to_device", { ...gateState, attemptHasPinDiscount: requiresApproval })
        ),
      }
    : null;
  useEffect(() => {
    if (!heartbeat.newVersionAvailable) return;
    const resultAgeMs = resultShownAt === null ? null : Date.now() - resultShownAt;
    const idle = canAutoReload({
      cartCount: cartItems.length,
      heldLoaded: activeHeld !== null,
      anyDialogOpen,
      paymentUnresolved,
      resultAgeMs,
      online,
    });
    if (idle && document.querySelector('[role="dialog"], .fixed.inset-0') === null) {
      window.location.reload();
      return;
    }
    // Only the result on screen is holding it back: look again once it has been read.
    if (resultAgeMs !== null && resultAgeMs < RESULT_HOLD_MS) {
      const timer = setTimeout(() => setReloadTick((n) => n + 1), RESULT_HOLD_MS - resultAgeMs);
      return () => clearTimeout(timer);
    }
  }, [
    heartbeat.newVersionAvailable,
    cartItems.length,
    activeHeld,
    anyDialogOpen,
    paymentUnresolved,
    resultShownAt,
    online,
    reloadTick,
  ]);

  // Back online with an attempt nobody could confirm: settle it now, before anyone pays again.
  // Not while a payment window is open: its answer would land in that window's message (the
  // outbox entries can now hold an earlier or another tab's attempt). It runs once it closes.
  const paymentWindowOpen = showCashModal || showQrModal;
  useEffect(() => {
    if (!online || unresolvedRef === null || paymentWindowOpen) return;
    const timer = setTimeout(() => void resolveUncertain(unresolvedRef), 0);
    return () => clearTimeout(timer);
    // resolveUncertain is recreated each render; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, unresolvedRef, paymentWindowOpen]);

  // 8rem = the phone layout's top bar + bottom nav. From md up neither exists (sidebar instead), so
  // only main's p-6 (3rem) is subtracted — the old 8rem left ~80px unused under the cart on iPad.
  // dvh tracks Safari's toolbar showing/hiding.
  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] md:h-[calc(100dvh-3rem)]">
      <StatusBanners
        offline={!online}
        pendingCount={outbox.counts.pending}
        progress={outbox.progress}
        justFinished={outbox.justFinished}
        reviewCount={outbox.counts.review}
        onOpenReview={() => {
          setShowMobileCart(false);
          setShowReview((v) => !v);
        }}
        updateAvailable={heartbeat.newVersionAvailable}
        onRefresh={() => window.location.reload()}
        queueChanges={queueChanges}
      />
      <PosHeader
        userName={userName}
        todayOrderCount={todayOrderCount}
        hasActiveShift={deviceNumbered ? snapshot.shiftId !== null : activeShiftId !== null}
        heldCount={heldBills.length}
        onOpenHeld={() => {
          setShowMobileCart(false);
          setShowHeldPanel(true);
        }}
        shiftDisabledReason={reasonOf(shiftGate)}
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
            error={cartWarning(error, unresolvedRef)}
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
            lastOffline={lastOffline}
            gates={cartGates}
            paymentReady={outbox.loaded}
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
                error={cartWarning(error, unresolvedRef)}
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
                lastOffline={lastOffline}
                gates={cartGates}
                paymentReady={outbox.loaded}
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
          promptpayId={currentPromptpayId}
          pending={checkoutPending}
          error={saveError ?? (uncertain ? error : null)}
          onConfirm={handleQrConfirm}
          onCancel={closePaymentWindow}
          saveToDevice={saveToDevice}
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
          bills={heldBills.map((bill) => {
            // Show what the cashier will actually charge: the same current-menu prices resumeHeld uses.
            const items = repriceFromMenu(bill.items);
            const sub = cartSubtotal(items);
            return {
              ...bill,
              items,
              total: computeDiscount(sub, bill.discountType, bill.discountValue ?? 0).total,
            };
          })}
          cancelledToday={cancelledHeldToday}
          activeHeldId={activeHeld?.id ?? null}
          cartBusy={cartBusy}
          busyCartAction={activeHeld ? "save" : "hold"}
          onResume={(bill) => {
            if (resumeHeldGate.enabled) resumeHeld(bill);
          }}
          onParkCurrentThenResume={(bill) => void parkThenResume(bill)}
          onCancelled={handleHeldCancelled}
          onClose={() => setShowHeldPanel(false)}
          resumeDisabledReason={reasonOf(resumeHeldGate)}
        />
      )}
      {showNoShift && (
        <NoShiftDialog
          onGoToShifts={() => {
            if (shiftGate.enabled) router.push("/shifts");
          }}
          onPayByTransfer={payByTransferInstead}
          onClose={() => setShowNoShift(false)}
          shiftDisabledReason={reasonOf(shiftGate)}
        />
      )}
      {showCashModal && (
        <CashPaymentModal
          total={total}
          pending={checkoutPending}
          error={saveError ?? error}
          retryable={uncertain}
          onConfirm={handleCashConfirm}
          onCancel={closePaymentWindow}
          saveToDevice={saveToDevice}
        />
      )}
      {showReview && (
        <ReviewPanel
          entries={outbox.entries.filter((e) => e.state === "review")}
          online={online}
          remove={outbox.remove}
          onRecorded={() => {
            // The outbox already dropped the entry and the list updates itself; the bill's number
            // is shown in the panel. Nothing else on the screen depends on it.
          }}
          onClose={() => setShowReview(false)}
        />
      )}

    </div>
  );
}
