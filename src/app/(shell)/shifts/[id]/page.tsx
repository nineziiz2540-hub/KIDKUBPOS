import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getProfile,
  getShiftById,
  getShiftTotals,
  getCashCounts,
  getCashMovements,
  getPeopleNames,
} from "@/lib/dal";
import { formatDate, formatDateTime, formatTime } from "@/lib/bangkok-time";
import {
  MOVEMENT_REASONS,
  compareCount,
  differenceLabel,
  formatMoney,
  type MovementReason,
} from "@/lib/shift-math";

type Props = {
  params: Promise<{ id: string }>;
};

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-base">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`tabular-nums text-sidebar ${strong ? "text-lg font-bold" : "font-semibold"}`}>
        {value}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border bg-white p-5">
      <h2 className="text-lg font-bold text-sidebar">{title}</h2>
      {children}
    </section>
  );
}

function differenceClass(kind: string): string {
  if (kind === "short") return "text-destructive";
  if (kind === "over") return "text-warning";
  return "text-success";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ใบสรุปกะ — owner/manager only. Closed shifts read their close-time snapshot. */
export default async function ShiftSummaryPage({ params }: Props) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner" && profile.role !== "manager") redirect("/shifts");

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const shift = await getShiftById(profile.tenant_id, id);
  if (!shift) notFound();

  const [counts, movements, previous] = await Promise.all([
    getCashCounts(profile.tenant_id, shift.id),
    getCashMovements(profile.tenant_id, shift.id),
    shift.previousShiftId ? getShiftById(profile.tenant_id, shift.previousShiftId) : null,
  ]);
  const live = shift.status === "open" ? await getShiftTotals(profile.tenant_id, shift.id) : null;
  const totals = live
    ? {
        cashSales: live.cashSales,
        transferSales: live.transferSales,
        cashRefunds: live.cashRefunds,
        orderCount: live.orderCount,
        cashIn: live.cashIn,
        cashOut: live.cashOut,
        expected: live.expectedCash,
      }
    : {
        cashSales: shift.closingCashSales,
        transferSales: shift.closingTransferSales,
        cashRefunds: shift.closingCashRefunds,
        orderCount: shift.closingOrderCount,
        cashIn: shift.closingCashIn,
        cashOut: shift.closingCashOut,
        expected: shift.expectedCash,
      };

  const names = await getPeopleNames(profile.tenant_id, [
    shift.openedBy,
    ...(shift.closedBy ? [shift.closedBy] : []),
    ...(previous?.closedBy ? [previous.closedBy] : []),
    ...movements.map((m) => m.createdBy),
  ]);
  const name = (personId: string | null) => (personId ? (names[personId] ?? "—") : "—");
  const money = (n: number | null) => (n === null ? "—" : formatMoney(n));

  const openingCounts = counts.filter((c) => c.stage === "opening");
  const closingCounts = counts.filter((c) => c.stage === "closing");
  const overnight =
    shift.openingExpected !== null ? compareCount(shift.openingCash, shift.openingExpected) : null;
  const variance =
    shift.closingCashCounted !== null && shift.expectedCash !== null
      ? compareCount(shift.closingCashCounted, shift.expectedCash)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold leading-tight text-sidebar">ใบสรุปกะ</h1>
          <p className="mt-0.5 text-base text-muted-foreground">{formatDate(shift.openedAt, "full")}</p>
        </div>
        <Link
          href="/shifts/history"
          className="flex h-12 items-center rounded-xl border border-input bg-white px-4 text-base font-semibold text-sidebar hover:bg-muted"
        >
          กลับประวัติกะ
        </Link>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Section title="เปิดกะ">
            <dl className="space-y-1.5">
              <Line label="เปิดโดย" value={`${name(shift.openedBy)} · ${formatTime(shift.openedAt)}`} />
              {shift.openingExpected !== null && (
                <Line label="เงินทอนเมื่อคืน" value={money(shift.openingExpected)} />
              )}
              <Line
                label={openingCounts.length > 1 ? `นับ ${openingCounts.length} ครั้ง` : "นับได้"}
                value={
                  openingCounts.length > 0
                    ? openingCounts.map((c) => formatMoney(c.amount)).join(" / ")
                    : money(shift.openingCash)
                }
              />
              <Line label="เงินตั้งต้น" value={money(shift.openingCash)} strong />
            </dl>
            {overnight && overnight.kind !== "match" && (
              <p className={`rounded-xl bg-muted px-4 py-3 text-base font-semibold ${differenceClass(overnight.kind)}`}>
                ข้ามคืน {differenceLabel(overnight)} · ผู้รับผิดชอบ: {name(previous?.closedBy ?? null)} (ปิดเมื่อคืน)
                และ {name(shift.openedBy)} (เปิดเช้านี้)
              </p>
            )}
            {shift.openingNote && <p className="text-base text-sidebar">หมายเหตุ: {shift.openingNote}</p>}
          </Section>

          <Section title="ระหว่างกะ">
            <dl className="space-y-1.5">
              <Line label="ขายเงินสด" value={money(totals.cashSales)} />
              <Line label="ขายโอน" value={money(totals.transferSales)} />
              <Line label="คืนเงินสด" value={money(totals.cashRefunds)} />
              <Line label="จำนวนบิล" value={totals.orderCount === null ? "—" : String(totals.orderCount)} />
              <Line label="เงินเข้าลิ้นชัก" value={money(totals.cashIn)} />
              <Line label="เงินออกลิ้นชัก" value={money(totals.cashOut)} />
            </dl>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title={shift.status === "open" ? "ยังไม่ปิดกะ" : "ปิดกะ"}>
            <dl className="space-y-1.5">
              {shift.closedAt && (
                <Line
                  label="ปิดโดย"
                  value={`${name(shift.closedBy)} · ${formatDateTime(shift.closedAt)}`}
                />
              )}
              <Line label="ควรมี" value={money(totals.expected)} />
              {closingCounts.length > 0 && (
                <Line
                  label={closingCounts.length > 1 ? `นับ ${closingCounts.length} ครั้ง` : "นับได้"}
                  value={closingCounts.map((c) => formatMoney(c.amount)).join(" / ")}
                />
              )}
              {shift.closingCashCounted !== null && (
                <Line label="ยอดที่ใช้" value={money(shift.closingCashCounted)} />
              )}
            </dl>
            {variance && (
              <p className={`text-xl font-bold ${differenceClass(variance.kind)}`}>
                ส่วนต่าง: {differenceLabel(variance)}
              </p>
            )}
            {shift.status === "closed" && (
              <p className="text-base text-muted-foreground">
                ผู้รับผิดชอบ: {name(shift.openedBy)} (เปิดกะ)
                {shift.closedBy && shift.closedBy !== shift.openedBy
                  ? ` · ปิดกะโดย ${name(shift.closedBy)}`
                  : ""}
              </p>
            )}
            {shift.floatLeft !== null && (
              <dl className="space-y-1.5 border-t pt-3">
                <Line label="เก็บไว้ในลิ้นชัก" value={money(shift.floatLeft)} />
                <Line label="นำไปฝากธนาคาร" value={money(shift.depositAmount)} strong />
              </dl>
            )}
            {shift.closingNote && <p className="text-base text-sidebar">หมายเหตุ: {shift.closingNote}</p>}
          </Section>

          <Section title="เงินเข้า-ออกลิ้นชัก">
            {movements.length === 0 ? (
              <p className="text-base text-muted-foreground">ไม่มีรายการ</p>
            ) : (
              <ul className="divide-y divide-border">
                {movements.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-base text-sidebar">
                        <span className="tabular-nums">{formatTime(m.createdAt)}</span> ·{" "}
                        {Object.hasOwn(MOVEMENT_REASONS, m.reason)
                          ? MOVEMENT_REASONS[m.reason as MovementReason].label
                          : m.reason}
                      </p>
                      <p className="truncate text-[15px] text-muted-foreground">
                        {m.note ? `${m.note} · ` : ""}โดย {name(m.createdBy)}
                      </p>
                    </div>
                    <p
                      className={`shrink-0 text-base font-bold tabular-nums ${
                        m.direction === "in" ? "text-success" : "text-destructive"
                      }`}
                    >
                      {m.direction === "in" ? "+" : "−"}
                      {formatMoney(m.amount)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
