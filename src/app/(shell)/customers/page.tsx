import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile, getCustomers } from "@/lib/dal";

export default async function CustomersPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");

  const customers = await getCustomers(profile.tenant_id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">ลูกค้า</h1>
        <p className="text-sm text-muted-foreground mt-1">
          รายชื่อลูกค้าและประวัติการสั่งซื้อ
        </p>
      </div>

      <div className="rounded-lg border bg-white divide-y divide-border">
        {customers.length > 0 ? (
          customers.map((c) => (
            <Link
              key={c.id}
              href={`/customers/${c.id}`}
              className="flex items-center gap-4 px-4 py-3 hover:bg-muted transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sidebar truncate">{c.name}</p>
                <p className="text-sm text-muted-foreground">
                  {c.phone ?? "ไม่มีเบอร์โทร"} · {c.orderCount} ออเดอร์
                </p>
              </div>
              <p className="text-sm font-semibold text-sidebar tabular-nums shrink-0">
                ฿{c.totalSpent.toFixed(2)}
              </p>
            </Link>
          ))
        ) : (
          <p className="px-4 py-8 text-center text-muted-foreground">
            ยังไม่มีข้อมูลลูกค้า
          </p>
        )}
      </div>
    </div>
  );
}
