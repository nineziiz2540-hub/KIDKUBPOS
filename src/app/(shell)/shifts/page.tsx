import { redirect } from "next/navigation";
import { getProfile, getActiveShift, getShiftSummary } from "@/lib/dal";
import { ShiftPanel } from "@/components/shifts/shift-panel";

export default async function ShiftsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const activeShift = await getActiveShift(profile.tenant_id);
  const summary = activeShift
    ? await getShiftSummary(profile.tenant_id, activeShift.id)
    : null;

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-sidebar">จัดการกะ</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          เปิด/ปิดกะและตรวจสอบเงินสดในลิ้นชัก
        </p>
      </div>
      <ShiftPanel activeShift={activeShift} summary={summary} />
    </div>
  );
}
