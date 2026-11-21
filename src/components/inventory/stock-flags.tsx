"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToastManager } from "@/components/ui/toast";
import { resolveStockFlag, setMenuPaused } from "@/app/actions/stock-pos";
import { flagText, type FlagNames } from "@/lib/stock/flag-text";
import { settlePauseCall } from "@/lib/stock/pos-states";
import { formatDateTime } from "@/lib/bangkok-time";

export type FlagItem = {
  id: string;
  kind: string;
  created_at: string;
  order_id: string | null;
  names: FlagNames;
};

export type PausedItem = { id: string; name: string; paused_at: string | null; pausedByName: string | null };

const NO_ANSWER = "ไม่มีสัญญาณหรือช้าเกินไป ลองใหม่อีกครั้ง";

function FlagRow({ flag }: { flag: FlagItem }) {
  const toast = useToastManager();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const { text, hint } = flagText(flag, flag.names);

  async function resolve() {
    setPending(true);
    try {
      const res = await resolveStockFlag(flag.id);
      if (res.error) {
        toast.add({ title: res.error, type: "error" });
        return;
      }
      toast.add({ title: "ตรวจแล้ว", type: "success" });
      router.refresh();
    } catch {
      toast.add({ title: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง", type: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm font-medium text-sidebar">{text}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        {flag.kind === "stock_skipped" && flag.order_id && (
          <Link
            href={`/orders/${flag.order_id}`}
            className="mt-1 inline-flex min-h-12 items-center text-sm font-semibold text-accent underline"
          >
            ดูบิล
          </Link>
        )}
      </div>
      <Button type="button" variant="outline" disabled={pending} onClick={resolve} className="h-14 px-5 text-base font-semibold">
        {pending ? "กำลังบันทึก…" : "ตรวจแล้ว"}
      </Button>
    </div>
  );
}

function PausedRow({ menu }: { menu: PausedItem }) {
  const toast = useToastManager();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const since = menu.paused_at ? formatDateTime(menu.paused_at) : null;

  async function reopen() {
    setPending(true);
    try {
      const res = await settlePauseCall(setMenuPaused(menu.id, false));
      if ("offline" in res) {
        toast.add({ title: NO_ANSWER, type: "error" });
        return;
      }
      if ("error" in res) {
        toast.add({ title: res.error, type: "error" });
        return;
      }
      toast.add({ title: `เปิดขาย: ${menu.name}`, type: "success" });
      router.refresh();
    } catch {
      toast.add({ title: "เปิดขายไม่สำเร็จ ลองใหม่อีกครั้ง", type: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm font-medium text-sidebar">{menu.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          ปิดขายโดย {menu.pausedByName || "-"}
          {since ? ` · ตั้งแต่ ${since}` : ""}
        </p>
      </div>
      <Button type="button" variant="outline" disabled={pending} onClick={reopen} className="h-14 px-5 text-base font-semibold">
        {pending ? "กำลังเปิดขาย…" : "เปิดขาย"}
      </Button>
    </div>
  );
}

/** Owner/manager view above the materials list: "ยอดน่าจะผิด" flags and "ปิดขายอยู่" menus, each only when non-empty. */
export function StockFlags({ flags, paused }: { flags: FlagItem[]; paused: PausedItem[] }) {
  if (flags.length === 0 && paused.length === 0) return null;
  return (
    <div className="space-y-5">
      {flags.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-sidebar">ยอดน่าจะผิด ({flags.length})</h2>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-warning bg-white">
            {flags.map((f) => (
              <FlagRow key={f.id} flag={f} />
            ))}
          </div>
        </section>
      )}
      {paused.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-sidebar">ปิดขายอยู่ ({paused.length})</h2>
          <div className="divide-y divide-border overflow-hidden rounded-lg border bg-white">
            {paused.map((m) => (
              <PausedRow key={m.id} menu={m} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
