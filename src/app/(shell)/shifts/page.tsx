import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getProfile,
  getActiveShift,
  getOpenHeldBills,
  getCashMovements,
  getCashCounts,
  getCashFloatDefault,
  getShiftById,
  getShiftTotals,
  getPeopleNames,
} from "@/lib/dal";
import { formatTime } from "@/lib/bangkok-time";
import { closingStep, compareCount, formatMoney, personalOutstanding } from "@/lib/shift-math";
import { OpenShiftCard } from "@/components/shifts/open-shift-card";
import { ShiftMovements } from "@/components/shifts/shift-movements";
import { ShiftSummaryCard } from "@/components/shifts/shift-summary-card";
import {
  CloseShiftFlow,
  type ClosingResult,
  type ClosingStartStep,
} from "@/components/shifts/close-shift-flow";

type Props = {
  searchParams: Promise<{ closed?: string }>;
};

export default async function ShiftsPage({ searchParams }: Props) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const canSeeTotals = profile.role === "owner" || profile.role === "manager";
  const activeShift = await getActiveShift(profile.tenant_id);

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-bold leading-tight text-sidebar">จัดการกะ</h1>
        <p className="mt-0.5 text-base text-muted-foreground">
          เปิด/ปิดกะ และบันทึกเงินเข้า-ออกลิ้นชัก
        </p>
      </div>
      {canSeeTotals && (
        <Link
          href="/shifts/history"
          className="flex h-12 items-center rounded-xl border border-input bg-white px-4 text-base font-semibold text-sidebar hover:bg-muted"
        >
          ประวัติกะ
        </Link>
      )}
    </div>
  );

  if (!activeShift) {
    const { closed } = await searchParams;
    const justClosed = typeof closed === "string" ? await getShiftById(profile.tenant_id, closed) : null;
    return (
      <div className="space-y-6">
        {header}
        {justClosed?.status === "closed" &&
          justClosed.floatLeft !== null &&
          justClosed.depositAmount !== null && (
            <div className="max-w-xl space-y-1 rounded-2xl border border-success/30 bg-success/10 px-5 py-4">
              <p className="text-lg font-bold text-success">ปิดกะแล้ว ✓</p>
              <p className="text-base text-sidebar">
                นำไปฝากธนาคาร{" "}
                <span className="font-bold tabular-nums">{formatMoney(justClosed.depositAmount)}</span>{" "}
                · เก็บไว้ในลิ้นชัก{" "}
                <span className="font-bold tabular-nums">{formatMoney(justClosed.floatLeft)}</span>
              </p>
              {canSeeTotals && (
                <Link
                  href={`/shifts/${justClosed.id}`}
                  className="inline-block text-base font-medium text-accent hover:underline"
                >
                  ดูใบสรุปกะ
                </Link>
              )}
            </div>
          )}
        <OpenShiftCard />
      </div>
    );
  }

  const [movements, openHeld, counts, floatDefault] = await Promise.all([
    getCashMovements(profile.tenant_id, activeShift.id),
    getOpenHeldBills(profile.tenant_id),
    getCashCounts(profile.tenant_id, activeShift.id),
    getCashFloatDefault(profile.tenant_id),
  ]);
  const attempts = counts
    .filter((c) => c.stage === "closing" && c.expected !== null)
    .map((c) => ({ amount: c.amount, expected: c.expected as number, attempt: c.attempt }));

  // Totals are computed for everyone (the closing step needs them) but only sent to the client for
  // owner/manager. Staff receive the expected cash only for a count they have already made.
  const totals =
    canSeeTotals || attempts.length > 0
      ? await getShiftTotals(profile.tenant_id, activeShift.id)
      : null;

  const latest = attempts.at(-1);
  const initialStep: ClosingStartStep =
    latest && totals ? closingStep(attempts, totals.expectedCash) : "idle";
  const lastResult: ClosingResult | null = latest
    ? {
        attempt: latest.attempt,
        counted: latest.amount,
        expected: latest.expected,
        difference: compareCount(latest.amount, latest.expected),
      }
    : null;

  const names = await getPeopleNames(profile.tenant_id, [
    activeShift.openedBy,
    ...movements.map((m) => m.createdBy),
  ]);

  return (
    <div className="space-y-6">
      {header}
      <p className="text-lg font-semibold text-sidebar">
        เปิดกะโดย {names[activeShift.openedBy] ?? "—"} · {formatTime(activeShift.openedAt)}
      </p>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
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
          {canSeeTotals && totals && <ShiftSummaryCard totals={totals} />}
          <CloseShiftFlow
            shiftId={activeShift.id}
            initialStep={initialStep}
            lastResult={lastResult}
            floatDefault={floatDefault}
            personalOutstanding={personalOutstanding(movements)}
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
