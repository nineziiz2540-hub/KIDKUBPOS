"use client";
import { useActionState, useState } from "react";
import { verifyMfaBackupCode, verifyMfaChallenge, type MfaChallengeState } from "@/app/actions/mfa";
import { PinPad } from "@/components/ui/pin-pad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MfaChallengeForm({ factorId }: { factorId: string }) {
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [codeState, codeAction, codePending] = useActionState<MfaChallengeState, FormData>(
    verifyMfaChallenge,
    undefined
  );
  const [backupState, backupAction, backupPending] = useActionState<MfaChallengeState, FormData>(
    verifyMfaBackupCode,
    undefined
  );
  // Callback-ref + form.elements.namedItem pattern — matches this codebase's existing
  // PinPad-driving-a-server-action convention exactly (see src/components/job-level/role-tile.tsx).
  const [formRef, setFormRef] = useState<HTMLFormElement | null>(null);

  if (useBackupCode) {
    return (
      <form action={backupAction} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="backup_code">รหัสสำรอง</Label>
          <Input id="backup_code" name="backup_code" placeholder="XXXXXXXXXX" maxLength={10} />
          <p className="text-xs text-muted-foreground">
            การใช้รหัสสำรองจะปิดการใช้งาน 2FA — คุณจะต้องเปิดใช้งานใหม่หลังเข้าสู่ระบบ
          </p>
        </div>
        {backupState?.error && (
          <p className="text-sm text-destructive font-medium">{backupState.error}</p>
        )}
        <Button type="submit" disabled={backupPending} className="w-full bg-accent hover:bg-accent/90 text-white">
          {backupPending ? "กำลังตรวจสอบ…" : "ยืนยันด้วยรหัสสำรอง"}
        </Button>
        <button
          type="button"
          onClick={() => setUseBackupCode(false)}
          className="w-full text-center text-sm text-accent hover:underline"
        >
          กลับไปใช้แอป Authenticator
        </button>
      </form>
    );
  }

  return (
    <form ref={setFormRef} action={codeAction} className="flex flex-col items-center gap-4">
      <input type="hidden" name="factor_id" value={factorId} />
      <input type="hidden" name="code" />
      {codeState?.error && (
        <p className="text-sm text-destructive font-medium text-center">{codeState.error}</p>
      )}
      <PinPad
        disabled={codePending}
        onComplete={(pin) => {
          if (!formRef) return;
          const hidden = formRef.elements.namedItem("code") as HTMLInputElement;
          hidden.value = pin;
          formRef.requestSubmit();
        }}
      />
      <button
        type="button"
        onClick={() => setUseBackupCode(true)}
        className="w-full text-center text-sm text-accent hover:underline"
      >
        ใช้รหัสสำรองแทน
      </button>
    </form>
  );
}
