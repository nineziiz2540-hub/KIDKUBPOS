"use client";
import { useEffect, useRef } from "react";
import { useToastManager } from "@/components/ui/toast";

export function MfaRecoveredToastTrigger() {
  const toastManager = useToastManager();
  const toastManagerRef = useRef(toastManager);
  useEffect(() => {
    toastManagerRef.current = toastManager;
  });

  useEffect(() => {
    // type: "error" is deliberate, not a miscategorization — this toast component only renders a
    // distinct (red) style for "error", everything else renders identically to a plain success
    // toast (see src/components/ui/toast.tsx). "2FA just got disabled" needs the alert styling,
    // not a green checkmark. The component also doesn't render a description field at all, so the
    // full message has to fit in the title.
    toastManagerRef.current.add({
      title: "กู้คืนบัญชีด้วยรหัสสำรองสำเร็จ — 2FA ถูกปิดใช้งานแล้ว ไปที่ตั้งค่าเพื่อเปิดใช้งานใหม่",
      type: "error",
    });
  }, []);

  return null;
}
