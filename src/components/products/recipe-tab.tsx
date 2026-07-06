"use client";
import { useState, useTransition } from "react";
import { updateProductRecipes } from "@/app/actions/products";
import type { RawMaterial } from "@/lib/dal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type RecipeRow = { raw_material_id: string; quantity_used: string };

type Props = {
  productId: string;
  rawMaterials: RawMaterial[];
  initialRows: RecipeRow[];
};

export function RecipeTab({ productId, rawMaterials, initialRows }: Props) {
  const [rows, setRows] = useState<RecipeRow[]>(
    initialRows.length > 0
      ? initialRows
      : [{ raw_material_id: "", quantity_used: "" }]
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function addRow() {
    setRows((prev) => [...prev, { raw_material_id: "", quantity_used: "" }]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRow(index: number, field: keyof RecipeRow, value: string) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [field]: value } : r))
    );
  }

  function handleSave() {
    setError(null);
    setSaved(false);
    const formData = new FormData();
    formData.append("product_id", productId);
    for (const row of rows) {
      if (row.raw_material_id && row.quantity_used) {
        formData.append("raw_material_id", row.raw_material_id);
        formData.append("quantity_used", row.quantity_used);
      }
    }
    startTransition(async () => {
      await updateProductRecipes(formData);
      setSaved(true);
    });
  }

  // Cost preview
  const totalCost = rows.reduce((sum, row) => {
    const mat = rawMaterials.find((m) => m.id === row.raw_material_id);
    if (!mat) return sum;
    const qty = parseFloat(row.quantity_used);
    if (isNaN(qty)) return sum;
    return sum + Number(mat.cost_per_unit) * qty;
  }, 0);

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        กำหนดวัตถุดิบที่ใช้ในเมนูนี้ ระบบจะหักสต็อกอัตโนมัติเมื่อมีคำสั่งซื้อ
      </p>

      {/* Recipe rows */}
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={row.raw_material_id}
              onChange={(e) => updateRow(i, "raw_material_id", e.target.value)}
              className="flex-1 h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
            >
              <option value="">— เลือกวัตถุดิบ —</option>
              {rawMaterials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.unit})
                </option>
              ))}
            </select>
            <Input
              type="number"
              step="0.001"
              min="0.001"
              placeholder="ปริมาณ"
              value={row.quantity_used}
              onChange={(e) => updateRow(i, "quantity_used", e.target.value)}
              className="w-28"
            />
            <span className="text-xs text-muted-foreground w-8">
              {rawMaterials.find((m) => m.id === row.raw_material_id)?.unit ??
                ""}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => removeRow(i)}
              className="shrink-0"
            >
              ลบ
            </Button>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        + เพิ่มวัตถุดิบ
      </Button>

      {/* Cost preview */}
      {totalCost > 0 && (
        <div className="rounded-md bg-muted/30 px-4 py-2 text-sm">
          ต้นทุนวัตถุดิบรวม:{" "}
          <span className="font-semibold">{totalCost.toFixed(2)} บาท</span>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && (
        <p className="text-sm text-green-600">บันทึกสูตรเรียบร้อยแล้ว</p>
      )}

      <Button
        onClick={handleSave}
        disabled={isPending}
        className="bg-accent hover:bg-accent/90 text-white"
      >
        {isPending ? "กำลังบันทึก…" : "บันทึกสูตร"}
      </Button>
    </div>
  );
}
