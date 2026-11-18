"use client";
import { isMadeComplete, type MadeMode, type VoidItem } from "@/lib/void-made";

export type MadeChoice = MadeMode | null;

type Props = {
  value: MadeChoice;
  onChange: (mode: MadeMode) => void;
  /** Offered only when the bill has more than one cup (the caller passes items then). */
  partial?: {
    items: (VoidItem & { name: string })[];
    counts: Record<string, number>;
    onCount: (id: string, count: number) => void;
  };
};

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`h-14 flex-1 rounded-xl border px-4 text-lg font-semibold transition-colors ${
        selected ? "border-accent bg-accent text-white" : "border-input bg-white text-sidebar hover:border-accent"
      }`}
    >
      {selected ? `✓ ${children}` : children}
    </button>
  );
}

/** "เครื่องดื่มชงไปแล้วหรือยัง?": no default, the caller keeps its confirm disabled until one is chosen. */
export function MadeQuestion({ value, onChange, partial }: Props) {
  return (
    <div className="space-y-2">
      <p className="text-base font-semibold text-sidebar text-center">เครื่องดื่มชงไปแล้วหรือยัง?</p>
      <div className="flex gap-2">
        <Chip selected={value === "none"} onClick={() => onChange("none")}>ยังไม่ชง</Chip>
        <Chip selected={value === "all"} onClick={() => onChange("all")}>ชงแล้ว</Chip>
      </div>
      {partial && (
        <button
          type="button"
          aria-pressed={value === "some"}
          onClick={() => onChange("some")}
          className={`h-14 w-full rounded-xl border px-4 text-base font-medium transition-colors ${
            value === "some" ? "border-accent bg-accent text-white" : "border-input bg-white text-sidebar hover:border-accent"
          }`}
        >
          {value === "some" ? "✓ ชงแล้วบางแก้ว" : "ชงแล้วบางแก้ว"}
        </button>
      )}
      {partial && value === "some" && (
        <ul className="space-y-2">
          {partial.items.map((item) => {
            const count = partial.counts[item.id] ?? 0;
            return (
              <li key={item.id} className="flex items-center gap-2 rounded-xl border border-input p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-sidebar">{item.name}</p>
                  <p className="text-sm text-muted-foreground">ชงแล้ว {count} จาก {item.quantity} แก้ว</p>
                </div>
                <button
                  type="button"
                  aria-label={`ลดจำนวนแก้วที่ชงแล้ว ${item.name}`}
                  disabled={count <= 0}
                  onClick={() => partial.onCount(item.id, count - 1)}
                  className="h-14 w-14 rounded-xl border border-input bg-white text-2xl font-semibold text-sidebar disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-8 text-center text-xl font-semibold tabular-nums">{count}</span>
                <button
                  type="button"
                  aria-label={`เพิ่มจำนวนแก้วที่ชงแล้ว ${item.name}`}
                  disabled={count >= item.quantity}
                  onClick={() => partial.onCount(item.id, count + 1)}
                  className="h-14 w-14 rounded-xl border border-input bg-white text-2xl font-semibold text-sidebar disabled:opacity-40"
                >
                  +
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {partial && value === "some" && !isMadeComplete(value, partial.counts, partial.items) && (
        <p className="text-sm text-muted-foreground text-center">เลือกจำนวนแก้วที่ชงแล้วอย่างน้อย 1 แก้ว</p>
      )}
    </div>
  );
}
