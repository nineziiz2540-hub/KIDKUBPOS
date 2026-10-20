import Form from "next/form";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { historyHref, type HistoryFilter } from "@/lib/order-history";

type Props = { date: string; today: string; filter: HistoryFilter; q: string };

export function HistorySearch({ date, today, filter, q }: Props) {
  return (
    <Form action="/orders" className="relative w-full max-w-sm">
      {date !== today && <input type="hidden" name="date" value={date} />}
      {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
      <Search
        size={20}
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <input
        id="history-search"
        name="q"
        type="search"
        inputMode="search"
        defaultValue={q}
        placeholder="พิมพ์เลขคิว หรือเลขบิล"
        aria-label="ค้นหาเลขคิวหรือเลขบิล"
        className="h-12 w-full rounded-xl border border-input bg-white pl-12 pr-12 text-[17px] text-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      />
      {q !== "" && (
        <Link
          href={historyHref({ date, filter, q: "" }, today)}
          aria-label="ล้างคำค้นหา"
          className="absolute right-1 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-sidebar"
        >
          <X size={20} />
        </Link>
      )}
    </Form>
  );
}
