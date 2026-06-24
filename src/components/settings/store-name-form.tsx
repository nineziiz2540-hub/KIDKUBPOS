"use client";
import { useActionState } from "react";
import type { SettingsState } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  action: (
    prevState: SettingsState,
    formData: FormData
  ) => Promise<SettingsState>;
  defaultName: string;
};

export function StoreNameForm({ action, defaultName }: Props) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="store-name">ชื่อร้านค้า</Label>
        <Input
          id="store-name"
          name="name"
          defaultValue={defaultName}
          placeholder="ชื่อร้านค้าของคุณ"
          required
        />
      </div>
      {state?.error && (
        <p className="text-sm font-medium text-destructive">{state.error}</p>
      )}
      {state?.success && (
        <p className="text-sm font-medium text-green-600">บันทึกเรียบร้อย</p>
      )}
      <Button
        type="submit"
        disabled={pending}
        className="bg-accent hover:bg-accent/90 text-white"
      >
        {pending ? "กำลังบันทึก…" : "บันทึก"}
      </Button>
    </form>
  );
}
