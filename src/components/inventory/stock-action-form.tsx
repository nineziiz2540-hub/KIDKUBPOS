"use client";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Delete } from "lucide-react";
import { receiveStock, adjustStock, undoReceive } from "@/app/actions/inventory";
import type { InventoryState } from "@/app/actions/inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToastManager } from "@/components/ui/toast";
import {
  padPress,
  composeEntryQty,
  entryToBaseQty,
  approxPurchaseText,
  formatQty,
  undoErrorMessage,
} from "@/lib/stock/material-view";
import { cn } from "@/lib/utils";

type Fraction = 0.25 | 0.5 | 0.75;
const FRACTIONS: Array<{ value: Fraction; label: string }> = [
  { value: 0.25, label: "¼" },
  { value: 0.5, label: "½" },
  { value: 0.75, label: "¾" },
];
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];

type Props = {
  type: "receive" | "adjust";
  rawMaterialId: string;
  materialName: string;
  currentStock: number;
  unit: string;
  purchaseUnit: string | null;
  purchaseSize: number | null;
  /** Only owner/manager see the price field. */
  role: string;
};

export function StockActionForm(props: Props) {
  return props.type === "receive" ? <ReceiveForm {...props} /> : <AdjustForm {...props} />;
}

function ReceiveForm({
  rawMaterialId,
  materialName,
  currentStock,
  unit,
  purchaseUnit,
  purchaseSize,
  role,
}: Props) {
  const router = useRouter();
  const toast = useToastManager();
  const [pad, setPad] = useState("");
  const [fraction, setFraction] = useState<Fraction | 0>(0);

  const entryUnit = purchaseSize !== null && purchaseUnit ? purchaseUnit : unit;
  const entry = composeEntryQty(pad, fraction);
  const baseQty = entryToBaseQty(entry, purchaseSize);
  const canSeePrice = role === "owner" || role === "manager";

  const [state, formAction, pending] = useActionState<InventoryState, FormData>(
    async (prev, formData) => {
      const result = await receiveStock(prev, formData);
      if (result?.success) {
        const ledgerId = result.ledgerId;
        let done = false;
        const label = `รับของเข้า: ${materialName} ${entry} ${entryUnit}`;
        const toastId = toast.add({
          title: label,
          type: "success",
          timeout: 5000,
          actionProps: ledgerId
            ? {
                children: "ย้อนกลับ",
                onClick: async () => {
                  if (done) return;
                  done = true;
                  toast.close(toastId);
                  const undo = await undoReceive(ledgerId);
                  toast.add(
                    undo?.error
                      ? { title: undoErrorMessage(undo.error), type: "error" }
                      : { title: `ย้อนกลับแล้ว: ${materialName}`, type: "success" }
                  );
                },
              }
            : undefined,
        });
        router.replace("/inventory");
      }
      return result;
    },
    undefined
  );

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <input type="hidden" name="raw_material_id" value={rawMaterialId} />
      <input type="hidden" name="quantity" value={baseQty ?? ""} />

      <p className="text-base text-muted-foreground">
        คงเหลือ:{" "}
        <span className="font-semibold text-foreground">
          {formatQty(currentStock, unit).replace("+", "")}
        </span>{" "}
        {approxPurchaseText(currentStock, purchaseSize, purchaseUnit)}
      </p>

      <div className="space-y-2">
        <Label>จำนวนที่รับ ({entryUnit})</Label>
        <div
          aria-live="polite"
          className="flex h-16 items-center justify-end rounded-lg border bg-white px-4 text-3xl font-bold"
        >
          {entry > 0 ? entry : "0"} <span className="ml-2 text-lg font-medium text-muted-foreground">{entryUnit}</span>
        </div>
        {baseQty !== null && purchaseSize !== null && (
          <p className="text-sm text-muted-foreground">
            = {formatQty(baseQty, unit).replace("+", "")}
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {FRACTIONS.map((f) => {
          const selected = fraction === f.value;
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={selected}
              onClick={() => setFraction(selected ? 0 : f.value)}
              className={cn(
                "flex h-14 items-center justify-center gap-1 rounded-lg border text-xl font-semibold",
                selected ? "border-accent bg-accent text-white" : "border-border bg-white text-sidebar"
              )}
            >
              {selected && <Check size={18} />}
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            aria-label={k === "back" ? "ลบตัวเลข" : k}
            onClick={() => setPad((p) => padPress(p, k))}
            className="flex h-14 items-center justify-center rounded-lg border border-border bg-white text-2xl font-semibold text-sidebar active:bg-muted"
          >
            {k === "back" ? <Delete size={22} /> : k}
          </button>
        ))}
      </div>

      {canSeePrice && (
        <div className="space-y-1.5">
          <Label htmlFor="sa-price">ราคาที่จ่าย (บาท)</Label>
          <Input
            id="sa-price"
            name="total_price"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder="ไม่บังคับ"
            className="h-14 text-lg"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="sa-note">หมายเหตุ (ไม่บังคับ)</Label>
        <Textarea id="sa-note" name="note" rows={2} maxLength={500} />
      </div>

      {state?.error && <p className="text-base font-medium text-destructive">{state.error}</p>}

      <div className="flex gap-3">
        <Button
          type="submit"
          disabled={pending || baseQty === null}
          className="h-16 bg-accent px-10 text-lg font-semibold text-white hover:bg-accent/90"
        >
          {pending ? "กำลังบันทึก…" : "รับของเข้า"}
        </Button>
        <Link
          href="/inventory"
          className="inline-flex h-16 items-center justify-center rounded-lg border border-border bg-background px-6 text-base font-medium hover:bg-muted"
        >
          ยกเลิก
        </Link>
      </div>
    </form>
  );
}

function AdjustForm({ rawMaterialId, materialName, currentStock, unit, purchaseUnit, purchaseSize }: Props) {
  const router = useRouter();
  const toast = useToastManager();
  const [state, formAction, pending] = useActionState<InventoryState, FormData>(
    async (prev, formData) => {
      const result = await adjustStock(prev, formData);
      if (result?.success) {
        toast.add({ title: `ปรับยอดแล้ว: ${materialName}`, type: "success" });
        router.replace("/inventory");
      }
      return result;
    },
    undefined
  );

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      <input type="hidden" name="raw_material_id" value={rawMaterialId} />
      <p className="text-base text-muted-foreground">
        คงเหลือ:{" "}
        <span className="font-semibold text-foreground">
          {formatQty(currentStock, unit).replace("+", "")}
        </span>{" "}
        {approxPurchaseText(currentStock, purchaseSize, purchaseUnit)}
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="sa-new">ยอดใหม่ ({unit})</Label>
        <Input
          id="sa-new"
          name="new_stock"
          type="number"
          inputMode="decimal"
          step="0.001"
          min="0"
          defaultValue={currentStock < 0 ? 0 : currentStock}
          className="h-14 text-lg"
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="sa-reason">เหตุผล (จำเป็น)</Label>
        <Textarea
          id="sa-reason"
          name="reason"
          placeholder="เช่น นับจริงแล้วไม่ตรง"
          rows={2}
          required
          maxLength={500}
        />
      </div>

      {state?.error && <p className="text-base font-medium text-destructive">{state.error}</p>}

      <div className="flex gap-3">
        <Button
          type="submit"
          disabled={pending}
          className="h-16 bg-accent px-10 text-lg font-semibold text-white hover:bg-accent/90"
        >
          {pending ? "กำลังบันทึก…" : "ปรับยอด"}
        </Button>
        <Link
          href="/inventory"
          className="inline-flex h-16 items-center justify-center rounded-lg border border-border bg-background px-6 text-base font-medium hover:bg-muted"
        >
          ยกเลิก
        </Link>
      </div>
    </form>
  );
}
