"use client";
import Link from "next/link";
import { ChevronRight, ClipboardList, Package } from "lucide-react";
import { formatDate } from "@/lib/bangkok-time";

type Props = {
  userName: string;
  todayOrderCount: number;
  hasActiveShift: boolean;
  heldCount: number;
  onOpenHeld: () => void;
  /** Opens the "สต๊อก" panel (waste, close/open menus). */
  onOpenStock: () => void;
  /** Why the shift link can't be used now (offline or bills still waiting); null = usable. */
  shiftDisabledReason: string | null;
  /** Why the order-history link can't be used now (offline); null = usable. */
  ordersDisabledReason: string | null;
};

export function PosHeader({
  userName,
  todayOrderCount,
  hasActiveShift,
  heldCount,
  onOpenHeld,
  onOpenStock,
  shiftDisabledReason,
  ordersDisabledReason,
}: Props) {
  const dateStr = formatDate(new Date().toISOString(), "full");

  return (
    <div className="flex items-center justify-between py-1 shrink-0">
      <div>
        <h1 className="text-xl font-bold text-sidebar">POS</h1>
        <p className="text-xs text-muted-foreground mt-0.5">{dateStr}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenHeld}
          className={`flex items-center gap-2 h-11 px-4 rounded-lg border-2 text-base font-semibold transition-colors ${
            heldCount > 0
              ? "border-accent bg-accent/10 text-accent hover:bg-accent/20"
              : "border-input bg-white text-sidebar hover:bg-muted"
          }`}
        >
          <ClipboardList size={20} />
          บิลพัก
          {heldCount > 0 && (
            <span className="min-w-6 h-6 px-1.5 rounded-full bg-accent text-white text-sm font-bold flex items-center justify-center tabular-nums">
              {heldCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onOpenStock}
          aria-label="สต๊อก"
          className="flex items-center justify-center gap-2 h-11 min-w-11 px-2.5 sm:px-4 rounded-lg border-2 border-input bg-white text-base font-semibold text-sidebar hover:bg-muted transition-colors"
        >
          <Package size={20} />
          <span className="hidden sm:inline">สต๊อก</span>
        </button>
        {shiftDisabledReason === null ? (
          <Link
            href="/shifts"
            className={
              "text-sm font-semibold px-3 py-1.5 rounded-full transition-colors " +
              (hasActiveShift
                ? "bg-success/10 text-success hover:bg-success/20"
                : "bg-destructive/10 text-destructive hover:bg-destructive/20")
            }
          >
            {hasActiveShift ? "กะเปิดอยู่" : "ยังไม่เปิดกะ"}
          </Link>
        ) : (
          // Opening/closing a shift needs the server: shown greyed, with why, instead of a link.
          <div className="flex flex-col items-center gap-0.5" aria-disabled="true">
            <span className="text-sm font-semibold px-3 py-1.5 rounded-full bg-muted text-muted-foreground">
              {hasActiveShift ? "กะเปิดอยู่" : "ยังไม่เปิดกะ"}
            </span>
            <span className="text-xs text-muted-foreground">{shiftDisabledReason}</span>
          </div>
        )}
        {ordersDisabledReason === null ? (
          // Opens ประวัติบิล: the way back to a past bill (and its "QR ใบเสร็จ") once the cart has
          // moved on to the next customer. The whole block is the target, as tall as the buttons.
          <Link
            href="/orders"
            aria-label={`ออเดอร์วันนี้ ${todayOrderCount} รายการ ดูประวัติบิล`}
            className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-right text-sm transition-colors hover:bg-muted"
          >
            <span>
              <span className="block font-medium text-sidebar">{userName}</span>
              <span className="block text-xs font-semibold text-accent">
                ออเดอร์วันนี้ <span className="tabular-nums">{todayOrderCount}</span> รายการ
              </span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-accent" aria-hidden="true" />
          </Link>
        ) : (
          // Order history needs the server: offline it stays a plain label, as before.
          <div className="text-right text-sm">
            <p className="font-medium text-sidebar">{userName}</p>
            <p className="text-xs text-muted-foreground">
              ออเดอร์วันนี้{" "}
              <span className="font-semibold text-sidebar">{todayOrderCount}</span>{" "}
              รายการ
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
