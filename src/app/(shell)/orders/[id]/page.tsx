import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

type OrderItem = {
  id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
};

type OrderDetail = {
  id: string;
  payment_method: string;
  status: string;
  total: number;
  note: string | null;
  created_at: string;
  order_items: OrderItem[];
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: "เงินสด",
  transfer: "โอน",
  card: "บัตร",
};

type Props = {
  params: Promise<{ id: string }>;
};

export default async function OrderDetailPage({ params }: Props) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = (await supabase
    .from("orders")
    .select(
      "id, payment_method, status, total, note, created_at, order_items(id, product_name, unit_price, quantity, subtotal)"
    )
    .eq("id", id)
    .eq("tenant_id", profile.tenant_id)
    .single()) as { data: OrderDetail | null };

  if (!order) notFound();

  return (
    <div className="space-y-6 max-w-xl">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <Link
          href="/orders"
          className="text-muted-foreground hover:text-sidebar transition-colors"
        >
          <ChevronLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-sidebar font-mono">
            #{order.id.slice(0, 8).toUpperCase()}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date(order.created_at).toLocaleString("th-TH", {
              dateStyle: "long",
              timeStyle: "short",
            })}
          </p>
        </div>
      </div>

      {/* Line items */}
      <div className="rounded-lg border bg-white divide-y divide-border">
        {order.order_items.map((item) => (
          <div key={item.id} className="flex items-center gap-4 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sidebar text-sm">
                {item.product_name}
              </p>
              <p className="text-xs text-muted-foreground">
                ฿{Number(item.unit_price).toFixed(2)} × {item.quantity}
              </p>
            </div>
            <p className="text-sm font-semibold text-sidebar tabular-nums">
              ฿{Number(item.subtotal).toFixed(2)}
            </p>
          </div>
        ))}
        {order.order_items.length === 0 && (
          <p className="px-4 py-8 text-center text-muted-foreground text-sm">
            ไม่มีรายการสินค้า
          </p>
        )}
      </div>

      {/* Order summary */}
      <div className="rounded-lg border bg-white px-4 py-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">วิธีชำระ</span>
          <span className="font-medium text-sidebar">
            {PAYMENT_LABELS[order.payment_method] ?? order.payment_method}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">สถานะ</span>
          <span
            className={`font-medium ${
              order.status === "cancelled"
                ? "text-destructive"
                : "text-green-700"
            }`}
          >
            {order.status === "cancelled" ? "ยกเลิก" : "สำเร็จ"}
          </span>
        </div>
        {order.note !== null && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">หมายเหตุ</span>
            <span className="font-medium text-sidebar text-right max-w-[60%]">
              {order.note}
            </span>
          </div>
        )}
        <div className="flex justify-between font-semibold text-sidebar pt-2 border-t border-border">
          <span>รวมทั้งหมด</span>
          <span className="tabular-nums">
            ฿{Number(order.total).toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}
