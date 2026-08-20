"use client";
import { useActionState, useState } from "react";
import {
  confirmMfaEnrollment,
  disableMfa,
  enrollMfa,
  type EnrollMfaResult,
  type MfaEnrollState,
} from "@/app/actions/mfa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MfaSection({ initiallyEnabled }: { initiallyEnabled: boolean }) {
  const [enrollment, setEnrollment] = useState<EnrollMfaResult | null>(null);
  const [starting, setStarting] = useState(false);
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [confirmState, confirmAction, confirmPending] = useActionState<MfaEnrollState, FormData>(
    confirmMfaEnrollment,
    undefined
  );

  async function startEnrollment() {
    setStarting(true);
    const result = await enrollMfa();
    setStarting(false);
    setEnrollment(result);
  }

  async function handleDisable() {
    const result = await disableMfa();
    if (!result.error) {
      setEnabled(false);
      setEnrollment(null);
    }
  }

  if (confirmState && "success" in confirmState && confirmState.success) {
    return (
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-sidebar">เปิดใช้งาน 2FA สำเร็จ</h2>
        <p className="text-sm text-destructive font-medium">
          บันทึกรหัสสำรองเหล่านี้ไว้ในที่ปลอดภัย — แต่ละรหัสใช้ได้ครั้งเดียว
          และการใช้รหัสสำรองจะปิดการใช้งาน 2FA โดยอัตโนมัติ
        </p>
        <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-muted/40 rounded-md p-4">
          {confirmState.backupCodes.map((code) => (
            <div key={code}>{code}</div>
          ))}
        </div>
        <Button
          onClick={() => {
            setEnrollment(null);
            setEnabled(true);
          }}
          className="bg-accent hover:bg-accent/90 text-white"
        >
          เสร็จสิ้น
        </Button>
      </div>
    );
  }

  if (enrollment && "factorId" in enrollment) {
    return (
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-sidebar">สแกน QR Code</h2>
        <p className="text-sm text-muted-foreground">
          เปิดแอป Authenticator (เช่น Google Authenticator) แล้วสแกน QR นี้
        </p>
        <img
          src={`data:image/svg+xml;utf-8,${enrollment.qrCode}`}
          alt="TOTP QR code"
          className="mx-auto"
        />
        <p className="text-xs text-muted-foreground text-center font-mono">{enrollment.secret}</p>
        <form action={confirmAction} className="space-y-3">
          <input type="hidden" name="factor_id" value={enrollment.factorId} />
          <div className="space-y-1.5">
            <Label htmlFor="mfa-code">รหัส 6 หลักจากแอป</Label>
            <Input id="mfa-code" name="code" maxLength={6} placeholder="000000" />
          </div>
          {confirmState && "error" in confirmState && confirmState.error && (
            <p className="text-sm text-destructive font-medium">{confirmState.error}</p>
          )}
          <Button type="submit" disabled={confirmPending} className="bg-accent hover:bg-accent/90 text-white">
            {confirmPending ? "กำลังยืนยัน…" : "ยืนยัน"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-5 space-y-4">
      <h2 className="text-base font-semibold text-sidebar">ยืนยันตัวตน 2 ชั้น (2FA)</h2>
      <p className="text-sm text-muted-foreground">
        {enabled ? "เปิดใช้งานอยู่" : "เพิ่มความปลอดภัยให้บัญชีของคุณด้วยแอป Authenticator"}
      </p>
      {enabled ? (
        <Button onClick={handleDisable} variant="destructive">
          ปิดใช้งาน 2FA
        </Button>
      ) : (
        <Button
          onClick={startEnrollment}
          disabled={starting}
          className="bg-accent hover:bg-accent/90 text-white"
        >
          {starting ? "กำลังเริ่ม…" : "เปิดใช้งาน 2FA"}
        </Button>
      )}
      {enrollment && "error" in enrollment && (
        <p className="text-sm text-destructive font-medium">{enrollment.error}</p>
      )}
    </div>
  );
}
