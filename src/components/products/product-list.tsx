"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpDown, ImageIcon, Plus, Search } from "lucide-react";
import { SortableList } from "@/components/ui/sortable-list";
import { useToastManager } from "@/components/ui/toast";
import { ProductRowMenu } from "@/components/products/product-row-menu";
import { reorderProducts } from "@/app/actions/menu-order";
import { formatPrice } from "@/lib/cash";

export type ProductItem = {
  id: string;
  name: string;
  price: number;
  isActive: boolean;
  imageUrl: string | null;
};

export type ProductGroup = {
  /** Category id, or "none" for uncategorized. */
  key: string;
  categoryId: string | null;
  name: string;
  products: ProductItem[];
};

const BTN = "h-12 px-5 rounded-xl text-base font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors disabled:opacity-60";
const BTN_OUTLINE = `${BTN} border border-input bg-white text-sidebar hover:bg-muted`;
const BTN_ACCENT = `${BTN} bg-accent text-white hover:bg-accent/90`;

export function ProductList({ groups, initialCategory }: { groups: ProductGroup[]; initialCategory: string | null }) {
  const router = useRouter();
  const toastManager = useToastManager();
  const [activeKey, setActiveKey] = useState<string | null>(
    groups.find((g) => g.key === initialCategory)?.key ?? groups[0]?.key ?? null
  );
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState(false);
  const [order, setOrder] = useState<ProductItem[]>([]);
  const [pending, startTransition] = useTransition();

  const active = groups.find((g) => g.key === activeKey) ?? groups[0] ?? null;
  const q = query.trim().toLowerCase();
  const visible = active ? active.products.filter((p) => q === "" || p.name.toLowerCase().includes(q)) : [];
  const newMenuHref = active?.categoryId ? `/products/new?category=${active.categoryId}` : "/products/new";

  function startSorting() {
    if (!active) return;
    setOrder(active.products);
    setQuery("");
    setSorting(true);
  }

  function saveOrder() {
    if (!active) return;
    startTransition(async () => {
      try {
        const result = await reorderProducts(active.categoryId, order.map((p) => p.id));
        if ("error" in result) {
          toastManager.add({ title: result.error, type: "error" });
          return;
        }
        toastManager.add({ title: "บันทึกลำดับแล้ว", type: "success" });
        setSorting(false);
        router.refresh();
      } catch {
        toastManager.add({ title: "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่", type: "error" });
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold text-sidebar leading-tight">สินค้า</h1>
          <p className="text-base text-muted-foreground mt-1">
            {sorting
              ? `ลากที่ ⠿ เพื่อเรียงเมนูในหมวด ${active?.name ?? ""} หน้า POS จะเรียงตามนี้`
              : "จัดการเมนูทั้งหมดของร้าน"}
          </p>
        </div>
        {sorting ? (
          <div className="flex gap-2">
            <button type="button" className={BTN_OUTLINE} onClick={() => setSorting(false)} disabled={pending}>
              ยกเลิก
            </button>
            <button type="button" className={BTN_ACCENT} onClick={saveOrder} disabled={pending}>
              {pending ? "กำลังบันทึก…" : "เสร็จสิ้น"}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              className={BTN_OUTLINE}
              onClick={startSorting}
              disabled={!active || active.products.length < 2}
            >
              <ArrowUpDown size={18} />
              จัดเรียง
            </button>
            <Link href={newMenuHref} className={BTN_ACCENT}>
              <Plus size={18} />
              เพิ่มเมนู
            </Link>
          </div>
        )}
      </div>

      {groups.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="หมวดหมู่">
          {groups.map((g) => {
            const selected = g.key === active?.key;
            return (
              <button
                key={g.key}
                type="button"
                role="tab"
                aria-selected={selected}
                disabled={sorting && !selected}
                onClick={() => {
                  setActiveKey(g.key);
                  setQuery("");
                }}
                className={`h-12 px-5 rounded-full text-base font-semibold whitespace-nowrap transition-colors disabled:opacity-40 ${
                  selected
                    ? "bg-accent text-white"
                    : "bg-white border border-border text-muted-foreground hover:border-accent hover:text-accent"
                }`}
              >
                {g.name} <span className={selected ? "text-white/80" : "text-muted-foreground/70"}>({g.products.length})</span>
              </button>
            );
          })}
        </div>
      )}

      {!sorting && active && active.products.length > 0 && (
        <div className="relative max-w-sm">
          <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`ค้นหาเมนูใน ${active.name}`}
            className="w-full h-12 rounded-xl border border-input bg-white pl-12 pr-4 text-[17px] text-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
        </div>
      )}

      {!active ? (
        <p className="rounded-xl border bg-white px-4 py-10 text-center text-base text-muted-foreground">
          ยังไม่มีเมนู — เริ่มจากกด &quot;เพิ่มเมนู&quot;
        </p>
      ) : sorting ? (
        <div className="rounded-xl border bg-white p-2 space-y-1">
          <SortableList
            items={order}
            onReorder={setOrder}
            renderItem={(p, handle) => (
              <div className="flex items-center gap-3 min-h-16 px-2 py-1">
                {handle}
                <Thumb url={p.imageUrl} />
                <span className="flex-1 min-w-0 truncate text-[17px] font-medium text-sidebar">{p.name}</span>
                <span className="text-base text-muted-foreground tabular-nums">฿{formatPrice(p.price)}</span>
              </div>
            )}
          />
        </div>
      ) : active.products.length === 0 ? (
        <p className="rounded-xl border bg-white px-4 py-10 text-center text-base text-muted-foreground">
          ยังไม่มีเมนูในหมวดนี้
        </p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border bg-white px-4 py-10 text-center text-base text-muted-foreground">
          ไม่พบเมนูที่ค้นหา
        </p>
      ) : (
        <div className="rounded-xl border bg-white divide-y divide-border">
          {visible.map((p) => (
            <div key={p.id} className="flex items-center gap-4 min-h-16 px-4 py-2">
              <Thumb url={p.imageUrl} />
              <Link href={`/products/${p.id}/edit`} className="flex-1 min-w-0">
                <p className="truncate text-[17px] font-medium text-sidebar">{p.name}</p>
                <p className="text-base text-muted-foreground tabular-nums">฿{formatPrice(p.price)}</p>
              </Link>
              <span
                className={`h-8 px-3 rounded-full text-sm font-semibold inline-flex items-center ${
                  p.isActive ? "bg-sidebar text-white" : "bg-muted text-muted-foreground"
                }`}
              >
                {p.isActive ? "เปิด" : "ปิด"}
              </span>
              <ProductRowMenu productId={p.id} productName={p.name} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Thumb({ url }: { url: string | null }) {
  return (
    <span className="w-12 h-12 shrink-0 rounded-lg overflow-hidden bg-muted flex items-center justify-center text-muted-foreground">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <ImageIcon size={20} />
      )}
    </span>
  );
}
