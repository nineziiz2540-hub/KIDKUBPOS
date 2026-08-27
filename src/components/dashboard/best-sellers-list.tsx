import type { TopProduct } from "@/lib/dal";

export function BestSellersList({ products }: { products: TopProduct[] }) {
  return (
    <div className="rounded-lg border bg-white divide-y divide-border">
      {products.length > 0 ? (
        products.map((p, i) => (
          <div key={p.product_name} className="flex items-center gap-4 px-4 py-3">
            <span className="text-sm font-bold text-muted-foreground w-5 text-center tabular-nums">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sidebar text-sm truncate">{p.product_name}</p>
              <p className="text-xs text-muted-foreground">
                {p.total_qty} {p.unit}
              </p>
            </div>
            <p className="text-sm font-semibold text-sidebar tabular-nums">
              ฿{p.total_sales.toFixed(2)}
            </p>
          </div>
        ))
      ) : (
        <p className="px-4 py-12 text-center text-muted-foreground text-sm">
          ยังไม่มีข้อมูลการขาย
        </p>
      )}
    </div>
  );
}
