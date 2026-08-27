import { redirect } from "next/navigation";
import { getProfile, getProductsForCalculator, getTenantDeliveryGp } from "@/lib/dal";
import { PricingCalculator } from "@/components/dashboard/pricing-calculator";

export default async function PricingCalculatorPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/");

  const [calcProducts, defaultDeliveryGp] = await Promise.all([
    getProductsForCalculator(profile.tenant_id),
    getTenantDeliveryGp(profile.tenant_id),
  ]);

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">คำนวณราคาขาย</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          ตั้งราคาขายจากต้นทุนวัตถุดิบและ GP ที่ต้องการ
        </p>
      </div>
      <PricingCalculator products={calcProducts} defaultDeliveryGp={defaultDeliveryGp} />
    </div>
  );
}
