import { redirect } from "next/navigation";
import {
  getProfile,
  getActiveShift,
  getShiftSummary,
  getOpenHeldBills,
  getCashMovements,
  getShiftTotals,
  getPeopleNames,
} from "@/lib/dal";
import { formatTime } from "@/lib/bangkok-time";
import { personalOutstanding } from "@/lib/shift-math";
import { ShiftPanel } from "@/components/shifts/shift-panel";
import { OpenShiftCard } from "@/components/shifts/open-shift-card";
import { ShiftMovements } from "@/components/shifts/shift-movements";
import { ShiftSummaryCard } from "@/components/shifts/shift-summary-card";

export default async function ShiftsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const canSeeTotals = profile.role === "owner" || profile.role === "manager";
  const activeShift = await getActiveShift(profile.tenant_id);

  const header = (
    <div>
      <h1 className="text-[26px] font-bold leading-tight text-sidebar">จัดการกะ</h1>
      <p className="mt-0.5 text-base text-muted-foreground">
        เปิด/ปิดกะ และบันทึกเงินเข้า-ออกลิ้นชัก
      </p>
    </div>
  );

  if (!activeShift) {
    return (
      <div className="space-y-6">
        {header}
        <OpenShiftCard />
      </div>
    );
  }

  const [movements, openHeld, totals] = await Promise.all([
    getCashMovements(profile.tenant_id, activeShift.id),
    getOpenHeldBills(profile.tenant_id),
    // Staff must never receive the expected cash before counting: not fetched at all for them.
    canSeeTotals ? getShiftTotals(profile.tenant_id, activeShift.id) : Promise.resolve(null),
  ]);
  const names = await getPeopleNames(profile.tenant_id, [
    activeShift.openedBy,
    ...movements.map((m) => m.createdBy),
  ]);
  const summary = await getShiftSummary(profile.tenant_id, activeShift.id);

  return (
    <div className="space-y-6">
      {header}
      <p className="text-lg font-semibold text-sidebar">
        เปิดกะโดย {names[activeShift.openedBy] ?? "—"} · {formatTime(activeShift.openedAt)}
      </p>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <ShiftMovements
          shiftId={activeShift.id}
          personalOutstanding={personalOutstanding(movements)}
          movements={movements.map((m) => ({
            id: m.id,
            direction: m.direction,
            reason: m.reason,
            amount: m.amount,
            note: m.note,
            createdAt: m.createdAt,
            createdByName: names[m.createdBy] ?? "—",
          }))}
        />
        <div className="space-y-6">
          {totals && <ShiftSummaryCard totals={totals} />}
          {/* Interim: the old close form, replaced by the blind closing flow in round B Task 5. */}
          <ShiftPanel
            activeShift={activeShift}
            summary={summary}
            openHeld={openHeld.map((b) => ({
              id: b.id,
              queueNumber: b.queueNumber,
              customerLabel: b.customerLabel,
              total: b.total,
            }))}
          />
        </div>
      </div>
    </div>
  );
}
