import type { NextRequest } from "next/server";
import { getProfile, getClosedShiftsInMonth, getPeopleNames } from "@/lib/dal";
import { bangkokMonthRange } from "@/lib/bangkok-time";
import { buildShiftCsv } from "@/lib/shift-csv";

/** GET /shifts/export?month=YYYY-MM — closed shifts of one Bangkok month as CSV (owner/manager). */
export async function GET(request: NextRequest) {
  const profile = await getProfile();
  if (!profile || (profile.role !== "owner" && profile.role !== "manager")) {
    return new Response("Forbidden", { status: 403 });
  }

  const month = request.nextUrl.searchParams.get("month") ?? "";
  if (!bangkokMonthRange(month)) {
    return new Response("Bad month", { status: 400 });
  }

  const shifts = await getClosedShiftsInMonth(profile.tenant_id, month);
  const names = await getPeopleNames(
    profile.tenant_id,
    shifts.flatMap((s) => [s.openedBy, ...(s.closedBy ? [s.closedBy] : [])])
  );

  const csv = buildShiftCsv(
    shifts.map((s) => ({
      openedAt: s.openedAt,
      openedBy: names[s.openedBy] ?? "",
      closedAt: s.closedAt,
      closedBy: s.closedBy ? (names[s.closedBy] ?? "") : "",
      lastNightFloat: s.openingExpected,
      openingCount: s.openingCash,
      overnightDifference: s.openingDifference,
      cashSales: s.closingCashSales,
      transferSales: s.closingTransferSales,
      cashRefunds: s.closingCashRefunds,
      cashIn: s.closingCashIn,
      cashOut: s.closingCashOut,
      expected: s.expectedCash,
      closingCount: s.closingCashCounted,
      variance: s.variance,
      floatLeft: s.floatLeft,
      deposit: s.depositAmount,
      note: [s.openingNote, s.closingNote].filter(Boolean).join(" / "),
    }))
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="shifts-${month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
