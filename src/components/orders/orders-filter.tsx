"use client";
import { useRouter, useSearchParams } from "next/navigation";

type FilterValue = "all" | "cash" | "transfer" | "card" | "cancelled";

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "cash", label: "เงินสด" },
  { value: "transfer", label: "โอน" },
  { value: "card", label: "บัตร" },
  { value: "cancelled", label: "ยกเลิก" },
];

export function OrdersFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = (searchParams.get("filter") ?? "all") as FilterValue;

  function setFilter(value: FilterValue) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("filter");
    } else {
      params.set("filter", value);
    }
    router.push(`/orders?${params.toString()}`);
  }

  return (
    <div className="flex gap-2 flex-wrap">
      {FILTERS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => setFilter(value)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
            current === value
              ? "border-accent bg-accent text-white"
              : "border-input text-muted-foreground hover:border-accent hover:text-accent"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
