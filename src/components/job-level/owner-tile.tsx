"use client";
import { useActionState, useState } from "react";
import { setOwnPin, verifyOwnPin, type PinState } from "@/app/actions/job-level";
import { PinPad } from "@/components/ui/pin-pad";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function OwnerTile({ hasPinSet }: { hasPinSet: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="w-full rounded-lg border bg-white p-6 text-center hover:shadow-md transition-shadow"
      >
        <p className="text-lg font-semibold text-sidebar">OWNER</p>
      </button>
    );
  }

  return hasPinSet ? <VerifyOwnerPin /> : <SetOwnerPin />;
}

function SetOwnerPin() {
  const [state, action, pending] = useActionState<PinState, FormData>(setOwnPin, undefined);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-center text-base">ตั้งรหัส PIN ของคุณ</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pin">PIN 6 หลัก</Label>
            <Input id="pin" name="pin" type="password" inputMode="numeric" maxLength={6} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pin_confirm">ยืนยัน PIN</Label>
            <Input
              id="pin_confirm"
              name="pin_confirm"
              type="password"
              inputMode="numeric"
              maxLength={6}
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
            {pending ? "กำลังบันทึก…" : "ตั้ง PIN"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function VerifyOwnerPin() {
  const [state, action, pending] = useActionState<PinState, FormData>(verifyOwnPin, undefined);
  const [formRef, setFormRef] = useState<HTMLFormElement | null>(null);

  return (
    <Card>
      <CardContent className="pt-6">
        <form
          ref={setFormRef}
          action={action}
          className="flex flex-col items-center gap-4"
        >
          <input type="hidden" name="pin" />
          {state?.error !== undefined && (
            <p className="text-sm text-destructive font-medium">{state.error}</p>
          )}
          <PinPad
            disabled={pending}
            onComplete={(pin) => {
              if (!formRef) return;
              const hidden = formRef.elements.namedItem("pin") as HTMLInputElement;
              hidden.value = pin;
              formRef.requestSubmit();
            }}
          />
        </form>
      </CardContent>
    </Card>
  );
}
