"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { requestPasswordReset, type ForgotPasswordState } from "@/app/actions/auth";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
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

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState<ForgotPasswordState, FormData>(
    requestPasswordReset,
    undefined
  );
  const [token, setToken] = useState<string | null>(null);
  const [widgetError, setWidgetError] = useState(false);
  const turnstileRef = useRef<TurnstileInstance>(null);

  const [handledState, setHandledState] = useState<ForgotPasswordState>(undefined);
  if (state !== handledState) {
    setHandledState(state);
    if (state?.error !== undefined) {
      setToken(null);
    }
  }

  useEffect(() => {
    if (state?.error !== undefined) {
      turnstileRef.current?.reset();
    }
  }, [state]);

  if (state?.success) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-sidebar">ส่งอีเมลแล้ว</CardTitle>
          <CardDescription>
            ถ้าอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้แล้ว
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/login"
            className="block text-center text-sm text-accent font-medium hover:underline"
          >
            กลับไปเข้าสู่ระบบ
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl text-sidebar">ลืมรหัสผ่าน</CardTitle>
        <CardDescription>กรอกอีเมลของคุณเพื่อรับลิงก์ตั้งรหัสผ่านใหม่</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">อีเมล</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required />
          </div>
          <input type="hidden" name="turnstile_token" value={token ?? ""} />
          <TurnstileWidget
            ref={turnstileRef}
            onSuccess={(t) => {
              setToken(t);
              setWidgetError(false);
            }}
            onExpire={() => setToken(null)}
            onError={() => {
              setToken(null);
              setWidgetError(true);
            }}
          />
          {widgetError && (
            <p className="text-xs text-muted-foreground text-center">
              ไม่สามารถโหลดระบบยืนยันตัวตนได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่
            </p>
          )}
          {state?.error !== undefined && (
            <p className="text-sm text-destructive font-medium">{state.error}</p>
          )}
          <Button
            type="submit"
            disabled={pending || !token}
            className="w-full bg-accent hover:bg-accent/90 text-white"
          >
            {pending ? "กำลังส่ง…" : "ส่งลิงก์"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
