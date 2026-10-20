"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { shiftDate } from "@/lib/bangkok-time";
import { historyHref, type HistoryFilter } from "@/lib/order-history";

type Props = {
  date: string;
  today: string;
  filter: HistoryFilter;
  q: string;
  label: string;
};

const STEP =
  "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-input bg-white text-sidebar hover:bg-muted";

export function DayNav({ date, today, filter, q, label }: Props) {
  const router = useRouter();
  const prevHref = historyHref({ date: shiftDate(date, -1), filter, q }, today);
  const isToday = date >= today;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={prevHref} className={STEP} aria-label="วันก่อนหน้า">
        <ChevronLeft size={22} />
      </Link>
      <p className="min-w-0 px-2 text-xl font-semibold text-sidebar">{label}</p>
      {isToday ? (
        <span className={`${STEP} opacity-40`} aria-disabled="true" aria-label="วันถัดไป">
          <ChevronRight size={22} />
        </span>
      ) : (
        <Link
          href={historyHref({ date: shiftDate(date, 1), filter, q }, today)}
          className={STEP}
          aria-label="วันถัดไป"
        >
          <ChevronRight size={22} />
        </Link>
      )}
      <label className="relative inline-flex h-12 items-center gap-2 rounded-xl border border-input bg-white pl-3 pr-2 text-base text-sidebar">
        <CalendarDays size={20} className="text-muted-foreground" />
        <span className="sr-only">เลือกวัน</span>
        <input
          id="history-date"
          type="date"
          value={date}
          max={today}
          onChange={(e) => {
            const next = e.target.value;
            if (next) router.push(historyHref({ date: next, filter, q }, today));
          }}
          className="h-10 bg-transparent text-base text-sidebar focus-visible:outline-none"
        />
      </label>
    </div>
  );
}
