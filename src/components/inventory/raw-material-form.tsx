"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import type { InventoryState } from "@/app/actions/inventory";
import type { RawMaterial } from "@/lib/dal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Props = {
  action: (prevState: InventoryState, formData: FormData) => Promise<InventoryState>;
  defaults?: RawMaterial;
  /** Category names already in use (the owner can also type a new one). */
  categories: string[];
};

const FIELD = "h-14 text-lg";

export function RawMaterialForm({ action, defaults, categories }: Props) {
  const [state, formAction, pending] = useActionState<InventoryState, FormData>(action, undefined);
  const [trackStock, setTrackStock] = useState(defaults?.track_stock ?? true);

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      {defaults?.id && <input type="hidden" name="id" value={defaults.id} />}
      <input type="hidden" name="track_stock" value={trackStock ? "on" : "off"} />

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label htmlFor="rm-name">ชื่อ</Label>
          <Input
            id="rm-name"
            name="name"
            defaultValue={defaults?.name ?? ""}
            placeholder="เช่น นมสด, เมล็ดกาแฟ"
            className={FIELD}
            required
          />
        </div>
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label htmlFor="rm-category">หมวด</Label>
          <Input
            id="rm-category"
            name="category"
            list="rm-category-list"
            defaultValue={defaults?.category ?? "วัตถุดิบทั่วไป"}
            className={FIELD}
          />
          <datalist id="rm-category-list">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label htmlFor="rm-unit">ใช้เป็น</Label>
          <Input
            id="rm-unit"
            name="unit"
            defaultValue={defaults?.unit ?? ""}
            placeholder="g, ml หรือ ชิ้น"
            className={FIELD}
            required
          />
        </div>
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label htmlFor="rm-cost">ต้นทุน/หน่วย (บาท)</Label>
          <Input
            id="rm-cost"
            name="cost_per_unit"
            type="number"
            inputMode="decimal"
            step="0.0001"
            min="0"
            defaultValue={defaults?.cost_per_unit ?? 0}
            className={FIELD}
          />
        </div>

        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label htmlFor="rm-purchase-unit">ซื้อเป็น (ชื่อหน่วย)</Label>
          <Input
            id="rm-purchase-unit"
            name="purchase_unit"
            defaultValue={defaults?.purchase_unit ?? ""}
            placeholder="เช่น ขวด, ถุง, แพ็ก"
            className={FIELD}
          />
        </div>
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label htmlFor="rm-purchase-size">ซื้อเป็น (1 หน่วย = กี่ตัวที่ใช้)</Label>
          <Input
            id="rm-purchase-size"
            name="purchase_size"
            type="number"
            inputMode="decimal"
            step="0.001"
            min="0"
            defaultValue={defaults?.purchase_size ?? ""}
            placeholder="เช่น 2000"
            className={FIELD}
          />
        </div>

        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label htmlFor="rm-min">เตือนเมื่อเหลือ</Label>
          <Input
            id="rm-min"
            name="min_stock_alert"
            type="number"
            inputMode="decimal"
            step="0.001"
            min="0"
            defaultValue={defaults?.min_stock_alert ?? 0}
            className={FIELD}
          />
        </div>
      </div>

      <div className="flex min-h-14 items-center gap-4 rounded-lg border p-3">
        <Switch
          checked={trackStock}
          onCheckedChange={setTrackStock}
          aria-label="ติดตามสต๊อก"
        />
        <div>
          <p className="text-base font-medium text-sidebar">
            ติดตามสต๊อก: {trackStock ? "เปิด" : "ปิด"}
          </p>
          <p className="text-sm text-muted-foreground">
            ปิด = คิดแค่ต้นทุน ไม่ต้องนับ เช่น น้ำแข็ง น้ำ RO
          </p>
        </div>
      </div>

      {state?.error && <p className="text-base font-medium text-destructive">{state.error}</p>}

      <div className="flex gap-3">
        <Button
          type="submit"
          disabled={pending}
          className="h-14 bg-accent px-8 text-base font-semibold text-white hover:bg-accent/90"
        >
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </Button>
        <Link
          href="/inventory"
          className="inline-flex h-14 items-center justify-center rounded-lg border border-border bg-background px-6 text-base font-medium hover:bg-muted"
        >
          ยกเลิก
        </Link>
      </div>
    </form>
  );
}
