"use client";

type Product = {
  id: string;
  name: string;
  price: number;
  categories: { name: string } | null;
};

type Props = {
  products: Product[];
  onAddToCart: (product: Product) => void;
};

export function ProductGrid({ products, onAddToCart }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 p-1">
      {products.map((product) => (
        <button
          key={product.id}
          type="button"
          onClick={() => onAddToCart(product)}
          className="text-left rounded-lg border bg-white p-3 hover:border-accent hover:shadow-sm transition-all active:scale-95 cursor-pointer"
        >
          <p className="font-medium text-sidebar text-sm leading-tight line-clamp-2 min-h-[2.5rem]">
            {product.name}
          </p>
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {product.categories?.name ?? "ไม่ระบุหมวดหมู่"}
          </p>
          <p className="text-accent font-semibold text-sm mt-2">
            ฿{Number(product.price).toFixed(2)}
          </p>
        </button>
      ))}
      {products.length === 0 && (
        <p className="col-span-full text-center py-16 text-muted-foreground">
          ยังไม่มีสินค้า
        </p>
      )}
    </div>
  );
}
