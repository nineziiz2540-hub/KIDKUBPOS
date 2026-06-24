"use client";
import { useActionState } from "react";
import type { CategoryState } from "@/app/actions/categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  action: (
    prevState: CategoryState,
    formData: FormData
  ) => Promise<CategoryState>;
  defaultName?: string;
  id?: string;
};

export function CategoryForm({ action, defaultName = "", id }: Props) {
  const [state, formAction, pending] = useActionState<CategoryState, FormData>(
    action,
    undefined
  );
  return (
    <form action={formAction} className="max-w-md space-y-4">
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      <div className="space-y-1.5">
        <Label htmlFor="name">ชื่อหมวดหมู่</Label>
        <Input
          id="name"
          name="name"
          defaultValue={defaultName}
          placeholder="เช่น อาหาร, เครื่องดื่ม"
          required
        />
      </div>
      {state?.error !== undefined && (
        <p className="text-sm font-medium text-danger">{state.error}</p>
      )}
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
