"use client";
import { useActionState } from "react";
import type { SettingsState } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  action: (prevState: SettingsState, formData: FormData) => Promise<SettingsState>;
  defaultValue: number;
};

export function CashFloatForm({ action, defaultValue }: Props) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="cash-float">เงินทอนที่เก็บไว้ในลิ้นชักข้ามคืน (บาท)</Label>
        <Input
          id="cash-float"
          name="cash_float_default"
          inputMode="decimal"
          defaultValue={String(defaultValue)}
          placeholder="1000"
        />
        <p className="text-xs text-muted-foreground">
          ตอนปิดกะ ระบบจะใส่ยอดนี้ให้ก่อน ส่วนที่เกินคือเงินที่นำไปฝากธนาคาร (แก้เฉพาะคืนนั้นได้ตอนปิดกะ)
        </p>
      </div>

      {state?.error && <p className="text-sm font-medium text-destructive">{state.error}</p>}
      {state?.success && <p className="text-sm font-medium text-success">บันทึกเรียบร้อย</p>}

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
