"use client";
import { useActionState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { updatePassword, type UpdatePasswordState } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/client";
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

type ExchangeState = "pending" | "ready" | "error";

function PendingCard() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl text-sidebar">กำลังตรวจสอบลิงก์...</CardTitle>
      </CardHeader>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<PendingCard />}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [exchangeState, setExchangeState] = useState<ExchangeState>("pending");
  const [state, action, pending] = useActionState<UpdatePasswordState, FormData>(
    updatePassword,
    undefined
  );

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      setExchangeState("error");
      return;
    }

    const supabase = createClient();
    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      setExchangeState(error ? "error" : "ready");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state?.success) {
      const timer = setTimeout(() => router.push("/login"), 2000);
      return () => clearTimeout(timer);
    }
  }, [state?.success, router]);

  if (state?.success) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-sidebar">เปลี่ยนรหัสผ่านสำเร็จ</CardTitle>
          <CardDescription>กำลังพาไปหน้าเข้าสู่ระบบ…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (exchangeState === "pending") {
    return <PendingCard />;
  }

  if (exchangeState === "error") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-sidebar">ลิงก์ไม่ถูกต้องหรือหมดอายุ</CardTitle>
          <CardDescription>
            <a href="/forgot-password" className="text-accent underline">
              ขอลิงก์ใหม่
            </a>
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl text-sidebar">ตั้งรหัสผ่านใหม่</CardTitle>
        <CardDescription>กรอกรหัสผ่านใหม่ของคุณ</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">รหัสผ่านใหม่</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm_password">ยืนยันรหัสผ่านใหม่</Label>
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
            {pending ? "กำลังบันทึก…" : "เปลี่ยนรหัสผ่าน"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
