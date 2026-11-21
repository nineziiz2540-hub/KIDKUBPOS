"use client";
// "ปิด/เปิดขายเมนู" (round D2a, Task 11): every menu on sale by category, one 56 px row each with its
// name and a switch ("ขายอยู่" / "ปิดขาย"); the switch saves at once. Menus already "ปิดขายอยู่" are listed
// first, as they were when the list opened (a row never jumps while it is tapped). The call is
// pos-screen's bounded pause call: no answer in time puts the switch back with a Thai toast, so a switch
// is never stuck.
import { useMemo, useState } from "react";
import { useToastManager } from "@/components/ui/toast";
import type { PauseResult } from "@/lib/stock/pos-states";
import type { PosProduct } from "@/types/app";
import { isPosOnline } from "@/lib/offline/status-store";
import { DisabledReason, OFFLINE_REASON } from "./disabled-reason";

type Props = {
  /** The live connection: offline the switches are faded and untappable (R-D2a, offline refused before calling). */
  online: boolean;
  products: PosProduct[];
  /** Menus that are paused now (the tiles' paused state). */
  pausedIds: Set<string>;
  /** Pauses or reopens; shows its own success toast and asks for fresh levels. */
  onChange: (product: PosProduct, paused: boolean) => Promise<PauseResult>;
};

const NO_CATEGORY = "ไม่มีหมวด";

export function PauseList({ online, products, pausedIds, onChange }: Props) {
  const toast = useToastManager();
  const [pausedAtOpen] = useState(() => new Set(pausedIds));
  // What a tapped switch shows until its answer comes: true = ปิดขาย.
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const first = products.filter((p) => pausedAtOpen.has(p.id));
    const byCat = new Map<string, PosProduct[]>();
    for (const p of products) {
      if (pausedAtOpen.has(p.id)) continue;
      const cat = p.categoryName ?? NO_CATEGORY;
      byCat.set(cat, [...(byCat.get(cat) ?? []), p]);
    }
    return [
      ...(first.length > 0 ? [{ title: "ปิดขายอยู่", items: first }] : []),
      ...[...byCat].map(([title, items]) => ({ title, items })),
    ];
  }, [products, pausedAtOpen]);

  async function flip(product: PosProduct, paused: boolean) {
    if (busy.has(product.id)) return;
    if (!isPosOnline()) {
      toast.add({ title: OFFLINE_REASON, type: "error" });
      return;
    }
    setBusy((b) => new Set(b).add(product.id));
    setShown((s) => ({ ...s, [product.id]: paused }));
    let res: PauseResult;
    try {
      res = await onChange(product, paused);
    } catch {
      res = { offline: true };
    }
    // Back to what the tiles say: on success that is the new state, on a failure the old one.
    setShown((s) => {
      const rest = { ...s };
      delete rest[product.id];
      return rest;
    });
    setBusy((b) => {
      const next = new Set(b);
      next.delete(product.id);
      return next;
    });
    if ("offline" in res) {
      toast.add({ title: `${paused ? "ปิดขาย" : "เปิดขาย"} ${product.name} ไม่สำเร็จ · เน็ตไม่ตอบ ลองใหม่อีกครั้ง`, type: "error" });
    } else if ("error" in res) {
      toast.add({ title: res.error, type: "error" });
    }
  }

  if (products.length === 0) {
    return <p className="rounded-lg bg-muted px-3 py-4 text-center text-base text-muted-foreground">ยังไม่มีเมนูที่ขายอยู่</p>;
  }
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
      {!online && <DisabledReason what={["ปิด/เปิดขายเมนู"]} reason={OFFLINE_REASON} />}
      {groups.map((g) => (
        <section key={g.title}>
          <h3 className="mb-1.5 text-base font-semibold text-muted-foreground">{g.title}</h3>
          <div className="space-y-2">
            {g.items.map((p) => {
              const paused = shown[p.id] ?? pausedIds.has(p.id);
              return (
                <div
                  key={p.id}
                  className="flex min-h-14 items-center justify-between gap-3 rounded-lg border-2 border-input bg-white px-4"
                >
                  <span className="min-w-0 break-words text-lg font-semibold text-sidebar">{p.name}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!paused}
                    aria-label={`${p.name}: ${paused ? "ปิดขาย" : "ขายอยู่"}`}
                    disabled={busy.has(p.id) || !online}
                    onClick={() => void flip(p, !paused)}
                    className="flex h-14 shrink-0 items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span className={`text-lg font-semibold ${paused ? "text-destructive" : "text-success"}`}>
                      {paused ? "ปิดขาย" : "ขายอยู่"}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`relative h-8 w-14 rounded-full transition-colors ${paused ? "bg-muted-foreground/40" : "bg-success"}`}
                    >
                      <span
                        className={`absolute top-1 size-6 rounded-full bg-white shadow transition-all ${paused ? "left-1" : "left-7"}`}
                      />
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
