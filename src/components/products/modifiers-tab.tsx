"use client";
import { useState, useTransition } from "react";
import { updateProductModifiers } from "@/app/actions/products";
import type { ModifierWithOptions } from "@/types/app";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Props = {
  productId: string;
  allModifiers: ModifierWithOptions[];
  linkedModifierIds: string[];
};

export function ModifiersTab({
  productId,
  allModifiers,
  linkedModifierIds,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(linkedModifierIds)
  );
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function toggle(modifierId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(modifierId)) next.delete(modifierId);
      else next.add(modifierId);
      return next;
    });
    setSaved(false);
  }

  function handleSave() {
    const formData = new FormData();
    formData.append("product_id", productId);
    for (const id of selected) {
      formData.append("modifier_id", id);
    }
    startTransition(async () => {
      await updateProductModifiers(formData);
      setSaved(true);
    });
  }

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-muted-foreground">
        เลือกกลุ่มตัวเลือกที่ต้องการให้แสดงเมื่อลูกค้าสั่งเมนูนี้
      </p>

      {allModifiers.length === 0 ? (
        <div className="rounded-lg border p-4 text-sm text-muted-foreground text-center">
          ยังไม่มีกลุ่มตัวเลือก —{" "}
          <a href="/modifiers" className="text-accent hover:underline">
            ไปสร้างที่ Modifiers
          </a>
        </div>
      ) : (
        <div className="space-y-2">
          {allModifiers.map((mod) => (
            <label
              key={mod.id}
              className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                selected.has(mod.id)
                  ? "border-accent bg-accent/5"
                  : "hover:bg-muted/10"
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(mod.id)}
                onChange={() => toggle(mod.id)}
                className="mt-0.5 h-4 w-4 rounded border-input accent-accent"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{mod.name}</span>
                  {mod.isRequired && (
                    <Badge variant="destructive" className="text-xs">
                      บังคับ
                    </Badge>
                  )}
                  {mod.isMultiSelect && (
                    <Badge className="text-xs bg-blue-100 text-blue-700">
                      หลายตัวเลือก
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {mod.options.map((o) => o.name).join(", ")}
                </p>
              </div>
            </label>
          ))}
        </div>
      )}

      {saved && (
        <p className="text-sm text-green-600">บันทึกตัวเลือกเรียบร้อยแล้ว</p>
      )}

      <Button
        onClick={handleSave}
        disabled={isPending}
        className="bg-accent hover:bg-accent/90 text-white"
      >
        {isPending ? "กำลังบันทึก…" : "บันทึกตัวเลือก"}
      </Button>
    </div>
  );
}
