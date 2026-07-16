"use client";
import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, type ForgotPasswordState } from "@/app/actions/auth";
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
          {state?.error !== undefined && (
            <p className="text-sm text-destructive font-medium">{state.error}</p>
          )}
          <Button
            type="submit"
            disabled={pending}
            className="w-full bg-accent hover:bg-accent/90 text-white"
          >
            {pending ? "กำลังส่ง…" : "ส่งลิงก์"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
