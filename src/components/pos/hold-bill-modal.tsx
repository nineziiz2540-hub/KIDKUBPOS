"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/cash";

const MAX_LABEL = 40;

type Props = {
  total: number;
  itemCount: number;
  pending: boolean;
  error: string | null;
  onConfirm: (customerLabel: string) => void;
  onCancel: () => void;
};

/** Parks the current cart. The queue number is assigned by the server; the name is optional. */
export function HoldBillModal({ total, itemCount, pending, error, onConfirm, onCancel }: Props) {
  const [label, setLabel] = useState("");
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onCancel();
      }}
    >
      <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-4">
        <div className="text-center">
          <h2 className="text-lg font-bold text-sidebar">พักบิล</h2>
          <p className="text-base text-muted-foreground tabular-nums">
            {itemCount} ชิ้น · ฿{formatPrice(total)}
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="hold-label" className="text-base font-medium text-sidebar">
            ชื่อลูกค้า <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
          </label>
          <input
            id="hold-label"
            type="text"
            value={label}
            maxLength={MAX_LABEL}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !pending) onConfirm(label);
            }}
            placeholder="เช่น พี่ส้ม, LINE คุณเมย์"
            className="w-full h-12 rounded-lg border border-input px-3 text-base"
          />
          <p className="text-sm text-muted-foreground">ระบบจะให้เลขคิวอัตโนมัติ</p>
        </div>
        {error && <p className="text-sm text-destructive font-medium text-center">{error}</p>}
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="flex-1 h-12 bg-white border border-input text-sidebar text-base hover:bg-muted"
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            onClick={() => onConfirm(label)}
            disabled={pending}
            className="flex-1 h-12 bg-accent hover:bg-accent/90 text-white text-base font-semibold"
          >
            {pending ? "กำลังพักบิล…" : "พักบิล"}
          </Button>
        </div>
      </div>
    </div>
  );
}
