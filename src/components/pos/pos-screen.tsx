"use client";
import { formatPrice } from "@/lib/cash";
import { cartSubtotal } from "@/lib/cart-math";
import { addLine, replaceLine, repriceItems, restoreLine, withQuantity } from "@/lib/cart-lines";
import { useToastManager } from "@/components/ui/toast";
import type { StockCatalogRows } from "@/lib/stock/catalog-build";
import { posStock, refreshCatalogOf } from "@/lib/stock/pos-stock";
import { defaultChoices } from "@/lib/stock/pos-choices";
import { cartLineParts, hasOptionRows, houseGlassToggle, optionRows, toggleHouseGlass } from "@/lib/stock/option-window";
import { manualFromDraft, shownBags } from "@/lib/bags";
import { useEffect, useState, useTransition, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { checkOrderSaved, createOrder } from "@/app/actions/orders";
import {
  attemptFingerprint,
  cartWarning,
  CONNECTION_RETRY_MESSAGE,
  DeadlineError,
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
import { adoptableRef, saleKey, type OutboxEntry } from "@/lib/offline/outbox-rules";
import { useOutbox } from "./use-outbox";
import { setPosOnline } from "@/lib/offline/status-store";
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
import { OptionWindow } from "./modifier-modal";
import { SmartCart } from "./smart-cart";
import { QrPaymentModal } from "./qr-payment-modal";
import { NoShiftDialog } from "./no-shift-dialog";
import { NO_OPEN_SHIFT_MESSAGE } from "@/lib/shift-errors";
import { CashPaymentModal } from "./cash-payment-modal";
import { StatusBanners } from "./status-banners";
import type { Levels } from "@/lib/stock/availability";
import { effectiveLevels, type StockAnswer } from "@/lib/stock/live-stock";
import { asksFirst, materialLabel, pauseNoAnswerText, type PauseResult, type TileState } from "@/lib/stock/pos-states";
import { postFlag, postPause } from "@/lib/pos-api";
import { StockStateDialog } from "./stock-state-dialog";
import { StockPanel } from "./stock-panel";
import type { WasteMaterial } from "@/lib/stock/waste-input";
import { useStockStates } from "./use-stock-states";
import { useHeartbeat } from "./use-heartbeat";
import { useDeviceSnapshot } from "./use-device-snapshot";
import { canAutoReload, RESULT_HOLD_MS } from "@/lib/connectivity";
import { receiptUrl } from "@/lib/receipt-link";
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
 * Storing a sale on the device (read, queue number, write) gives up after this: a stuck device
 * store (known on iPad Safari) must never leave the payment window on "กำลังบันทึก…".
 */
const DEVICE_STORE_DEADLINE_MS = 5000;
/** Shown under ชำระ while a device save that missed its deadline has not settled. */
const UNSETTLED_SAVE_MESSAGE = "กำลังบันทึกบิลก่อนหน้า… รอสักครู่ (ถ้าค้างนาน ให้รีเฟรชหน้า)";

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
  /** Bean/matcha and sweetness config for the option window (round D1); null = it could not be loaded. */
  stockRows: StockCatalogRows | null;
  /** Levels and paused menus as the page read them (round D2a); null = the read failed. */
  liveStockRows: StockAnswer | null;
  /** Tracked materials' names, for "ระบบคิดว่า…หมด" (round D2a). No cost. */
  materialNames: Record<string, string>;
  /** Tracked materials for the waste list (round D2a): names, units and purchase sizes. No cost. */
  wasteMaterials: WasteMaterial[];
  /** Owner or manager: "รับของเข้า" shows the optional price field. Staff never do. */
  canSeeReceivePrice: boolean;
  /** The shop counts carry-out bags (tenants.bag_material_id is set): the counter shows (round D2a). */
  bagsEnabled: boolean;
  /** One bag per this many cups for the automatic count; null = no rule (starts at 0). */
  bagsPerCups: number | null;
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
  stockRows,
  liveStockRows,
  materialNames,
  wasteMaterials,
  canSeeReceivePrice,
  bagsEnabled,
  bagsPerCups,
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
  const toast = useToastManager();
  // Bumped whenever the cart is replaced or settled (sale, clear, park, resume, restored draft): an
  // undo toast from an earlier cart must then do nothing, never put a line into another bill.
  const cartEpochRef = useRef(0);
  // The option window: a menu just tapped (editing null) or a cart line being edited.
  const [optionWindow, setOptionWindow] = useState<
    { product: PosProduct; editing: CartItem | null } | null
  >(null);
  // A "หมด?" or "ปิดขาย" tile just tapped: its one question before the cup goes on (round D2a).
  const [stockAsk, setStockAsk] = useState<{ product: PosProduct; state: TileState } | null>(null);
  // null = automatic (defaultBags of the cups); set once the cashier taps − or + (this bill only).
  const [manualBags, setManualBags] = useState<number | null>(null);
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
  /** The bill behind the after-sale result: its client_ref is the receipt QR's token. */
  const [lastReceiptRef, setLastReceiptRef] = useState<string | null>(null);
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
  const [showStockPanel, setShowStockPanel] = useState(false);
  const [holdPending, startHold] = useTransition();
  const [checkoutPending, setCheckoutPending] = useState(false);
  // Set synchronously on the first confirm tap, so a fast double-tap can't slip a second
  // createOrder in before checkoutPending re-renders the confirm button as disabled.
  const submittingRef = useRef(false);
  // The payment attempt in progress: its client_ref is reused by every retry of the same cart.
  const attemptRef = useRef<{ fingerprint: string; clientRef: string } | null>(null);
  // A cart brought back after a reload together with the client_ref of its own payment attempt
  // (saved in the draft), whose answer may have been lost: while the cart is still exactly the
  // restored one it takes over that ref (adoptRestoredAttempt), so paying it again can only
  // replay its own bill. Only that ref, never one found by matching the cart's contents.
  const restoredRef = useRef<{ fingerprint: string; clientRef: string } | null>(null);
  // attemptRef's client_ref as state, for the cart draft: a reload keeps the attempt's identity.
  // Set whenever a payment try starts (clientRefForCart), cleared whenever the cart is finished.
  const [draftAttemptRef, setDraftAttemptRef] = useState<string | null>(null);
  // Device saves that missed DEVICE_STORE_DEADLINE_MS and have not settled yet: their write may
  // still land, so no new sale starts until each one has (ชำระ stays off, with a reason).
  const [unsettledSaves, setUnsettledSaves] = useState(0);
  // The client_ref of the sale whose result was last shown (online or on the device): a device
  // write that lands after its deadline for that same sale needs no notice.
  const settledRef = useRef<string | null>(null);
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
  /** The bill behind lastOffline, so its card can show the bill number once it is sent. */
  const lastOfflineRefKey = useRef<string | null>(null);
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
  const [notice, setNotice] = useState<string | null>(null);
  // The bag count on screen: the cashier's own value, else one per bagsPerCups cups. 0 without a bag material.
  const shownBagCount = bagsEnabled
    ? shownBags(manualBags, cartItems.reduce((sum, item) => sum + item.quantity, 0), bagsPerCups)
    : 0;
  const { discard: discardDraftRaw } = useCartDraft({
    tenantId,
    sellerId,
    items: cartItems,
    orderType,
    paymentMethod,
    customer,
    activeHeld,
    discount: draftDiscount,
    bags: shownBagCount,
    attemptRef: draftAttemptRef,
    onRestore: restoreDraft,
  });
  const discardDraft = () => {
    discardDraftRaw();
    setNotice(null);
  };
  const heartbeat = useHeartbeat();
  // C1's no-crying-wolf rule: offline only after two failed checks (or the browser says so).
  const online = heartbeat.connectivity.status === "online";
  // The app shell (nav guard) follows the same verdict.
  useEffect(() => {
    setPosOnline(online);
  }, [online]);
  // The device snapshot starts from this page and follows the heartbeat, so a tab left open never
  // draws a QR to an account the owner has since changed, and keeps the latest shift and queue
  // for offline sales.
  const pageStock = useMemo(
    () => (liveStockRows ? { at: renderedAt, ...liveStockRows } : null),
    [liveStockRows, renderedAt]
  );
  const snapshot = useDeviceSnapshot({
    tenantId,
    page: {
      at: renderedAt,
      shiftId: activeShiftId,
      promptpayId,
      queue: { date: todayQueueDate, last: todayQueueLast },
      stock: pageStock,
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

  // The client builds the catalog from the page's rows with the server's own builder. Rows that
  // could not be loaded or built -> not loaded: an empty catalog (menus sell with no bean/sweetness
  // rows, the server applies each menu's defaults), a warning line on the POS, no cart word marked,
  // and saved lines keep their choices exactly as stored (refreshCatalog null).
  const stock = useMemo(
    () => posStock(stockRows, (e) => console.error("[pos] stock catalog could not be built:", e)),
    [stockRows]
  );
  const stockCatalog = stock.catalog;
  const refreshCatalog = refreshCatalogOf(stock);

  // Live stock (round D2a): the heartbeat's levels and paused menus (snapshot.stock, raw), and the levels
  // shown: those minus what this device's queued bills will take once they are sent. Online the server's
  // levels already include every synced bill; offline it is the last known levels. Suppressions use the
  // raw levels, so a queued bill syncing never ends one (final review I2). Hints only — nothing here
  // ever blocks a sale.
  const shownLevels: Levels | null = useMemo(
    () => (snapshot.stock ? effectiveLevels(snapshot.stock.levels, outbox.entries, tenantId, stockCatalog) : null),
    [snapshot.stock, outbox.entries, tenantId, stockCatalog]
  );
  const productIds = useMemo(() => products.map((p) => p.id), [products]);
  // Each tile's "ปิดขาย / หมด? / เหลือ ~N แก้ว", and what this iPad stopped asking about (R-D2a-21).
  const stockStates = useStockStates({
    tenantId,
    renderedAt,
    liveStock: snapshot.stock,
    shownLevels,
    catalog: stockCatalog,
    productIds,
  });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Menus that open the option window: linked options, or bean/sweetness rows.
  const productsWithOptions = useMemo(() => {
    const set = new Set(Object.keys(productModifierRecord));
    for (const p of products) {
      if (hasOptionRows(optionRows(p.id, stockCatalog))) set.add(p.id);
    }
    return set;
  }, [productModifierRecord, products, stockCatalog]);

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

  // A tap on a menu tile: "หมด?" and "ปิดขาย" ask once first (never refuse); "ok" and "เหลือ ~N แก้ว"
  // go on exactly as before, with no extra tap.
  function handleProductClick(product: PosProduct) {
    tapTile(product, stockStates.tileStates.get(product.id));
  }

  function tapTile(product: PosProduct, state: TileState | undefined) {
    if (state && asksFirst(state)) setStockAsk({ product, state });
    else openProduct(product);
  }

  /** The cup goes on: the option window, or straight into the cart for a menu without one. */
  function openProduct(product: PosProduct) {
    if (productsWithOptions.has(product.id)) {
      setOptionWindow({ product, editing: null });
    } else {
      addDirectToCart(product);
    }
  }

  /** "ยังมีของ ขายต่อ" (tile or chip): stop asking on this iPad, and flag it once without waiting. */
  function confirmOut(materialIds: string[], productId: string) {
    if (materialIds.length === 0) return;
    stockStates.suppress(materialIds);
    // Fire and forget (R-D2a-22): a plain fetch to /api/stock/flag with a 5 s timeout, never a server
    // action, so it can never sit in the action queue ahead of the next sale's createOrder (final review
    // I3). Not sent offline: it could only time out.
    if (online) {
      void postFlag(materialIds, productId).then((r) => {
        if (!("ok" in r)) console.error("[pos] stock flag failed:", "error" in r ? r.error : "no answer");
      });
    }
  }

  /**
   * "ไม่มีแล้ว ปิดขาย" / "เปิดขายแล้วสั่ง" through /api/stock/pause (a fetch, never a server action, final
   * review I3), given up and aborted after PAUSE_DEADLINE_MS: no answer is never a dead end, and since the
   * server may still do it, fresh levels are asked for at once (the heartbeat shows the truth). On
   * success: shown at once, a toast, fresh levels now.
   */
  async function changePause(product: PosProduct, paused: boolean): Promise<PauseResult> {
    // Offline is refused before calling: it could only time out.
    if (!online) return { offline: true };
    const res = await postPause(product.id, paused);
    if ("noAnswer" in res) {
      heartbeat.checkNow();
      return res;
    }
    if ("error" in res) return res;
    stockStates.markPaused(product.id, paused);
    toast.add({ title: `${paused ? "ปิดขาย" : "เปิดขาย"}: ${product.name}`, type: "success" });
    heartbeat.checkNow();
    return res;
  }

  function renderStockAsk() {
    if (stockAsk === null) return null;
    const { product, state } = stockAsk;
    // After "เปิดขายแล้วสั่ง" / "ขายแก้วนี้" the cashier has said the cup can be made: whatever makes it
    // "หมด?" counts as "ยังมีของ ขายต่อ" (R-D2a-23), so it goes straight on, asked once, not twice.
    const goOnUnpaused = () => {
      confirmOut(stockStates.outMaterialsOf(product.id), product.id);
      openProduct(product);
    };
    if (state.kind === "out") {
      // Every material that makes this menu "หมด?" now (a packaging set at 0 is often cup, lid and straw):
      // one "ยังมีของ ขายต่อ" covers them all with one flag call, so the next tap does not ask again for
      // the next one (final review I1, as R-D2a-23 does for a reopen). The dialog names them all.
      const outIds = [...new Set([state.materialId, ...stockStates.outMaterialsOf(product.id)])];
      return (
        <StockStateDialog
          key={`out-${product.id}`}
          kind="out"
          menuName={product.name}
          materialName={outIds.map((id) => materialLabel(id, materialNames, stockCatalog)).join(", ")}
          onSell={() => {
            confirmOut(outIds, product.id);
            setStockAsk(null);
            openProduct(product);
          }}
          pause={{
            run: async () => {
              const res = await changePause(product, true);
              if ("ok" in res) setStockAsk(null);
              if ("offline" in res) {
                // not sent (offline): say so and let the cashier go on (the menu stays on sale)
                setStockAsk(null);
                toast.add({ title: `ปิดขาย ${product.name} ไม่สำเร็จ · เน็ตไม่ตอบ ลองใหม่อีกครั้ง`, type: "error" });
              }
              if ("noAnswer" in res) {
                // sent, no answer in time: it may still happen, so never "ไม่สำเร็จ"; the heartbeat shows the truth
                setStockAsk(null);
                toast.add({ title: pauseNoAnswerText(true, product.name), type: "error" });
              }
              return res;
            },
            disabledReason: online ? null : "ใช้ไม่ได้ตอนเน็ตหลุด",
          }}
          onCancel={() => setStockAsk(null)}
        />
      );
    }
    if (state.kind !== "paused") return null;
    return (
      <StockStateDialog
        key={`paused-${product.id}`}
        kind="paused"
        menuName={product.name}
        online={online}
        onReopen={async () => {
          const res = await changePause(product, false);
          if ("ok" in res) {
            setStockAsk(null);
            goOnUnpaused();
          }
          return res;
        }}
        onSellOnce={() => {
          setStockAsk(null);
          goOnUnpaused();
        }}
        onCancel={() => setStockAsk(null)}
      />
    );
  }

  // A plain tap adds to the identical plain line if there is one (same rule as the option window).
  function addDirectToCart(product: PosProduct) {
    setCartItems((prev) =>
      addLine(prev, {
        cartItemKey: prev.some((i) => i.cartItemKey === product.id)
          ? `${product.id}-${Date.now()}`
          : product.id,
        productId: product.id,
        name: product.name,
        basePrice: product.price,
        quantity: 1,
        selectedModifiers: [],
        note: null,
        totalPrice: product.price,
      })
    );
  }

  // Repeat plain taps merge by what the cup is (addLine), never into a noted line. A direct-tap
  // line that gets a note also gets its own key, so product.id stays free for the next plain line.
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

  // Adding merges only into an identical cup (product, options, note, bean/sweetness); saving an
  // edited line replaces it, keeping its quantity.
  function handleSaveFromWindow(item: CartItem) {
    const editing = optionWindow?.editing ?? null;
    const key = `${item.productId}-${eventTime()}`;
    setCartItems((prev) =>
      editing ? replaceLine(prev, editing.cartItemKey, item) : addLine(prev, { ...item, cartItemKey: key })
    );
    setOptionWindow(null);
  }

  /** Menus with options reopen the option window from the cart; others edit the note there. */
  function canEditOptions(item: CartItem): boolean {
    return productById.has(item.productId) && productsWithOptions.has(item.productId);
  }

  function editLineOptions(key: string) {
    const item = cartItems.find((i) => i.cartItemKey === key);
    const product = item ? productById.get(item.productId) : undefined;
    if (!item || !product) return;
    setShowMobileCart(false); // the phone's cart sheet would sit above the window
    setOptionWindow({ product, editing: item });
  }

  function lineDetail(item: CartItem) {
    return cartLineParts(
      item,
      stock.loaded ? defaultChoices(item.productId, stockCatalog) : null,
      stockCatalog.packaging.get(item.productId)?.houseGlassDefault ?? false
    );
  }

  /** The cart line's แก้วร้าน toggle: same cup, same price; the key is dropped when it equals the menu default. */
  function toggleLineHouseGlass(key: string) {
    setCartItems((prev) => prev.map((i) => (i.cartItemKey === key ? toggleHouseGlass(i, stockCatalog) : i)));
  }

  // The last item taken out by hand ends this cart as a sale, just like ล้าง: its payment attempt
  // is forgotten, so an identical cart built next (another customer) never reuses its client_ref.
  function forgetAttemptIfEmptied(key: string) {
    if (activeHeld !== null || cartItems.some((i) => i.cartItemKey !== key)) return;
    attemptRef.current = null;
    restoredRef.current = null;
    setDraftAttemptRef(null);
  }

  /** Takes a line out and offers 5 s to put it back (same place, same choices and note). */
  function removeLineWithUndo(key: string) {
    const index = cartItems.findIndex((i) => i.cartItemKey === key);
    if (index === -1) return;
    const item = cartItems[index]!;
    const epoch = cartEpochRef.current;
    // While a payment's answer is still unknown, no one-tap undo: emptying the cart forgets the
    // attempt, so putting the same cart straight back would pay it again under a new client_ref.
    const offerUndo = !paymentUnresolved;
    forgetAttemptIfEmptied(key);
    setCartItems((prev) => prev.filter((i) => i.cartItemKey !== key));
    let done = false;
    const toastId = toast.add({
      title: `ลบ ${item.name} ออกจากตะกร้าแล้ว`,
      type: "success",
      timeout: 5000,
      actionProps: offerUndo ? {
        children: "ย้อนกลับ",
        onClick: () => {
          if (done) return;
          done = true;
          toast.close(toastId);
          if (cartEpochRef.current !== epoch) return;
          setCartItems((prev) => restoreLine(prev, item, index));
        },
      } : undefined,
    });
  }

  function updateQty(key: string, qty: number) {
    if (qty <= 0) {
      removeLineWithUndo(key);
    } else {
      setCartItems((prev) =>
        prev.map((i) => (i.cartItemKey === key ? withQuantity(i, qty) : i))
      );
    }
  }

  function removeItem(key: string) {
    removeLineWithUndo(key);
  }

  function restoreDraft(d: CartDraft) {
    const items = repriceFromMenu(d.items);
    cartEpochRef.current++;
    setCartItems(items);
    setOrderType(d.orderType);
    setPaymentMethod(d.paymentMethod);
    setCustomer(d.customer);
    resetDiscount();
    if (d.discount) {
      setDiscountType(d.discount.type);
      setDiscountValue(d.discount.value);
      setDiscountReason(d.discount.reason);
    }
    setActiveHeld(d.activeHeld);
    setManualBags(bagsEnabled ? manualFromDraft(d.bags) : null);
    // The draft's own attempt ref (if a payment was tried) stays with the cart, and the restored
    // cart may take it over: keyed by exactly the fingerprint it will have once these states land.
    setDraftAttemptRef(d.attemptRef ?? null);
    restoredRef.current =
      d.attemptRef === undefined
        ? null
        : {
            clientRef: d.attemptRef,
            fingerprint: attemptFingerprint({
              items,
              paymentMethod: d.paymentMethod,
              orderType: d.orderType,
              customerId: d.customer?.id ?? null,
              discountType: d.discount?.type ?? null,
              discountValue: d.discount?.value ?? "",
              heldBillId: d.activeHeld?.id ?? null,
              heldBillVersion: d.activeHeld?.version ?? null,
            }),
          };
    // The held bill's loaded items are not known any more: treat it as edited (never loses edits).
    setLoadedSnapshot(null);
    setNotice("กู้ตะกร้าที่ค้างไว้");
  }

  function clearCart() {
    cartEpochRef.current++;
    discardDraft();
    attemptRef.current = null;
    restoredRef.current = null;
    setDraftAttemptRef(null);
    setUncertain(false);
    setLocalUnresolved(null);
    setResultShownAt(null);
    setCartItems([]);
    setManualBags(null);
    setError(null);
    setSaveError(null);
    setLastOrderNumber(null);
    setLastReceiptRef(null);
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
    // Every caller has checked that attemptRef is the sale being finished.
    const settledClientRef = attemptRef.current?.clientRef ?? null;
    settledRef.current = settledClientRef;
    attemptRef.current = null;
    restoredRef.current = null;
    setDraftAttemptRef(null);
    setUncertain(false);
    setLocalUnresolved(null);
    setError(null);
    setSaveError(null);
    setLastOffline(null);
    setResultShownAt(eventTime());
    cartEpochRef.current++;
    setLastOrderNumber(sale.orderNumber);
    // The same sale can be applied twice (the late-answer handler, then the main path); the second
    // call finds attemptRef already cleared, and must keep the ref the first one set.
    setLastReceiptRef((prev) => settledClientRef ?? prev);
    setLastQueueNumber(sale.queueNumber);
    snapshot.observe(sale.queueNumber);
    setLastCashTender(
      sale.cashReceived !== null && sale.changeAmount !== null
        ? { received: sale.cashReceived, change: sale.changeAmount }
        : null
    );
    setCartItems([]);
    setManualBags(null);
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
    // A restored cart that is this attempt's sale takes it over first, so "saved" finishes it.
    adoptRestoredAttempt(fingerprintRef.current, saleKeyRef.current, entriesRef.current);
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
    // The sale whose result is still on screen: its card stops saying it is waiting to be sent.
    if (e.clientRef === lastOfflineRefKey.current) {
      setLastOffline((r) => (r ? { ...r, orderNumber: saved.orderNumber } : r));
    }
    const device = e.offline?.queueNumber;
    if (device !== undefined && saved.queueNumber !== device) {
      setQueueChanges((list) => [...list, { device, server: saved.queueNumber }]);
    }
    // A held bill paid offline is now closed on the server: drop it from the held list.
    if (e.input.heldBillId !== undefined) router.refresh();
  }

  /** The sender answered a check-only entry: saved, or not saved (null). */
  function handleChecked(clientRef: string, saved: Omit<SavedOrder, "orderId"> | null) {
    // Before anything changes: the entry just answered is still in entriesRef (the outbox's own
    // refresh lands later), so a restored cart of the same sale can still take it over.
    adoptRestoredAttempt(fingerprintRef.current, saleKeyRef.current, entriesRef.current);
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
  // The cart as the outbox stores a sale (saleInput's shape), for matching a restored cart to an
  // attempt that may have been saved; mirrored with the entries for answers that arrive later.
  const currentSaleKey = saleKey(saleInput("", undefined));
  const saleKeyRef = useRef(currentSaleKey);
  const entriesRef = useRef(outbox.entries);
  useEffect(() => {
    saleKeyRef.current = currentSaleKey;
    entriesRef.current = outbox.entries;
  }, [currentSaleKey, outbox.entries]);

  /**
   * A payment that got no answer (maybe saved), then a reload: the cart draft brings the cart back
   * with its attempt's client_ref, but the in-memory attempt is gone, so a new client_ref would
   * record the sale a second time. While the cart is still exactly the restored one and that very
   * ref is still an unanswered attempt/check-only entry for the same sale, it is taken over (the
   * server then only ever replays that bill). An identical cart built for the next customer has no
   * ref in its draft and so never inherits the earlier bill.
   */
  function adoptRestoredAttempt(fingerprint: string, key: string, entries: OutboxEntry[]) {
    const restored = restoredRef.current;
    if (restored === null || restored.fingerprint !== fingerprint || attemptRef.current !== null) {
      return;
    }
    const clientRef = adoptableRef(restored.clientRef, entries, tenantId, sellerId, key);
    if (clientRef === null) return;
    attemptRef.current = { fingerprint, clientRef };
    restoredRef.current = null;
  }
  // As soon as both the restored cart and the outbox entries are there.
  useEffect(() => {
    adoptRestoredAttempt(currentFingerprint, currentSaleKey, outbox.entries);
    // adoptRestoredAttempt is recreated each render and only touches refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFingerprint, currentSaleKey, outbox.entries]);

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
      // only for a shop that counts bags; otherwise the field is left out
      ...(bagsEnabled ? { bags: shownBagCount } : {}),
      clientRef,
    };
  }

  /** One client_ref per payment attempt: a retry of the same cart reuses it (payment-attempt.ts). */
  function clientRefForCart(): string {
    const fingerprint = currentFingerprint;
    adoptRestoredAttempt(fingerprint, currentSaleKey, outbox.entries);
    if (attemptRef.current?.fingerprint !== fingerprint) {
      attemptRef.current = { fingerprint, clientRef: crypto.randomUUID() };
    }
    // Into the cart draft, so a reload keeps this attempt's identity.
    setDraftAttemptRef(attemptRef.current.clientRef);
    return attemptRef.current.clientRef;
  }

  // A sale stored on the device: show its queue number and empty the cart (spec goal 2). Called
  // only once the outbox write has resolved.
  function showOfflineResult(result: OfflineResult, clientRef: string) {
    discardDraft();
    settledRef.current = clientRef;
    attemptRef.current = null;
    restoredRef.current = null;
    setDraftAttemptRef(null);
    lastTryRef.current = null;
    setUncertain(false);
    setLocalUnresolved((ref) => (ref === clientRef ? null : ref));
    setError(null);
    setSaveError(null);
    setLastOrderNumber(null);
    setLastReceiptRef(clientRef);
    setLastQueueNumber(null);
    setLastCashTender(null);
    setLastHeld(null);
    lastOfflineRefKey.current = clientRef;
    setLastOffline(result);
    setResultShownAt(eventTime());
    cartEpochRef.current++;
    setCartItems([]);
    setManualBags(null);
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

  /** What the cart shows for a final bill already on the device. */
  function storedResult(e: OutboxEntry): OfflineResult {
    return {
      queueNumber: deviceQueueOf(e) ?? 0,
      cashReceived: e.display.cashReceived,
      changeAmount: e.display.changeAmount,
    };
  }

  /**
   * Runs `work` (read the store, take a queue number, write the bill) for the sale `clientRef`
   * and shows its result. A stuck device store gives up after DEVICE_STORE_DEADLINE_MS: the cart
   * stays with บันทึกในเครื่องไม่ได้ and the cashier can retry, pay online or cancel. A write that
   * still lands later carries the same client_ref, so a retry finds it (readEntry) and the server
   * can only replay it. If it lands while this sale is still on screen its result shows then; if
   * the cart has moved on, a note says that bill was stored after all.
   */
  async function storeOnDevice(clientRef: string, work: () => Promise<OfflineResult>) {
    const run = work();
    try {
      showOfflineResult(await withDeadline(run, DEVICE_STORE_DEADLINE_MS), clientRef);
    } catch (err) {
      // Nothing was stored (or not in time): the cart stays and the window says so.
      setSaveError(SAVE_ON_DEVICE_FAILED);
      if (!(err instanceof DeadlineError)) return;
      // The write may still land: no new sale starts until it settles (a reload aborts it).
      setUnsettledSaves((n) => n + 1);
      run.then(
        (late) => {
          setUnsettledSaves((n) => Math.max(0, n - 1));
          if (settledRef.current === clientRef) return; // already shown (e.g. by a retry)
          if (
            attemptRef.current?.clientRef === clientRef &&
            attemptRef.current.fingerprint === fingerprintRef.current
          ) {
            showOfflineResult(late, clientRef);
          } else {
            setError(`บิลก่อนหน้าบันทึกในเครื่องแล้ว (คิว ${late.queueNumber}) · ตรวจตะกร้าก่อนชำระ`);
          }
        },
        () => setUnsettledSaves((n) => Math.max(0, n - 1))
      );
    }
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
    // A held bill keeps its own queue number (the server keeps it too): no device number is taken.
    const heldQueue = activeHeld?.queueNumber ?? null;
    const shiftId = snapshot.shiftId;
    const saleTotal = total;
    setError(null);
    setSaveError(null);
    setCheckoutPending(true);
    try {
      await storeOnDevice(clientRef, async () => {
        // Already stored as a final bill (a tap that raced the result, or a write that landed
        // after an earlier deadline): show it, take no new number.
        const existing = await readEntry(clientRef, tenantId);
        if (existing && isFinal(existing)) return storedResult(existing);
        // Rejects when the device can't store the number (note I): the sale is blocked.
        const queueNumber = heldQueue ?? (await snapshot.takeNext());
        const offline: OfflineSale = {
          tenantId,
          sellerId,
          soldAt: new Date().toISOString(),
          queueNumber,
          shiftId,
        };
        const entry = makeEntry({
          clientRef,
          tenantId,
          sellerId,
          state: "pending",
          input,
          display: saleDisplay(input, saleTotal, queueNumber),
          offline,
        });
        // Replaces this attempt's own attempt/check-only backup, if any (same client_ref).
        await outbox.put(entry);
        return {
          queueNumber,
          cashReceived: entry.display.cashReceived,
          changeAmount: entry.display.changeAmount,
        };
      });
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
    // A held bill keeps its own queue number, as in sellOnDevice.
    const heldQueue =
      last.input.heldBillId !== undefined && activeHeld?.id === last.input.heldBillId
        ? activeHeld.queueNumber
        : null;
    const shiftId = snapshot.shiftId;
    setSaveError(null);
    setCheckoutPending(true);
    try {
      await storeOnDevice(last.clientRef, async () => {
        const existing = await readEntry(last.clientRef, tenantId);
        if (existing && isFinal(existing)) return storedResult(existing);
        const queueNumber = heldQueue ?? (await snapshot.takeNext());
        const offline: OfflineSale = {
          tenantId,
          sellerId,
          soldAt: new Date().toISOString(),
          queueNumber,
          shiftId,
        };
        try {
          await outbox.finalize(last.clientRef, offline);
        } catch (err) {
          if (!(err instanceof Error && err.message === ENTRY_MISSING)) throw err;
          // The attempt is gone (e.g. another tab found it "not saved"): store the bill afresh
          // with the same client_ref (note B). The server replays it if it was in fact saved.
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
        return {
          queueNumber,
          cashReceived: last.display.cashReceived,
          changeAmount: last.display.changeAmount,
        };
      });
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
    setLastReceiptRef(null);
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
            heartbeat.checkNow();
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
        // The sale just changed the levels: read them now instead of at the next 30 s heartbeat.
        heartbeat.checkNow();
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
    // A device save that missed its deadline may still land: wait for it (ชำระ says so).
    if (unsettledSaves > 0) return;
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
    cartEpochRef.current++;
    discardDraft();
    restoredRef.current = null;
    attemptRef.current = null;
    setDraftAttemptRef(null);
    setCartItems([]);
    setManualBags(null);
    setCustomer(null);
    resetDiscount();
    setActiveHeld(null);
    setLoadedSnapshot(null);
    setError(null);
    setLastOrderNumber(null);
    setLastReceiptRef(null);
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
  // old price lives in the held bill itself. So lines are re-priced from the current menu on load,
  // bean/sweetness choices included (cart-lines.ts repriceItems); anything no longer on sale is left
  // untouched for the server to reject with a clear message.
  function repriceFromMenu(items: CartItem[]): CartItem[] {
    return repriceItems(items, products, allModifiers, refreshCatalog);
  }

  function resumeHeld(bill: HeldBillSummary) {
    restoredRef.current = null;
    setDraftAttemptRef(null);
    const items = repriceFromMenu(bill.items);
    cartEpochRef.current++;
    setCartItems(items);
    setManualBags(null);
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
    setLastReceiptRef(null);
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

  const optionWindowModifiers: ModifierWithOptions[] = optionWindow
    ? (productModifierMap.get(optionWindow.product.id) ?? [])
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
    optionWindow !== null ||
    stockAsk !== null;
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
  // The receipt QR shows exactly while the after-sale result shows (never after holding a bill).
  const receiptUrlForCart =
    lastReceiptRef !== null &&
    (lastOrderNumber !== null || lastOffline !== null) &&
    typeof window !== "undefined"
      ? receiptUrl(window.location.origin, lastReceiptRef)
      : null;

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] md:h-[calc(100dvh-3rem)]">
      <StatusBanners
        offline={!online}
        confirmed={heartbeat.lastSuccessAt !== null}
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
        onOpenStock={() => {
          setShowMobileCart(false);
          setShowStockPanel(true);
        }}
        shiftDisabledReason={reasonOf(shiftGate)}
      />
      {!stock.loaded && (
        <p
          role="status"
          className="mt-2 shrink-0 rounded-lg border-2 border-warning bg-warning/10 px-4 py-2 text-base font-semibold text-sidebar"
        >
          <span aria-hidden="true" className="text-warning">⚠ </span>
          โหลดตัวเลือกเมล็ด/ความหวานไม่สำเร็จ · รีเฟรชหน้า
        </p>
      )}
      <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0 mt-2">
        <div className="flex-1 min-w-0 pb-20 md:pb-0">
          <ProductGrid
            products={products}
            categories={categories}
            productsWithModifiers={productsWithOptions}
            tileStates={stockStates.tileStates}
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
            notice={notice}
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
            receiptUrl={receiptUrlForCart}
            gates={cartGates}
            paymentReady={outbox.loaded && unsettledSaves === 0}
            payBlockedReason={unsettledSaves > 0 ? UNSETTLED_SAVE_MESSAGE : null}
            lineDetail={lineDetail}
            houseGlassToggle={(item) => houseGlassToggle(item, stockCatalog)}
            onToggleHouseGlass={toggleLineHouseGlass}
            bags={bagsEnabled ? { count: shownBagCount, onChange: setManualBags } : null}
            canEditOptions={canEditOptions}
            onEditOptions={editLineOptions}
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
                notice={notice}
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
                receiptUrl={receiptUrlForCart}
                gates={cartGates}
                paymentReady={outbox.loaded && unsettledSaves === 0}
                payBlockedReason={unsettledSaves > 0 ? UNSETTLED_SAVE_MESSAGE : null}
                lineDetail={lineDetail}
                houseGlassToggle={(item) => houseGlassToggle(item, stockCatalog)}
                onToggleHouseGlass={toggleLineHouseGlass}
                bags={bagsEnabled ? { count: shownBagCount, onChange: setManualBags } : null}
                canEditOptions={canEditOptions}
                onEditOptions={editLineOptions}
              />
            </div>
          </div>
        </div>
      )}
      {optionWindow !== null && (
        <OptionWindow
          key={optionWindow.editing?.cartItemKey ?? optionWindow.product.id}
          product={optionWindow.product}
          modifiers={optionWindowModifiers}
          catalog={stockCatalog}
          editing={optionWindow.editing}
          stock={stockStates.view}
          materialName={(id) => materialLabel(id, materialNames, stockCatalog)}
          onConfirmOut={(materialId) => confirmOut([materialId], optionWindow.product.id)}
          onSave={handleSaveFromWindow}
          onClose={() => setOptionWindow(null)}
        />
      )}
      {renderStockAsk()}
      {showStockPanel && (
        <StockPanel
          online={online}
          products={products}
          categories={categories}
          catalog={stockCatalog}
          materials={wasteMaterials}
          receive={{ canSeePrice: canSeeReceivePrice }}
          modifiersFor={(productId) =>
            (productModifierMap.get(productId) ?? [])
              .map((modId) => allModifiers.find((m) => m.id === modId))
              .filter((m): m is ModifierWithOptions => m !== undefined)
          }
          productsWithOptions={productsWithOptions}
          pausedIds={
            new Set(products.filter((p) => stockStates.tileStates.get(p.id)?.kind === "paused").map((p) => p.id))
          }
          onChangePause={changePause}
          onChanged={heartbeat.checkNow}
          onClose={() => setShowStockPanel(false)}
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
