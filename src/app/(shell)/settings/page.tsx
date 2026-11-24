import Link from "next/link";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { getProfile } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import {
  updateStoreName,
  updateBusinessSettings,
  updatePromptPayId,
  updateCashFloatDefault,
  updateBagSettings,
} from "@/app/actions/settings";
import { CashFloatForm } from "@/components/settings/cash-float-form";
import { BagSettingsForm } from "@/components/settings/bag-settings-form";
import { StoreNameForm } from "@/components/settings/store-name-form";
import { ShopLogoForm } from "@/components/settings/shop-logo-form";
import { BusinessSettingsForm } from "@/components/settings/business-settings-form";
import { PromptPayForm } from "@/components/settings/promptpay-form";
import { MfaSection } from "@/components/settings/mfa-section";
import { bagFormLoad } from "@/lib/stock/packaging-input";

export default async function SettingsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner") redirect("/");

  const supabase = await createClient();
  const [{ data: tenant, error: tenantError }, { data: bagMaterials, error: bagListError }] = await Promise.all([
    supabase
      .from("tenants")
      .select(
        "name, logo_url, fixed_cost_monthly, delivery_gp_percent, order_prefix, promptpay_id, cash_float_default, bag_material_id, bags_per_cups"
      )
      .eq("id", profile.tenant_id)
      .single(),
    // "วัตถุดิบถุง": only the shop's counted (track_stock) materials that are in use (R-D2a-11). No cost column.
    supabase
      .from("raw_materials")
      .select("id, name, unit, category")
      .eq("tenant_id", profile.tenant_id)
      .is("archived_at", null)
      .eq("track_stock", true)
      .order("name"),
  ]);
  // A failed read of the bag setting or of the material list shows an error instead of the form, so
  // saving can never clear a valid bag material (bagFormLoad).
  const bags = bagFormLoad(
    {
      failed: tenantError !== null,
      bagMaterialId: tenant?.bag_material_id ?? null,
      bagsPerCups: tenant?.bags_per_cups ?? null,
    },
    { failed: bagListError !== null, materials: bagMaterials }
  );
  if (tenantError) console.error("[settings] tenant read failed:", tenantError.message);
  if (bagListError) console.error("[settings] bag material list read failed:", bagListError.message);
  // The saved bag material may have been archived or stopped being counted since: name it so the owner re-picks.
  let staleBagName: string | null = null;
  if ("defaults" in bags && bags.defaults.bagMaterialId !== null && !bags.defaults.listed) {
    const { data: stale } = await supabase
      .from("raw_materials")
      .select("name")
      .eq("id", bags.defaults.bagMaterialId)
      .eq("tenant_id", profile.tenant_id)
      .maybeSingle();
    staleBagName = stale?.name ?? "วัตถุดิบเดิม";
  }

  const { data: mfaFactors } = await supabase.auth.mfa.listFactors();
  const hasMfaEnabled = mfaFactors?.totp.some((f) => f.status === "verified") ?? false;

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
        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium text-sidebar">โลโก้ร้าน (แสดงบนใบเสร็จ)</p>
          <ShopLogoForm logoUrl={tenant?.logo_url ?? null} shopName={tenant?.name ?? profile.tenants.name} />
        </div>
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

      {/* PromptPay */}
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-sidebar">รับเงินผ่าน QR PromptPay</h2>
        <PromptPayForm
          action={updatePromptPayId}
          defaultValue={tenant?.promptpay_id ?? ""}
        />
      </div>

      {/* Cash drawer float */}
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-sidebar">ลิ้นชักเงินสด</h2>
        <CashFloatForm
          action={updateCashFloatDefault}
          defaultValue={Number(tenant?.cash_float_default ?? 1000)}
        />
      </div>

      {/* Carry-out bags (round D2a) */}
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-sidebar">ถุงหิ้ว</h2>
        {"error" in bags ? (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-base font-medium text-destructive">
            {bags.error}
          </p>
        ) : (
          <BagSettingsForm
            action={updateBagSettings}
            materials={bags.materials}
            defaults={{ materialId: bags.defaults.bagMaterialId, bagsPerCups: bags.defaults.bagsPerCups }}
            staleMaterialName={staleBagName}
          />
        )}
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

      {/* MFA */}
      <MfaSection initiallyEnabled={hasMfaEnabled} />
    </div>
  );
}
