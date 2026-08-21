"use client";
import { useActionState, useState } from "react";
import {
  confirmMfaEnrollment,
  disableMfa,
  enrollMfa,
  type MfaEnrollState,
} from "@/app/actions/mfa";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Single source of truth for which screen renders. Earlier revisions derived this from three
// independently-mutated pieces of state (a stale useActionState result + a local "enrollment"
// object + a "dismissed" boolean patch) — that combination let a leftover success result from a
// PRIOR enrollment cycle resurface and hijack rendering the moment a second enrollment started in
// the same page session, permanently hiding the second attempt's real backup codes. A phase enum,
// entered only by explicit transitions, makes that class of bug structurally impossible: the only
// way to reach "success" is the render-time sync below noticing a genuinely NEW action result.
type Phase =
  | { kind: "idle" }
  | { kind: "enrolling"; factorId: string; qrCode: string; secret: string }
  | { kind: "success"; backupCodes: string[] };

export function MfaSection({ initiallyEnabled }: { initiallyEnabled: boolean }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [starting, setStarting] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [disableError, setDisableError] = useState<string | null>(null);
  const [confirmState, confirmAction, confirmPending] = useActionState<MfaEnrollState, FormData>(
    confirmMfaEnrollment,
    undefined
  );

  // Render-time state sync (this codebase's established pattern, e.g. src/app/(auth)/login/page.tsx)
  // — reacts once to a genuinely new confirmState value rather than re-deriving "is the
  // last-seen result success" on every render, which is what let a stale result from an earlier
  // enrollment cycle keep winning after a disable-then-re-enroll.
  const [handledConfirmState, setHandledConfirmState] = useState<MfaEnrollState>(undefined);
  if (confirmState !== handledConfirmState) {
    setHandledConfirmState(confirmState);
    if (confirmState && "success" in confirmState && confirmState.success) {
      setPhase({ kind: "success", backupCodes: confirmState.backupCodes });
    }
  }

  async function startEnrollment() {
    setStarting(true);
    setEnrollError(null);
    setDisableError(null);
    try {
      const result = await enrollMfa();
      if ("error" in result) {
        setEnrollError(result.error);
        return;
      }
      setPhase({
        kind: "enrolling",
        factorId: result.factorId,
        qrCode: result.qrCode,
        secret: result.secret,
      });
    } catch {
      setEnrollError("เริ่มเปิดใช้งาน 2FA ไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setStarting(false);
    }
  }

  async function handleDisable() {
    setDisabling(true);
    try {
      const result = await disableMfa();
      if (result.error) {
        setDisableError(result.error);
        return;
      }
      setDisableError(null);
      setEnabled(false);
      setPhase({ kind: "idle" });
    } catch {
      setDisableError("ปิดใช้งาน 2FA ไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setDisabling(false);
    }
  }

  if (phase.kind === "success") {
    return (
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-sidebar">เปิดใช้งาน 2FA สำเร็จ</h2>
        <p className="text-sm text-destructive font-medium">
          บันทึกรหัสสำรองเหล่านี้ไว้ในที่ปลอดภัย — แต่ละรหัสใช้ได้ครั้งเดียว
          และการใช้รหัสสำรองจะปิดการใช้งาน 2FA โดยอัตโนมัติ
        </p>
        <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-muted/40 rounded-md p-4">
          {phase.backupCodes.map((code) => (
            <div key={code}>{code}</div>
          ))}
        </div>
        <Button
          onClick={() => {
            setPhase({ kind: "idle" });
            setEnabled(true);
          }}
          className="bg-accent hover:bg-accent/90 text-white"
        >
          เสร็จสิ้น
        </Button>
      </div>
    );
  }

  if (phase.kind === "enrolling") {
    return (
      <div className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold text-sidebar">สแกน QR Code</h2>
        <p className="text-sm text-muted-foreground">
          เปิดแอป Authenticator (เช่น Google Authenticator) แล้วสแกน QR นี้
        </p>
        <img src={phase.qrCode} alt="TOTP QR code" className="mx-auto" />
        <p className="text-xs text-muted-foreground text-center font-mono">{phase.secret}</p>
        <form action={confirmAction} className="space-y-3">
          <input type="hidden" name="factor_id" value={phase.factorId} />
          <div className="space-y-1.5">
            <Label htmlFor="mfa-code">รหัส 6 หลักจากแอป</Label>
            <Input id="mfa-code" name="code" maxLength={6} placeholder="000000" />
          </div>
          {confirmState && "error" in confirmState && confirmState.error && (
            <p className="text-sm text-destructive font-medium">{confirmState.error}</p>
          )}
          <Button
            type="submit"
            disabled={confirmPending}
            className="bg-accent hover:bg-accent/90 text-white"
          >
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
        <>
          <Button onClick={handleDisable} disabled={disabling} variant="destructive">
            {disabling ? "กำลังปิดใช้งาน…" : "ปิดใช้งาน 2FA"}
          </Button>
          {disableError && <p className="text-sm text-destructive font-medium">{disableError}</p>}
        </>
      ) : (
        <Button
          onClick={startEnrollment}
          disabled={starting}
          className="bg-accent hover:bg-accent/90 text-white"
        >
          {starting ? "กำลังเริ่ม…" : "เปิดใช้งาน 2FA"}
        </Button>
      )}
      {enrollError && <p className="text-sm text-destructive font-medium">{enrollError}</p>}
    </div>
  );
}
