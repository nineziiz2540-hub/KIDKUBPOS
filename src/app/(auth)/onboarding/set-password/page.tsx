"use client";
import { useActionState } from "react";
import { setBackupPassword, type SetBackupPasswordState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SetBackupPasswordPage() {
  const [state, action, pending] = useActionState<SetBackupPasswordState, FormData>(
    setBackupPassword,
    undefined
  );

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl text-sidebar">ตั้งรหัสผ่านสำรอง</CardTitle>
        <CardDescription>
          บัญชีของคุณล็อกอินด้วย Google/Facebook ยังไม่มีรหัสผ่าน — ต้องตั้งรหัสผ่านสำรองไว้ 1 ครั้ง
          เพื่อใช้ยืนยันตัวตนตอนกด &quot;ลืม PIN?&quot; ในอนาคต
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">รหัสผ่านสำรอง</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm_password">ยืนยันรหัสผ่านสำรอง</Label>
            <Input
              id="confirm_password"
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              required
            />
          </div>
          {state?.error !== undefined && (
            <p className="text-sm text-destructive font-medium">{state.error}</p>
          )}
          <Button
            type="submit"
            disabled={pending}
            className="w-full bg-accent hover:bg-accent/90 text-white"
          >
            {pending ? "กำลังบันทึก…" : "บันทึกรหัสผ่านสำรอง"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
