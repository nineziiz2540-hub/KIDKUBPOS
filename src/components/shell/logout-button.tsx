"use client";
import { useState, useTransition } from "react";
import { signOut } from "@/app/actions/auth";
import { usePendingCount } from "@/lib/offline/status-store";
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
  const { pending } = usePendingCount(tenantId ?? undefined);
  const [confirming, setConfirming] = useState(false);
  const [busy, startTransition] = useTransition();

  // Without a tenant there is nothing to scope the warning to, so it never blocks the logout.
  const mustWarn = tenantId !== null && pending > 0;

  function logout() {
    startTransition(async () => {
      await dropPosShellCache();
      await signOut();
    });
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => (mustWarn ? setConfirming(true) : logout())}
        className="flex items-center gap-3 h-10 px-2 w-full rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="ออกจากระบบ"
      >
        <LogOut size={20} className="shrink-0" />
        {expanded && <span className="text-sm font-medium">ออกจากระบบ</span>}
      </button>
      {confirming && (
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
                disabled={busy}
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
