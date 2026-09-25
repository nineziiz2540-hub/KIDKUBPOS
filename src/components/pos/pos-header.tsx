"use client";
import Link from "next/link";
import { ClipboardList } from "lucide-react";

type Props = {
  userName: string;
  todayOrderCount: number;
  hasActiveShift: boolean;
  heldCount: number;
  onOpenHeld: () => void;
};

export function PosHeader({
  userName,
  todayOrderCount,
  hasActiveShift,
  heldCount,
  onOpenHeld,
}: Props) {
  const dateStr = new Date().toLocaleDateString("th-TH", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

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
        <div className="text-right text-sm">
          <p className="font-medium text-sidebar">{userName}</p>
          <p className="text-xs text-muted-foreground">
            ออเดอร์วันนี้{" "}
            <span className="font-semibold text-sidebar">{todayOrderCount}</span>{" "}
            รายการ
          </p>
        </div>
      </div>
    </div>
  );
}
