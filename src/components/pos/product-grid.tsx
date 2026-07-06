"use client";
import { useState } from "react";
import type { PosProduct, PosCategory } from "@/types/app";

const DRINK_TYPE_LABELS: Record<string, string> = {
  hot: "ร้อน",
  iced: "เย็น",
  blended: "ปั่น",
  special: "พิเศษ",
};

const ALL_DRINK_TYPES = ["hot", "iced", "blended", "special"] as const;

type Props = {
  products: PosProduct[];
  categories: PosCategory[];
  productsWithModifiers: Set<string>;
  onProductClick: (product: PosProduct) => void;
};

export function ProductGrid({
  products,
  categories,
  productsWithModifiers,
  onProductClick,
}: Props) {
  const [activeCategoryId, setActiveCategoryId] = useState<string>("all");
  const [activeDrinkType, setActiveDrinkType] = useState<string>("all");

  const inCategory =
    activeCategoryId === "all"
      ? products
      : products.filter((p) => p.category_id === activeCategoryId);

  const drinkTypesInCategory = new Set(
    inCategory
      .map((p) => p.drink_type)
      .filter(
        (dt): dt is "hot" | "iced" | "blended" | "special" => dt !== null
      )
  );
  const showDrinkTabs = drinkTypesInCategory.size > 0;

  const filtered =
    activeDrinkType === "all"
      ? inCategory
      : inCategory.filter((p) => p.drink_type === activeDrinkType);

  function handleCategoryChange(catId: string) {
    setActiveCategoryId(catId);
    setActiveDrinkType("all");
  }

  function tabCls(active: boolean) {
    return (
      "px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors " +
      (active
        ? "bg-accent text-white"
        : "bg-white border border-border text-muted-foreground hover:border-accent hover:text-accent")
    );
  }

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 shrink-0 [scrollbar-width:none]">
        <button
          type="button"
          className={tabCls(activeCategoryId === "all")}
          onClick={() => handleCategoryChange("all")}
        >
          ทั้งหมด
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={tabCls(activeCategoryId === cat.id)}
            onClick={() => handleCategoryChange(cat.id)}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Drink type sub-tabs */}
      {showDrinkTabs && (
        <div className="flex gap-2 overflow-x-auto pb-1 shrink-0 [scrollbar-width:none]">
          <button
            type="button"
            className={tabCls(activeDrinkType === "all")}
            onClick={() => setActiveDrinkType("all")}
          >
            ทั้งหมด
          </button>
          {ALL_DRINK_TYPES.filter((dt) => drinkTypesInCategory.has(dt)).map(
            (dt) => (
              <button
                key={dt}
                type="button"
                className={tabCls(activeDrinkType === dt)}
                onClick={() => setActiveDrinkType(dt)}
              >
                {DRINK_TYPE_LABELS[dt]}
              </button>
            )
          )}
        </div>
      )}

      {/* Product grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => onProductClick(product)}
              className="text-left rounded-xl border bg-white hover:border-accent hover:shadow-sm transition-all active:scale-95 overflow-hidden"
            >
              {/* Image / fallback */}
              <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
                {product.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-3xl font-bold text-muted-foreground/30 select-none">
                    {product.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="p-2.5">
                <p className="font-medium text-sidebar text-sm leading-tight line-clamp-2">
                  {product.name}
                </p>
                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-accent font-semibold text-sm">
                    ฿{product.price.toFixed(0)}
                  </p>
                  <span className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center text-sm font-bold shrink-0">
                    +
                  </span>
                </div>
                {productsWithModifiers.has(product.id) && (
                  <p className="text-xs text-muted-foreground mt-0.5">ปรับได้</p>
                )}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="col-span-full text-center py-16 text-muted-foreground text-sm">
              ไม่มีสินค้า
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
