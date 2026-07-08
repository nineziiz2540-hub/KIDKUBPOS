"use client";
import Link from "next/link";

type Props = {
  userName: string;
  todayOrderCount: number;
  hasActiveShift: boolean;
};

export function PosHeader({ userName, todayOrderCount, hasActiveShift }: Props) {
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
        <Link
          href="/shifts"
          className={
            "text-xs font-medium px-2.5 py-1 rounded-full transition-colors " +
            (hasActiveShift
              ? "bg-green-100 text-green-700 hover:bg-green-200"
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
