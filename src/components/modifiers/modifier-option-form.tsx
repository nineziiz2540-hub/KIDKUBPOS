"use client";
import { useActionState } from "react";
import type { ModifierState } from "@/app/actions/modifiers";
import { createModifierOption } from "@/app/actions/modifiers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = { modifierId: string };

export function ModifierOptionForm({ modifierId }: Props) {
  const [state, formAction, pending] = useActionState<ModifierState, FormData>(
    createModifierOption,
    undefined
  );

  return (
    <form action={formAction} className="flex items-end gap-2 flex-wrap">
      <input type="hidden" name="modifier_id" value={modifierId} />

      <div className="space-y-1 min-w-[120px]">
        <Label htmlFor={`opt-name-${modifierId}`} className="text-xs">ชื่อตัวเลือก</Label>
        <Input
          id={`opt-name-${modifierId}`}
          name="name"
          placeholder="เช่น 50%, ไข่มุก"
          className="h-8 text-sm"
          required
        />
      </div>
      <div className="space-y-1 w-[100px]">
        <Label htmlFor={`opt-price-${modifierId}`} className="text-xs">ราคา +/- (บาท)</Label>
        <Input
          id={`opt-price-${modifierId}`}
          name="price_delta"
          type="number"
          step="0.01"
          defaultValue={0}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1 w-[70px]">
        <Label htmlFor={`opt-order-${modifierId}`} className="text-xs">ลำดับ</Label>
        <Input
          id={`opt-order-${modifierId}`}
          name="sort_order"
          type="number"
          min="0"
          defaultValue={0}
          className="h-8 text-sm"
        />
      </div>

      <Button
        type="submit"
        disabled={pending}
        size="sm"
        className="bg-accent hover:bg-accent/90 text-white"
      >
        {pending ? "…" : "+ เพิ่ม"}
      </Button>

      {state?.error && (
        <p className="text-sm font-medium text-destructive w-full">{state.error}</p>
      )}
    </form>
  );
}
