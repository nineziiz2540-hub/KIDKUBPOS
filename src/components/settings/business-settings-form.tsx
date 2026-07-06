"use client";
import { useActionState } from "react";
import type { SettingsState } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BusinessDefaults = {
  fixedCostMonthly: number;
  deliveryGpPercent: number;
  orderPrefix: string;
};

type Props = {
  action: (prevState: SettingsState, formData: FormData) => Promise<SettingsState>;
  defaults: BusinessDefaults;
};

export function BusinessSettingsForm({ action, defaults }: Props) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(
    action,
    undefined
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="bs-fixed">ต้นทุนคงที่ต่อเดือน (บาท)</Label>
          <Input
            id="bs-fixed"
            name="fixed_cost_monthly"
            type="number"
            step="0.01"
            min="0"
            defaultValue={defaults.fixedCostMonthly}
          />
          <p className="text-xs text-muted-foreground">ค่าเช่า, เงินเดือน ฯลฯ</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bs-gp">GP% สำหรับ Delivery</Label>
          <Input
            id="bs-gp"
            name="delivery_gp_percent"
            type="number"
            step="0.01"
            min="0"
            max="100"
            defaultValue={defaults.deliveryGpPercent}
          />
          <p className="text-xs text-muted-foreground">ใช้คำนวณราคา Delivery ใน Pricing Calculator</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bs-prefix">Order Prefix</Label>
          <Input
            id="bs-prefix"
            name="order_prefix"
            defaultValue={defaults.orderPrefix}
            placeholder="KK"
            maxLength={5}
          />
          <p className="text-xs text-muted-foreground">ตัวอักษรนำหน้าเลขออเดอร์ เช่น KK → KK.001</p>
        </div>
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
