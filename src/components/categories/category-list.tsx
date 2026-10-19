"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpDown, Plus } from "lucide-react";
import { SortableList } from "@/components/ui/sortable-list";
import { DeleteButton } from "@/components/ui/delete-button";
import { useToastManager } from "@/components/ui/toast";
import { deleteCategory } from "@/app/actions/categories";
import { reorderCategories } from "@/app/actions/menu-order";

type Category = { id: string; name: string };

const BTN = "h-12 px-5 rounded-xl text-base font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors";
const BTN_OUTLINE = `${BTN} border border-input bg-white text-sidebar hover:bg-muted`;
const BTN_ACCENT = `${BTN} bg-accent text-white hover:bg-accent/90`;

export function CategoryList({ categories, canManage }: { categories: Category[]; canManage: boolean }) {
  const router = useRouter();
  const toastManager = useToastManager();
  const [sorting, setSorting] = useState(false);
  const [order, setOrder] = useState<Category[]>(categories);
  const [pending, startTransition] = useTransition();

  function startSorting() {
    setOrder(categories);
    setSorting(true);
  }

  function saveOrder() {
    startTransition(async () => {
      try {
        const result = await reorderCategories(order.map((c) => c.id));
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
          <h1 className="text-[26px] font-bold text-sidebar leading-tight">หมวดหมู่สินค้า</h1>
          <p className="text-base text-muted-foreground mt-1">
            {sorting ? "ลากที่ ⠿ เพื่อเปลี่ยนลำดับ หน้า POS จะเรียงตามนี้" : "จัดการหมวดหมู่สินค้าของร้านค้า"}
          </p>
        </div>
        {canManage &&
          (sorting ? (
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
              {categories.length > 1 && (
                <button type="button" className={BTN_OUTLINE} onClick={startSorting}>
                  <ArrowUpDown size={18} />
                  จัดเรียง
                </button>
              )}
              <Link href="/categories/new" className={BTN_ACCENT}>
                <Plus size={18} />
                เพิ่มหมวดหมู่
              </Link>
            </div>
          ))}
      </div>

      {categories.length === 0 ? (
        <p className="rounded-xl border bg-white px-4 py-10 text-center text-base text-muted-foreground">
          ยังไม่มีหมวดหมู่
        </p>
      ) : sorting ? (
        <div className="rounded-xl border bg-white p-2 space-y-1">
          <SortableList
            items={order}
            onReorder={setOrder}
            renderItem={(cat, handle) => (
              <div className="flex items-center gap-2 min-h-14 px-2">
                {handle}
                <span className="flex-1 min-w-0 truncate text-[17px] font-medium text-sidebar">{cat.name}</span>
              </div>
            )}
          />
        </div>
      ) : (
        <div className="rounded-xl border bg-white divide-y divide-border">
          {categories.map((cat) => (
            <div key={cat.id} className="flex items-center justify-between gap-3 min-h-14 px-4 py-2">
              <span className="flex-1 min-w-0 truncate text-[17px] font-medium text-sidebar">{cat.name}</span>
              {canManage && (
                <div className="flex gap-2 shrink-0">
                  <Link
                    href={`/categories/${cat.id}/edit`}
                    className="h-11 px-4 rounded-lg border border-input bg-white text-base font-medium text-sidebar inline-flex items-center hover:bg-muted"
                  >
                    แก้ไข
                  </Link>
                  <form action={deleteCategory}>
                    <input type="hidden" name="id" value={cat.id} />
                    <DeleteButton
                      message={`ลบหมวดหมู่ "${cat.name}"? เมนูในหมวดนี้จะย้ายไปที่ "ไม่ระบุหมวดหมู่"`}
                      className="h-11 px-4 text-base"
                    />
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
