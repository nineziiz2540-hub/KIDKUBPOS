import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile, getShiftHistory, getPeopleNames } from "@/lib/dal";
import { bangkokMonth, formatDate, formatTime } from "@/lib/bangkok-time";
import { compareCount, differenceLabel, formatMoney } from "@/lib/shift-math";

type Props = {
  searchParams: Promise<{ before?: string }>;
};

function varianceClass(kind: string): string {
  if (kind === "short") return "text-destructive";
  if (kind === "over") return "text-warning";
  return "text-success";
}

/** Owner/manager: every shift newest first, 30 per page, with the monthly CSV export. */
export default async function ShiftHistoryPage({ searchParams }: Props) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/shifts");

  const { before } = await searchParams;
  const validBefore = typeof before === "string" && !Number.isNaN(Date.parse(before)) ? before : undefined;
  const { rows, nextBefore } = await getShiftHistory(profile.tenant_id, validBefore);
  const names = await getPeopleNames(
    profile.tenant_id,
    rows.flatMap((s) => [s.openedBy, ...(s.closedBy ? [s.closedBy] : [])])
  );

  // The months that have shifts on this page, newest first, for the export buttons.
  const months = [...new Set(rows.map((s) => bangkokMonth(s.openedAt)))];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold leading-tight text-sidebar">ประวัติกะ</h1>
          <p className="mt-0.5 text-base text-muted-foreground">
            ทุกกะ ใครเปิด/ปิด ขาดหรือเกินเท่าไร
          </p>
        </div>
        <Link
          href="/shifts"
          className="flex h-12 items-center rounded-xl border border-input bg-white px-4 text-base font-semibold text-sidebar hover:bg-muted"
        >
          กลับหน้าจัดการกะ
        </Link>
      </div>

      {months.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base text-muted-foreground">ส่งออกไฟล์ Excel (CSV):</span>
          {months.map((m) => (
            <a
              key={m}
              href={`/shifts/export?month=${m}`}
              className="flex h-12 items-center rounded-xl border border-input bg-white px-4 text-base font-medium text-sidebar hover:bg-muted"
            >
              {formatDate(`${m}-15T05:00:00Z`, "long").replace(/^\d+\s/, "")}
            </a>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border bg-white px-4 py-12 text-center text-base text-muted-foreground">
          ยังไม่มีกะ
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border bg-white">
          {rows.map((s) => {
            const variance =
              s.closingCashCounted !== null && s.expectedCash !== null
                ? compareCount(s.closingCashCounted, s.expectedCash)
                : null;
            const overnight =
              s.openingExpected !== null ? compareCount(s.openingCash, s.openingExpected) : null;
            return (
              <li key={s.id}>
                <Link
                  href={`/shifts/${s.id}`}
                  className="flex min-h-16 items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-sidebar">
                      {formatDate(s.openedAt, "full")}
                    </p>
                    <p className="truncate text-[15px] text-muted-foreground">
                      เปิด {formatTime(s.openedAt)} {names[s.openedBy] ?? "—"}
                      {s.closedAt && ` · ปิด ${formatTime(s.closedAt)} ${s.closedBy ? (names[s.closedBy] ?? "—") : ""}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {s.status === "open" ? (
                      <span className="rounded-full bg-accent/10 px-3 py-1 text-[15px] font-semibold text-accent">
                        เปิดอยู่
                      </span>
                    ) : (
                      <>
                        {s.closingCashSales !== null && (
                          <p className="text-[15px] tabular-nums text-muted-foreground">
                            ขายเงินสด {formatMoney(s.closingCashSales)}
                          </p>
                        )}
                        {variance && (
                          <p className={`text-base font-bold tabular-nums ${varianceClass(variance.kind)}`}>
                            {differenceLabel(variance)}
                          </p>
                        )}
                      </>
                    )}
                    {overnight && overnight.kind !== "match" && (
                      <p className={`text-[15px] font-semibold ${varianceClass(overnight.kind)}`}>
                        ข้ามคืน {differenceLabel(overnight)}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {nextBefore && (
        <p className="text-center">
          <Link
            href={`/shifts/history?before=${encodeURIComponent(nextBefore)}`}
            className="text-base font-medium text-accent hover:underline"
          >
            ดูเพิ่ม
          </Link>
        </p>
      )}
    </div>
  );
}
