"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { signIn, type SignInState } from "@/app/actions/auth";
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

export default function LoginPage() {
  const [state, action, pending] = useActionState<SignInState, FormData>(
    signIn,
    undefined
  );
  const [token, setToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileInstance>(null);

  // Synchronize local UI state with the latest action result during render (React's "adjust
  // state while rendering" pattern), same convention already used by void-order-button.tsx in
  // this codebase — avoids the react-hooks/set-state-in-effect lint violation a useEffect-based
  // version would trigger.
  const [handledState, setHandledState] = useState<SignInState>(undefined);
  if (state !== handledState) {
    setHandledState(state);
    if (state?.error !== undefined) {
      setToken(null);
    }
  }

  // Resetting the Turnstile widget is a genuine imperative side effect (an external DOM/network
  // call on the third-party widget instance), so it belongs in an effect, not the render-time
  // block above — tokens are single-use, so a failed submission must get a fresh one.
  useEffect(() => {
    if (state?.error !== undefined) {
      turnstileRef.current?.reset();
    }
  }, [state]);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl text-sidebar">KIDKUBPOS</CardTitle>
        <CardDescription>เข้าสู่ระบบเพื่อดำเนินการต่อ</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">อีเมล</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">รหัสผ่าน</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          <Link
            href="/forgot-password"
            className="block text-right text-sm text-accent hover:underline"
          >
            ลืมรหัสผ่าน?
          </Link>
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
            {pending ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            ยังไม่มีบัญชี?{" "}
            <Link href="/register" className="text-accent font-medium hover:underline">
              สมัครใช้งาน
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
