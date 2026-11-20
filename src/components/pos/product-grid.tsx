"use client";
import { formatPrice } from "@/lib/cash";
import { useState } from "react";
import { lowWord, OUT_WORD, PAUSED_WORD, type TileState } from "@/lib/stock/pos-states";
import type { PosProduct, PosCategory } from "@/types/app";

const OK: TileState = { kind: "ok" };

/**
 * A tile's look per stock state (round D2a, spec §8.1): every state carries a word, never colour
 * alone, and every tile stays tappable. ok = as before.
 */
function tileLook(state: TileState): { frame: string; dim: boolean; badge: { text: string; cls: string } | null } {
  switch (state.kind) {
    case "paused":
      return {
        frame: "border-2 border-input bg-muted",
        dim: true,
        badge: { text: PAUSED_WORD, cls: "bg-sidebar text-white" },
      };
    case "out":
      return {
        frame: "border-2 border-dashed border-muted-foreground/60 bg-white",
        dim: true,
        badge: { text: OUT_WORD, cls: "border-2 border-dashed border-muted-foreground bg-white text-sidebar" },
      };
    case "low":
      return {
        frame: "border bg-white hover:border-accent hover:shadow-sm",
        dim: false,
        badge: { text: lowWord(state.cupsLeft), cls: "bg-warning text-sidebar" },
      };
    case "ok":
      return { frame: "border bg-white hover:border-accent hover:shadow-sm", dim: false, badge: null };
  }
}

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
  /** "ปิดขาย / หมด? / เหลือ ~N แก้ว" per menu (round D2a); a menu missing here looks as before. */
  tileStates?: Map<string, TileState>;
  onProductClick: (product: PosProduct) => void;
};

export function ProductGrid({
  products,
  categories,
  productsWithModifiers,
  tileStates,
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
      "h-12 px-5 rounded-full text-base font-semibold whitespace-nowrap transition-colors " +
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
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
          {filtered.map((product) => {
            const look = tileLook(tileStates?.get(product.id) ?? OK);
            return (
              <button
                key={product.id}
                type="button"
                onClick={() => onProductClick(product)}
                className={`relative text-left rounded-xl transition-all active:scale-95 overflow-hidden ${look.frame}`}
              >
                {/* The state word sits over the picture, on a solid chip, readable from arm's length. */}
                {look.badge && (
                  <span
                    className={`absolute top-2 left-2 z-10 max-w-[calc(100%-1rem)] truncate rounded-md px-2 py-0.5 text-base font-bold leading-snug ${look.badge.cls}`}
                  >
                    {look.badge.text}
                  </span>
                )}
                <div className={look.dim ? "opacity-50" : undefined}>
                  {/* Image / fallback */}
                  <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
                    {product.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className={`w-full h-full object-cover ${look.dim ? "grayscale" : ""}`}
                      />
                    ) : (
                      <span className="text-3xl font-bold text-muted-foreground/30 select-none">
                        {product.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="font-semibold text-sidebar text-base leading-snug line-clamp-2">
                      {product.name}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-accent font-bold text-lg tabular-nums">
                        ฿{formatPrice(product.price)}
                      </p>
                      <span className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center text-lg font-bold shrink-0">
                        +
                      </span>
                    </div>
                    {productsWithModifiers.has(product.id) && (
                      <p className="text-sm text-muted-foreground mt-0.5">ปรับได้</p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="col-span-full text-center py-16 text-muted-foreground text-base">
              ไม่มีสินค้า
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
