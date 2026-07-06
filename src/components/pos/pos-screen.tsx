"use client";
import { useState, useTransition } from "react";
import { createOrder } from "@/app/actions/orders";
import type { CartItem } from "@/types/app";
import { ProductGrid } from "@/components/pos/product-grid";
import { CartPanel } from "@/components/pos/cart-panel";

type Product = {
  id: string;
  name: string;
  price: number;
  categories: { name: string } | null;
};

type PaymentMethod = "cash" | "transfer" | "card";

type Props = {
  products: Product[];
};

export function PosScreen({ products }: Props) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [error, setError] = useState<string | null>(null);
  const [lastOrderNumber, setLastOrderNumber] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addToCart(product: Product) {
    setCartItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        const newQty = existing.quantity + 1;
        return prev.map((i) =>
          i.productId === product.id
            ? {
                ...i,
                quantity: newQty,
                totalPrice:
                  (existing.basePrice +
                    existing.selectedModifiers.reduce(
                      (s, m) => s + m.priceDelta,
                      0
                    )) *
                  newQty,
              }
            : i
        );
      }
      return [
        ...prev,
        {
          cartItemKey: product.id,
          productId: product.id,
          name: product.name,
          basePrice: Number(product.price),
          quantity: 1,
          selectedModifiers: [],
          totalPrice: Number(product.price),
        },
      ];
    });
  }

  function updateQty(productId: string, qty: number) {
    if (qty <= 0) {
      setCartItems((prev) => prev.filter((i) => i.productId !== productId));
    } else {
      setCartItems((prev) =>
        prev.map((i) => {
          if (i.productId !== productId) return i;
          const unitPrice =
            i.basePrice +
            i.selectedModifiers.reduce((s, m) => s + m.priceDelta, 0);
          return { ...i, quantity: qty, totalPrice: unitPrice * qty };
        })
      );
    }
  }

  function removeItem(productId: string) {
    setCartItems((prev) => prev.filter((i) => i.productId !== productId));
  }

  function clearCart() {
    setCartItems([]);
    setError(null);
    setLastOrderNumber(null);
  }

  function handleCheckout() {
    setError(null);
    setLastOrderNumber(null);
    startTransition(async () => {
      const result = await createOrder({
        items: cartItems,
        paymentMethod,
        orderType: "dine_in",
      });
      if ("error" in result) {
        setError(result.error);
      } else {
        setLastOrderNumber(result.orderNumber);
        setCartItems([]);
      }
    });
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
      <div className="flex-1 overflow-y-auto">
        <ProductGrid products={products} onAddToCart={addToCart} />
      </div>
      <div className="w-72 shrink-0">
        <CartPanel
          cartItems={cartItems}
          onUpdateQty={updateQty}
          onRemove={removeItem}
          onClear={clearCart}
          paymentMethod={paymentMethod}
          onPaymentChange={setPaymentMethod}
          onCheckout={handleCheckout}
          pending={pending}
          error={error}
          lastOrderNumber={lastOrderNumber}
        />
      </div>
    </div>
  );
}
