"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { signUp, type SignUpState } from "@/app/actions/auth";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
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

export default function RegisterPage() {
  const [state, action, pending] = useActionState<SignUpState, FormData>(
    signUp,
    undefined
  );
  const [token, setToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);

  const [handledState, setHandledState] = useState<SignUpState>(undefined);
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
          <CardTitle className="text-2xl text-sidebar">สมัครสำเร็จ</CardTitle>
          <CardDescription>
            กรุณาตรวจสอบอีเมลของคุณและกดยืนยันตัวตน ก่อนเข้าสู่ระบบครั้งแรก
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
        <CardTitle className="text-2xl text-sidebar">สมัครใช้งาน KIDKUBPOS</CardTitle>
        <CardDescription>สร้างร้านค้าของคุณ</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="store_name">ชื่อร้าน</Label>
            <Input id="store_name" name="store_name" type="text" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">อีเมล</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">รหัสผ่าน</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm_password">ยืนยันรหัสผ่าน</Label>
            <Input
              id="confirm_password"
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>
          <input type="hidden" name="turnstile_token" value={token ?? ""} />
          <TurnstileWidget
            ref={turnstileRef}
            onSuccess={setToken}
            onExpireOrError={() => setToken(null)}
          />
          {state?.error !== undefined && (
            <p className="text-sm text-destructive font-medium">{state.error}</p>
          )}
          <Button
            type="submit"
            disabled={pending || !token}
            className="w-full bg-accent hover:bg-accent/90 text-white"
          >
            {pending ? "กำลังสมัคร…" : "สมัครใช้งาน"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            มีบัญชีอยู่แล้ว?{" "}
            <Link href="/login" className="text-accent font-medium hover:underline">
              เข้าสู่ระบบ
            </Link>
          </p>
        </form>
        <div className="relative py-2">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-2 text-muted-foreground">หรือ</span>
          </div>
        </div>
        <OAuthButtons />
      </CardContent>
    </Card>
  );
}
