import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getProfile, getCustomerById, getCustomerOrders } from "@/lib/dal";
import { formatDate } from "@/lib/bangkok-time";

const PAYMENT_LABELS: Record<string, string> = {
  cash: "เงินสด",
  transfer: "โอน",
};

// Only bills that aren't a normal completed sale get a label; none of these count toward the
// customer's totals (getCustomerById counts completed bills only).
const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  cancelled: { label: "ยกเลิก", className: "text-destructive" },
  refunded: { label: "คืนเงิน", className: "text-warning" },
  unpaid: { label: "ไม่ได้รับเงิน", className: "text-destructive" },
};

function StatusNote({ status }: { status: string }) {
  const note = STATUS_LABELS[status];
  if (!note) return null;
  return <span className={`ml-2 font-medium ${note.className}`}>· {note.label}</span>;
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");

  const { id } = await params;

  const customer = await getCustomerById(profile.tenant_id, id);
  if (!customer) notFound();

  const orders = await getCustomerOrders(profile.tenant_id, id);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/customers" className="text-sm text-accent hover:underline">
          ← กลับไปรายชื่อลูกค้า
        </Link>
        <h1 className="text-2xl font-bold text-sidebar mt-1">{customer.name}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {customer.phone ?? "ไม่มีเบอร์โทร"} · {customer.email ?? "ไม่มีอีเมล"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-muted-foreground">ยอดซื้อสะสม</p>
          <p className="text-xl font-bold text-sidebar tabular-nums">
            ฿{customer.totalSpent.toFixed(2)}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs text-muted-foreground">จำนวนออเดอร์</p>
          <p className="text-xl font-bold text-sidebar tabular-nums">
            {customer.orderCount}
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-base font-semibold text-sidebar mb-3">
          ประวัติการสั่งซื้อ
        </h2>
        <div className="rounded-lg border bg-white divide-y divide-border">
          {orders.length > 0 ? (
            orders.map((o) => (
              <Link
                key={o.id}
                href={`/orders/${o.id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-muted transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sidebar truncate">
                    {o.orderNumber ?? "—"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatDate(o.createdAt)} ·{" "}
                    {PAYMENT_LABELS[o.paymentMethod] ?? o.paymentMethod}
                    <StatusNote status={o.status} />
                  </p>
                </div>
                <p className="text-sm font-semibold text-sidebar tabular-nums shrink-0">
                  ฿{o.total.toFixed(2)}
                </p>
              </Link>
            ))
          ) : (
            <p className="px-4 py-8 text-center text-muted-foreground">
              ยังไม่มีประวัติการสั่งซื้อ
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
