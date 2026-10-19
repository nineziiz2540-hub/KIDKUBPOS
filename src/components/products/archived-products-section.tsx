"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatPrice } from "@/lib/cash";
import { RestoreProductButton } from "@/components/products/restore-product-button";

type ArchivedProduct = { id: string; name: string; price: number; archivedAt: string };

export function ArchivedProductsSection({ products }: { products: ArchivedProduct[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-sidebar"
      >
        <span>เมนูที่เก็บแล้ว ({products.length})</span>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      {open && (
        <div className="divide-y divide-border border-t">
          {products.map((product) => (
            <div key={product.id} className="flex items-center gap-4 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sidebar text-sm truncate">{product.name}</p>
                <p className="text-xs text-muted-foreground">
                  ฿{formatPrice(product.price)} · เก็บเมื่อ{" "}
                  {new Date(product.archivedAt).toLocaleDateString("th-TH")}
                </p>
              </div>
              <RestoreProductButton productId={product.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
