"use client";
import { useActionState } from "react";
import type { SettingsState } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  action: (prevState: SettingsState, formData: FormData) => Promise<SettingsState>;
  defaultValue: string;
};

export function PromptPayForm({ action, defaultValue }: Props) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="pp-id">เลข PromptPay</Label>
        <Input
          id="pp-id"
          name="promptpay_id"
          defaultValue={defaultValue}
          placeholder="0812345678"
          maxLength={15}
        />
        <p className="text-xs text-muted-foreground">
          เบอร์โทร (10 หลัก) หรือเลขผู้เสียภาษี (13 หลัก) — ใช้แสดง QR รับเงินตอนลูกค้าเลือกจ่ายแบบโอน
        </p>
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
