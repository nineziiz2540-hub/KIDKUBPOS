import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { OrdersFilter } from "@/components/orders/orders-filter";

type FilterValue = "all" | "cash" | "transfer" | "cancelled" | "refunded";

type OrderRow = {
  id: string;
  order_number: string | null;
  queue_number: number | null;
  payment_method: string;
  status: string;
  total: number;
  created_at: string;
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: "เงินสด",
  transfer: "โอน",
};

type Props = {
  searchParams: Promise<{ filter?: string }>;
};

export default async function OrdersPage({ searchParams }: Props) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const { filter } = await searchParams;
  const filterValue = (filter ?? "all") as FilterValue;

  const supabase = await createClient();
  const baseQuery = supabase
    .from("orders")
    .select("id, order_number, queue_number, payment_method, status, total, created_at")
    .eq("tenant_id", profile.tenant_id)
    .order("created_at", { ascending: false });

  const filteredQuery =
    filterValue === "cancelled"
      ? baseQuery.eq("status", "cancelled")
      : filterValue === "refunded"
        ? baseQuery.eq("status", "refunded")
        : filterValue !== "all"
          ? baseQuery
              .eq("payment_method", filterValue)
              .neq("status", "cancelled")
              .neq("status", "refunded")
          : baseQuery;

  const { data: orders } = (await filteredQuery) as { data: OrderRow[] | null };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">ประวัติบิล</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          บิลทั้งหมดของร้าน
        </p>
      </div>

      <Suspense fallback={null}>
        <OrdersFilter />
      </Suspense>

      <div className="rounded-lg border bg-white divide-y divide-border">
        {orders && orders.length > 0 ? (
          orders.map((order) => (
            <Link
              key={order.id}
              href={`/orders/${order.id}`}
              className="flex items-center gap-4 px-4 py-3 hover:bg-surface transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="flex items-center gap-2 font-medium text-sidebar text-sm font-mono">
                  {order.order_number ?? `#${order.id.slice(0, 8).toUpperCase()}`}
                  {order.queue_number !== null && (
                    <span className="font-sans text-xs font-semibold bg-accent/10 text-accent rounded-full px-2 py-0.5">
                      คิว {order.queue_number}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(order.created_at).toLocaleString("th-TH", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                  order.status === "cancelled"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : order.status === "refunded"
                      ? "border-warning/30 bg-warning/10 text-warning"
                      : "border-success/30 bg-success/10 text-success"
                }`}
              >
                {order.status === "cancelled"
                  ? "ยกเลิก"
                  : order.status === "refunded"
                    ? "คืนเงิน"
                    : (PAYMENT_LABELS[order.payment_method] ?? order.payment_method)}
              </span>
              <p className="text-sm font-semibold text-sidebar tabular-nums w-24 text-right">
                ฿{Number(order.total).toFixed(2)}
              </p>
            </Link>
          ))
        ) : (
          <p className="px-4 py-12 text-center text-muted-foreground text-sm">
            ไม่พบบิล
          </p>
        )}
      </div>
    </div>
  );
}
