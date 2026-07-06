"use client";
import { useActionState } from "react";
import Link from "next/link";
import type { InventoryState } from "@/app/actions/inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  action: (prevState: InventoryState, formData: FormData) => Promise<InventoryState>;
  rawMaterialId: string;
  type: "receive" | "adjust";
  materialName: string;
  currentStock: number;
  unit: string;
};

export function StockActionForm({ action, rawMaterialId, type, currentStock, unit }: Props) {
  const [state, formAction, pending] = useActionState<InventoryState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="space-y-4 max-w-lg">
      <input type="hidden" name="raw_material_id" value={rawMaterialId} />
      <p className="text-sm text-muted-foreground">
        สต็อกปัจจุบัน: <span className="font-semibold text-foreground">{currentStock} {unit}</span>
      </p>

      {type === "receive" ? (
        <div className="space-y-1.5">
          <Label htmlFor="sa-qty">จำนวนที่รับเพิ่ม ({unit})</Label>
          <Input
            id="sa-qty"
            name="quantity"
            type="number"
            step="0.001"
            min="0.001"
            placeholder="0"
            required
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="sa-new">สต็อกใหม่ ({unit})</Label>
          <Input
            id="sa-new"
            name="new_stock"
            type="number"
            step="0.001"
            min="0"
            defaultValue={currentStock}
            required
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="sa-note">หมายเหตุ (ไม่บังคับ)</Label>
        <Textarea id="sa-note" name="note" placeholder="เหตุผลที่ปรับสต็อก…" rows={2} />
      </div>

      {state?.error && (
        <p className="text-sm font-medium text-destructive">{state.error}</p>
      )}

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pending}
          className="bg-accent hover:bg-accent/90 text-white"
        >
          {pending ? "กำลังบันทึก…" : type === "receive" ? "รับสินค้า" : "ปรับสต็อก"}
        </Button>
        <Link
          href="/inventory"
          className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted hover:text-foreground transition-all"
        >
          ยกเลิก
        </Link>
      </div>
    </form>
  );
}
