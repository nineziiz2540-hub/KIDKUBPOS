import Link from "next/link";
import { historyHref, type HistoryFilter } from "@/lib/order-history";

const CHIPS: { value: HistoryFilter; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "cash", label: "เงินสด" },
  { value: "transfer", label: "โอน" },
  { value: "reversed", label: "ยกเลิก / คืนเงิน" },
  { value: "unpaid", label: "ไม่ได้รับเงิน" },
];

type Props = {
  date: string;
  today: string;
  filter: HistoryFilter;
  q: string;
  counts: Record<HistoryFilter, number>;
};

export function HistoryChips({ date, today, filter, q, counts }: Props) {
  return (
    <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="กรองบิล">
      {CHIPS.map(({ value, label }) => {
        const selected = value === filter;
        return (
          <Link
            key={value}
            href={historyHref({ date, filter: value, q }, today)}
            aria-current={selected ? "page" : undefined}
            className={`inline-flex h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-4 text-base font-semibold transition-colors ${
              selected
                ? "bg-accent text-white"
                : "border border-border bg-white text-muted-foreground hover:border-accent hover:text-accent"
            }`}
          >
            {label}
            <span className={selected ? "text-white/80" : "text-muted-foreground/70"}>
              ({counts[value]})
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
