"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { openShift, closeShift } from "@/app/actions/shifts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Shift, ShiftSummary } from "@/lib/dal";

type Props = {
  activeShift: Shift | null;
  summary: ShiftSummary | null;
};

export function ShiftPanel({ activeShift, summary }: Props) {
  const router = useRouter();
  const [openingCash, setOpeningCash] = useState("0");
  const [closingCash, setClosingCash] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ variance: number } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpen() {
    setError(null);
    startTransition(async () => {
      const res = await openShift(Number(openingCash));
      if ("error" in res) {
        setError(res.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleClose() {
    if (!activeShift) return;
    setError(null);
    startTransition(async () => {
      const res = await closeShift(activeShift.id, Number(closingCash));
      if ("error" in res) {
        setError(res.error);
      } else {
        setResult(res);
        router.refresh();
      }
    });
  }

  if (!activeShift) {
    return (
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-sidebar">เปิดกะใหม่</h2>
        {result && (
          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium text-sidebar">
              ปิดกะล่าสุด — ส่วนต่าง:{" "}
              <span
                className={
                  result.variance >= 0 ? "text-green-600" : "text-destructive"
                }
              >
                {result.variance > 0 ? "+" : ""}
                {result.variance.toFixed(2)} บาท
              </span>
            </p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="opening-cash">เงินสดตั้งต้น (บาท)</Label>
          <Input
            id="opening-cash"
            type="number"
            step="0.01"
            min="0"
            value={openingCash}
            onChange={(e) => setOpeningCash(e.target.value)}
          />
        </div>
        {error && (
          <p className="text-sm font-medium text-destructive">{error}</p>
        )}
        <Button
          type="button"
          onClick={handleOpen}
          disabled={isPending}
          className="bg-accent hover:bg-accent/90 text-white"
        >
          {isPending ? "กำลังเปิดกะ…" : "เปิดกะ"}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-5 space-y-4">
      <h2 className="text-base font-semibold text-sidebar">กะปัจจุบัน — เปิดอยู่</h2>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-md bg-muted p-3">
          <p className="text-xs text-muted-foreground">เงินสด</p>
          <p className="font-semibold text-sidebar tabular-nums">
            ฿{summary?.totalCash.toFixed(2) ?? "0.00"}
          </p>
        </div>
        <div className="rounded-md bg-muted p-3">
          <p className="text-xs text-muted-foreground">โอน</p>
          <p className="font-semibold text-sidebar tabular-nums">
            ฿{summary?.totalTransfer.toFixed(2) ?? "0.00"}
          </p>
        </div>
        <div className="rounded-md bg-muted p-3">
          <p className="text-xs text-muted-foreground">บัตร</p>
          <p className="font-semibold text-sidebar tabular-nums">
            ฿{summary?.totalCard.toFixed(2) ?? "0.00"}
          </p>
        </div>
        <div className="rounded-md bg-muted p-3">
          <p className="text-xs text-muted-foreground">จำนวนออเดอร์</p>
          <p className="font-semibold text-sidebar tabular-nums">
            {summary?.orderCount ?? 0}
          </p>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        เงินสดที่ควรมีในลิ้นชัก:{" "}
        <span className="font-semibold text-sidebar">
          ฿{summary?.expectedCash.toFixed(2) ?? "0.00"}
        </span>
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="closing-cash">เงินสดที่นับได้จริง (บาท)</Label>
        <Input
          id="closing-cash"
          type="number"
          step="0.01"
          min="0"
          value={closingCash}
          onChange={(e) => setClosingCash(e.target.value)}
        />
      </div>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      <Button
        type="button"
        onClick={handleClose}
        disabled={isPending}
        className="bg-accent hover:bg-accent/90 text-white"
      >
        {isPending ? "กำลังปิดกะ…" : "ปิดกะ"}
      </Button>
    </div>
  );
}
