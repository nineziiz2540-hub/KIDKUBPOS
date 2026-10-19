"use client";
import { useActionState } from "react";
import type { CategoryState } from "@/app/actions/categories";
import { MAX_CATEGORY_NAME } from "@/lib/product-input";

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
    <form action={formAction} className="max-w-xl rounded-2xl bg-white p-6 space-y-5">
      {id !== undefined && <input type="hidden" name="id" value={id} />}
      <div className="space-y-2">
        <label htmlFor="name" className="block text-base font-medium text-sidebar">
          ชื่อหมวดหมู่
        </label>
        <input
          id="name"
          name="name"
          defaultValue={defaultName}
          placeholder="เช่น COFFEE, MATCHA"
          maxLength={MAX_CATEGORY_NAME}
          required
          className="w-full h-[50px] rounded-xl border border-input bg-white px-4 text-[17px] text-sidebar focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        />
      </div>
      {state?.error !== undefined && (
        <p role="alert" className="text-[15px] font-medium text-destructive">{state.error}</p>
      )}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="h-12 px-6 rounded-xl bg-accent text-white text-base font-semibold hover:bg-accent/90 disabled:opacity-60"
        >
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <button
          type="button"
          onClick={() => history.back()}
          className="h-12 px-6 rounded-xl border border-input bg-white text-base font-semibold text-sidebar hover:bg-muted"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}
