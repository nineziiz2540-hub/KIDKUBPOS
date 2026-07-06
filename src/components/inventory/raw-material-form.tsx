"use client";
import { useActionState } from "react";
import Link from "next/link";
import type { InventoryState } from "@/app/actions/inventory";
import type { RawMaterial } from "@/lib/dal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  action: (prevState: InventoryState, formData: FormData) => Promise<InventoryState>;
  defaults?: RawMaterial;
};

export function RawMaterialForm({ action, defaults }: Props) {
  const [state, formAction, pending] = useActionState<InventoryState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="space-y-4 max-w-lg">
      {defaults?.id && <input type="hidden" name="id" value={defaults.id} />}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5 col-span-2 sm:col-span-1">
          <Label htmlFor="rm-name">ชื่อวัตถุดิบ</Label>
          <Input
            id="rm-name"
            name="name"
            defaultValue={defaults?.name ?? ""}
            placeholder="เช่น นมสด, กาแฟ"
            required
          />
        </div>
        <div className="space-y-1.5 col-span-2 sm:col-span-1">
          <Label htmlFor="rm-unit">หน่วย</Label>
          <Input
            id="rm-unit"
            name="unit"
            defaultValue={defaults?.unit ?? ""}
            placeholder="เช่น มล., กรัม, ชิ้น"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rm-cost">ต้นทุน / หน่วย (บาท)</Label>
          <Input
            id="rm-cost"
            name="cost_per_unit"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={defaults?.cost_per_unit ?? 0}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rm-min">แจ้งเตือนเมื่อสต็อก ≤</Label>
          <Input
            id="rm-min"
            name="min_stock_alert"
            type="number"
            step="0.001"
            min="0"
            defaultValue={defaults?.min_stock_alert ?? 0}
          />
        </div>
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
          {pending ? "กำลังบันทึก…" : "บันทึก"}
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
