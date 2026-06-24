"use client";
import { useState, useTransition } from "react";
import { createOrder, type CartItem } from "@/app/actions/orders";
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
  const [pending, startTransition] = useTransition();

  function addToCart(product: Product) {
    setCartItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        return prev.map((i) =>
          i.productId === product.id
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          price: Number(product.price),
          quantity: 1,
        },
      ];
    });
  }

  function updateQty(productId: string, qty: number) {
    if (qty <= 0) {
      setCartItems((prev) => prev.filter((i) => i.productId !== productId));
    } else {
      setCartItems((prev) =>
        prev.map((i) =>
          i.productId === productId ? { ...i, quantity: qty } : i
        )
      );
    }
  }

  function removeItem(productId: string) {
    setCartItems((prev) => prev.filter((i) => i.productId !== productId));
  }

  function clearCart() {
    setCartItems([]);
    setError(null);
  }

  function handleCheckout() {
    setError(null);
    startTransition(async () => {
      const result = await createOrder({ items: cartItems, paymentMethod });
      if (result?.error !== undefined) {
        setError(result.error);
      } else {
        setCartItems([]);
      }
    });
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
      {/* Left: product grid — scrolls independently */}
      <div className="flex-1 overflow-y-auto">
        <ProductGrid products={products} onAddToCart={addToCart} />
      </div>
      {/* Right: cart panel — fixed width, fills height */}
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
        />
      </div>
    </div>
  );
}
