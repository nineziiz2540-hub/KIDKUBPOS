"use client";

type Props = {
  userName: string;
  todayOrderCount: number;
};

export function PosHeader({ userName, todayOrderCount }: Props) {
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
      <div className="text-right text-sm">
        <p className="font-medium text-sidebar">{userName}</p>
        <p className="text-xs text-muted-foreground">
          ออเดอร์วันนี้{" "}
          <span className="font-semibold text-sidebar">{todayOrderCount}</span>{" "}
          รายการ
        </p>
      </div>
    </div>
  );
}
