"use client";
import { useEffect, useState, useTransition } from "react";
import { endSession } from "@/app/actions/auth";
import { usePendingCount, useShellOffline } from "@/lib/offline/status-store";
import { LogOut } from "lucide-react";

type Props = { expanded?: boolean; tenantId?: string | null };

/** Best-effort: forget the cached POS page so the next sign-in fetches it fresh (never waits > 1 s). */
async function dropPosShellCache(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const drop = caches
      .open("pos-shell")
      .then((c) => c.delete(location.origin + "/pos"))
      .then(() => undefined);
    await Promise.race([drop, new Promise<void>((r) => setTimeout(r, 1000))]);
  } catch {
    // ignore: logout must never be blocked by the cache
  }
}

export function LogoutButton({ expanded = false, tenantId = null }: Props) {
  const { pending, loaded } = usePendingCount(tenantId ?? undefined);
  const offline = useShellOffline();
  const [waited, setWaited] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, startTransition] = useTransition();

  // Wait for the device count (so the warning can't be missed), but never more than 1 s.
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 1000);
    return () => clearTimeout(t);
  }, []);

  // Nothing left to send: the warning is over for good (adjusting state while rendering).
  if (confirming && pending === 0) setConfirming(false);
  const showWarning = confirming;

  // Logging out needs the network: the session ends first, and only then is the cached POS page
  // dropped, so a failed sign-out can never leave an offline shop without its POS.
  const notReady = !loaded && !waited;

  // Without a tenant there is nothing to scope the warning to, so it never blocks the logout.
  const mustWarn = tenantId !== null && pending > 0;

  function logout() {
    setFailed(false);
    startTransition(async () => {
      try {
        await endSession();
      } catch {
        setFailed(true);
        return;
      }
      await dropPosShellCache();
      window.location.assign("/login");
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={busy || offline || notReady}
        title={offline ? "ใช้ไม่ได้ตอนเน็ตหลุด" : undefined}
        onClick={() => (mustWarn ? setConfirming(true) : logout())}
        className="flex items-center gap-3 h-10 px-2 w-full rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:cursor-not-allowed disabled:text-white/30 disabled:hover:bg-transparent disabled:hover:text-white/30"
        aria-label="ออกจากระบบ"
      >
        <LogOut size={20} className="shrink-0" />
        {expanded && (
          <span className="min-w-0 text-left">
            <span className="block text-sm font-medium leading-4">ออกจากระบบ</span>
            {offline && <span className="block text-[10px] leading-3">ใช้ไม่ได้ตอนเน็ตหลุด</span>}
          </span>
        )}
      </button>
      {failed && <p className="px-2 pt-1 text-xs text-warning">ออกจากระบบไม่สำเร็จ ลองอีกครั้ง</p>}
      {showWarning && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="ออกจากระบบ"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 text-sidebar shadow-xl">
            <p className="text-base font-medium">
              ยังมีบิลค้างส่ง {pending} บิลในเครื่องนี้ · บิลยังอยู่ในเครื่อง และจะส่งเมื่อเข้าสู่ระบบร้านนี้อีกครั้ง
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="h-12 flex-1 rounded-xl border text-base font-semibold hover:bg-muted"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={busy || offline}
                onClick={logout}
                className="h-12 flex-1 rounded-xl bg-destructive text-base font-semibold text-white hover:bg-destructive/90"
              >
                ออกจากระบบ
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
