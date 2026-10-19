"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import type { ProductState } from "@/app/actions/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToastManager } from "@/components/ui/toast";
import { formatPrice } from "@/lib/cash";
import {
  HIGH_PRICE_CONFIRM,
  MAX_PRODUCT_DESCRIPTION,
  MAX_PRODUCT_NAME,
  MAX_PRODUCT_PRICE,
} from "@/lib/product-input";

type Category = { id: string; name: string };

type Defaults = {
  id?: string;
  name?: string;
  price?: number;
  description?: string | null;
  category_id?: string | null;
  drink_type?: string | null;
  is_active?: boolean;
};

type Props = {
  action: (
    prevState: ProductState,
    formData: FormData
  ) => Promise<ProductState>;
  categories: Category[];
  defaults?: Defaults;
};

export function ProductForm({ action, categories, defaults = {} }: Props) {
  const [state, formAction, pending] = useActionState<ProductState, FormData>(
    action,
    undefined
  );
  // A high new price ("8500" instead of "85") needs a second tap on save.
  const [confirmedHighPrice, setConfirmedHighPrice] = useState<string | null>(null);
  const toastManager = useToastManager();
  const toastManagerRef = useRef(toastManager);
  useEffect(() => {
    toastManagerRef.current = toastManager;
  });

  useEffect(() => {
    if (state?.error) {
      toastManagerRef.current.add({ title: state.error, type: "error" });
    }
  }, [state?.error]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const raw = String(new FormData(e.currentTarget).get("price") ?? "").trim();
        const price = Number(raw);
        const isHigh = price >= HIGH_PRICE_CONFIRM && price !== defaults.price;
        if (isHigh && confirmedHighPrice !== raw) {
          e.preventDefault();
          setConfirmedHighPrice(raw);
        }
      }}
      className="max-w-lg space-y-4"
    >
      {defaults.id !== undefined && (
        <input type="hidden" name="id" value={defaults.id} />
      )}

      <div className="space-y-1.5">
        <Label htmlFor="name">ชื่อสินค้า</Label>
        <Input
          id="name"
          name="name"
          defaultValue={defaults.name ?? ""}
          placeholder="ชื่อสินค้า"
          maxLength={MAX_PRODUCT_NAME}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="price">ราคา (บาท)</Label>
        <Input
          id="price"
          name="price"
          type="number"
          step="0.01"
          min="0"
          max={MAX_PRODUCT_PRICE}
          defaultValue={defaults.price ?? 0}
          onChange={() => setConfirmedHighPrice(null)}
          required
        />
        {confirmedHighPrice !== null && (
          <p role="alert" className="text-sm font-medium text-warning">
            ราคา ฿{formatPrice(Number(confirmedHighPrice))} สูงกว่าปกติ — กดบันทึกอีกครั้งเพื่อยืนยัน
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="category_id">หมวดหมู่</Label>
        <select
          id="category_id"
          name="category_id"
          defaultValue={defaults.category_id ?? ""}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">— ไม่ระบุ —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="drink_type">ประเภทเครื่องดื่ม</Label>
        <select
          id="drink_type"
          name="drink_type"
          defaultValue={defaults.drink_type ?? ""}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">— ไม่ใช่เครื่องดื่ม —</option>
          <option value="hot">ร้อน</option>
          <option value="iced">เย็น</option>
          <option value="blended">ปั่น</option>
          <option value="special">Special</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">รายละเอียด</Label>
        <Textarea
          id="description"
          name="description"
          defaultValue={defaults.description ?? ""}
          placeholder="รายละเอียดสินค้า (ไม่บังคับ)"
          maxLength={MAX_PRODUCT_DESCRIPTION}
          rows={3}
        />
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="is_active"
          name="is_active"
          defaultChecked={defaults.is_active ?? true}
        />
        <Label htmlFor="is_active">เปิดใช้งาน</Label>
      </div>

      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={pending}
          className="bg-accent hover:bg-accent/90 text-white"
        >
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => history.back()}
        >
          ยกเลิก
        </Button>
      </div>
    </form>
  );
}
