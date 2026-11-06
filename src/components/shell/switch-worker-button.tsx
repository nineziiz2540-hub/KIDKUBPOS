"use client";
import { switchWorker } from "@/app/actions/job-level";
import { usePosOnline } from "@/lib/offline/status-store";
import { Repeat } from "lucide-react";

type Props = { expanded?: boolean };

const OFFLINE_REASON = "ใช้ไม่ได้ตอนเน็ตหลุด";

export function SwitchWorkerButton({ expanded = false }: Props) {
  const online = usePosOnline();
  return (
    <form action={switchWorker}>
      <button
        type="submit"
        disabled={!online}
        title={online ? undefined : OFFLINE_REASON}
        className="flex items-center gap-3 h-10 px-2 w-full rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:cursor-not-allowed disabled:text-white/30 disabled:hover:bg-transparent disabled:hover:text-white/30"
        aria-label="สลับผู้ใช้งาน"
      >
        <Repeat size={20} className="shrink-0" />
        {expanded && (
          <span className="min-w-0 text-left">
            <span className="block text-sm font-medium leading-4">สลับผู้ใช้งาน</span>
            {!online && <span className="block text-[10px] leading-3">{OFFLINE_REASON}</span>}
          </span>
        )}
      </button>
    </form>
  );
}
