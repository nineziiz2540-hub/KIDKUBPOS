"use client";
import { useActionState } from "react";
import Link from "next/link";
import type { ModifierState } from "@/app/actions/modifiers";
import type { ModifierWithOptions } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  action: (prevState: ModifierState, formData: FormData) => Promise<ModifierState>;
  defaults?: Pick<ModifierWithOptions, "id" | "name" | "isRequired" | "isMultiSelect" | "sortOrder">;
};

export function ModifierForm({ action, defaults }: Props) {
  const [state, formAction, pending] = useActionState<ModifierState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="space-y-4 max-w-lg">
      {defaults?.id && <input type="hidden" name="id" value={defaults.id} />}

      <div className="space-y-1.5">
        <Label htmlFor="mod-name">ชื่อกลุ่มตัวเลือก</Label>
        <Input
          id="mod-name"
          name="name"
          defaultValue={defaults?.name ?? ""}
          placeholder="เช่น ความหวาน, ท็อปปิ้ง"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="mod-order">ลำดับ</Label>
          <Input
            id="mod-order"
            name="sort_order"
            type="number"
            min="0"
            defaultValue={defaults?.sortOrder ?? 0}
          />
        </div>
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="mod-required"
              name="is_required"
              defaultChecked={defaults?.isRequired ?? false}
              className="h-4 w-4 rounded border-input accent-accent"
            />
            <Label htmlFor="mod-required">บังคับเลือก</Label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="mod-multi"
              name="is_multi_select"
              defaultChecked={defaults?.isMultiSelect ?? false}
              className="h-4 w-4 rounded border-input accent-accent"
            />
            <Label htmlFor="mod-multi">เลือกได้หลายตัวเลือก</Label>
          </div>
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
          href="/modifiers"
          className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted hover:text-foreground h-8"
        >
          ยกเลิก
        </Link>
      </div>
    </form>
  );
}
