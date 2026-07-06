"use client";
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import type { CartItem, ModifierWithOptions, PosProduct, SelectedModifier } from "@/types/app";

type Props = {
  product: PosProduct;
  modifiers: ModifierWithOptions[];
  onAddToCart: (item: CartItem) => void;
  onClose: () => void;
};

export function ModifierModal({ product, modifiers, onAddToCart, onClose }: Props) {
  const [selections, setSelections] = useState<Map<string, Set<string>>>(
    () => new Map()
  );

  const isValid = modifiers
    .filter((m) => m.isRequired)
    .every((m) => {
      const sel = selections.get(m.id);
      return sel !== undefined && sel.size > 0;
    });

  const totalDelta = modifiers.flatMap((m) => m.options).reduce((sum, opt) => {
    const modSel = modifiers.find((m) => m.options.some((o) => o.id === opt.id));
    if (!modSel) return sum;
    const sel = selections.get(modSel.id);
    return sel?.has(opt.id) ? sum + opt.priceDelta : sum;
  }, 0);

  const displayPrice = product.price + totalDelta;

  function toggle(modifierId: string, optionId: string, isMultiSelect: boolean) {
    setSelections((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(modifierId) ?? []);
      if (isMultiSelect) {
        if (current.has(optionId)) current.delete(optionId);
        else current.add(optionId);
      } else {
        current.clear();
        current.add(optionId);
      }
      next.set(modifierId, current);
      return next;
    });
  }

  function handleAdd() {
    const selectedModifiers: SelectedModifier[] = [];
    for (const modifier of modifiers) {
      const sel = selections.get(modifier.id) ?? new Set<string>();
      for (const optionId of sel) {
        const option = modifier.options.find((o) => o.id === optionId);
        if (option) {
          selectedModifiers.push({
            modifierId: modifier.id,
            modifierName: modifier.name,
            optionId: option.id,
            optionName: option.name,
            priceDelta: option.priceDelta,
          });
        }
      }
    }
    const unitPrice = product.price + totalDelta;
    onAddToCart({
      cartItemKey: `${product.id}-${Date.now()}`,
      productId: product.id,
      name: product.name,
      basePrice: product.price,
      quantity: 1,
      selectedModifiers,
      totalPrice: unitPrice,
    });
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Popup className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-md max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="px-5 pt-5 pb-3 border-b shrink-0">
              <Dialog.Title className="font-bold text-sidebar text-lg leading-tight">
                {product.name}
              </Dialog.Title>
              <p className="text-sm text-muted-foreground mt-0.5">
                ฿{product.price.toFixed(0)}
              </p>
            </div>

            {/* Modifier groups */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {modifiers.map((modifier) => (
                <div key={modifier.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-sm text-sidebar">
                      {modifier.name}
                    </span>
                    {modifier.isRequired && (
                      <span className="text-xs bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded-full">
                        จำเป็น
                      </span>
                    )}
                    {modifier.isMultiSelect && (
                      <span className="text-xs text-muted-foreground">
                        (เลือกได้หลายอย่าง)
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {modifier.options.map((option) => {
                      const isSelected =
                        selections.get(modifier.id)?.has(option.id) ?? false;
                      return (
                        <label
                          key={option.id}
                          className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors border ${
                            isSelected
                              ? "border-accent bg-accent/5"
                              : "border-border hover:bg-muted/50"
                          }`}
                        >
                          <input
                            type={modifier.isMultiSelect ? "checkbox" : "radio"}
                            name={`mod-${modifier.id}`}
                            checked={isSelected}
                            onChange={() =>
                              toggle(modifier.id, option.id, modifier.isMultiSelect)
                            }
                            className="sr-only"
                          />
                          {/* Custom indicator */}
                          <span
                            className={`w-4 h-4 shrink-0 border-2 flex items-center justify-center transition-colors ${
                              modifier.isMultiSelect ? "rounded" : "rounded-full"
                            } ${
                              isSelected
                                ? "border-accent bg-accent"
                                : "border-border"
                            }`}
                          >
                            {isSelected && (
                              <span className="w-2 h-2 bg-white rounded-sm" />
                            )}
                          </span>
                          <span className="flex-1 text-sm">{option.name}</span>
                          {option.priceDelta !== 0 && (
                            <span className="text-sm text-muted-foreground tabular-nums">
                              {option.priceDelta > 0 ? "+" : ""}฿
                              {option.priceDelta.toFixed(0)}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t flex gap-3 shrink-0">
              <Dialog.Close className="flex-1 inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted transition-colors">
                ยกเลิก
              </Dialog.Close>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!isValid}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white transition-colors ${
                  isValid
                    ? "bg-accent hover:bg-accent/90 active:scale-95"
                    : "bg-accent/40 cursor-not-allowed"
                }`}
              >
                เพิ่มในตะกร้า • ฿{displayPrice.toFixed(0)}
              </button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
