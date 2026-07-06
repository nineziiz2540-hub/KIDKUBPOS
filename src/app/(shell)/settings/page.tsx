import Link from "next/link";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { updateStoreName, updateBusinessSettings } from "@/app/actions/settings";
import { StoreNameForm } from "@/components/settings/store-name-form";
import { BusinessSettingsForm } from "@/components/settings/business-settings-form";

export default async function SettingsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner") redirect("/");

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, fixed_cost_monthly, delivery_gp_percent, order_prefix")
    .eq("id", profile.tenant_id)
    .single();

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">ตั้งค่าร้านค้า</h1>
        <p className="text-sm text-muted-foreground mt-0.5">จัดการข้อมูลร้านของคุณ</p>
      </div>

      {/* Store name */}
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-sidebar">ข้อมูลร้านค้า</h2>
        <StoreNameForm action={updateStoreName} defaultName={tenant?.name ?? profile.tenants.name} />
      </div>

      {/* Business settings */}
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-sidebar">ตั้งค่าธุรกิจ</h2>
        <BusinessSettingsForm
          action={updateBusinessSettings}
          defaults={{
            fixedCostMonthly: Number(tenant?.fixed_cost_monthly ?? 0),
            deliveryGpPercent: Number(tenant?.delivery_gp_percent ?? 0),
            orderPrefix: tenant?.order_prefix ?? "KK",
          }}
        />
      </div>

      {/* Team */}
      <div className="rounded-lg border bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-sidebar">จัดการทีม</h2>
            <p className="text-sm text-muted-foreground mt-0.5">ดูและแก้ไข Role ของพนักงาน</p>
          </div>
          <Link
            href="/settings/team"
            className="flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            <Users size={16} />
            ดูทีมงาน
          </Link>
        </div>
      </div>
    </div>
  );
}
