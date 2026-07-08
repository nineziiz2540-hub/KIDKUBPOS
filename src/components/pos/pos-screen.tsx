"use client";
import { useState, useTransition, useMemo } from "react";
import { createOrder } from "@/app/actions/orders";
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

type Props = {
  products: PosProduct[];
  categories: PosCategory[];
  productModifierRecord: Record<string, string[]>;
  allModifiers: ModifierWithOptions[];
  userName: string;
  todayOrderCount: number;
  activeShiftId: string | null;
};

export function PosScreen({
  products,
  categories,
  productModifierRecord,
  allModifiers,
  userName,
  todayOrderCount,
  activeShiftId,
}: Props) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [pendingProduct, setPendingProduct] = useState<PosProduct | null>(null);
  const [orderType, setOrderType] = useState<"dine_in" | "take_away">("dine_in");
  const [tableNumber, setTableNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer" | "card">("cash");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastOrderNumber, setLastOrderNumber] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showMobileCart, setShowMobileCart] = useState(false);
  const [checkoutPending, startCheckout] = useTransition();

  const productsWithModifiers = useMemo(
    () => new Set(Object.keys(productModifierRecord)),
    [productModifierRecord]
  );

  const productModifierMap = useMemo(
    () => new Map(Object.entries(productModifierRecord)),
    [productModifierRecord]
  );

  const total = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

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
          totalPrice: product.price,
        },
      ];
    });
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
    setCustomerId(null);
    setTableNumber("");
  }

  function submitOrder(onSettled?: () => void) {
    setError(null);
    setLastOrderNumber(null);
    startCheckout(async () => {
      const result = await createOrder({
        items: cartItems,
        paymentMethod,
        orderType,
        tableNumber: tableNumber.trim() !== "" ? tableNumber.trim() : undefined,
        customerId: customerId ?? undefined,
      });
      if ("error" in result) {
        setError(result.error);
      } else {
        setLastOrderNumber(result.orderNumber);
        setCartItems([]);
        setTableNumber("");
        setCustomerId(null);
      }
      onSettled?.();
    });
  }

  function handleCheckout() {
    if (paymentMethod === "transfer") {
      setError(null);
      setShowMobileCart(false);
      setShowQrModal(true);
      return;
    }
    submitOrder();
  }

  function handleQrConfirm() {
    submitOrder(() => setShowQrModal(false));
  }

  const pendingProductModifiers: ModifierWithOptions[] = pendingProduct
    ? (productModifierMap.get(pendingProduct.id) ?? [])
        .map((modId) => allModifiers.find((m) => m.id === modId))
        .filter((m): m is ModifierWithOptions => m !== undefined)
    : [];

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <PosHeader
        userName={userName}
        todayOrderCount={todayOrderCount}
        hasActiveShift={activeShiftId !== null}
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
        <div className="hidden md:block md:w-72 md:shrink-0">
          <SmartCart
            cartItems={cartItems}
            onUpdateQty={updateQty}
            onRemove={removeItem}
            onClear={clearCart}
            orderType={orderType}
            onOrderTypeChange={setOrderType}
            tableNumber={tableNumber}
            onTableNumberChange={setTableNumber}
            paymentMethod={paymentMethod}
            onPaymentChange={setPaymentMethod}
            customerId={customerId}
            onCustomerIdChange={setCustomerId}
            pending={checkoutPending}
            error={error}
            lastOrderNumber={lastOrderNumber}
            onCheckout={handleCheckout}
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
          <span className="font-bold tabular-nums">฿{total.toFixed(0)}</span>
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
                onClear={clearCart}
                orderType={orderType}
                onOrderTypeChange={setOrderType}
                tableNumber={tableNumber}
                onTableNumberChange={setTableNumber}
                paymentMethod={paymentMethod}
                onPaymentChange={setPaymentMethod}
                customerId={customerId}
                onCustomerIdChange={setCustomerId}
                pending={checkoutPending}
                error={error}
                lastOrderNumber={lastOrderNumber}
                onCheckout={handleCheckout}
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
    </div>
  );
}
