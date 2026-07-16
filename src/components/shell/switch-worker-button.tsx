"use client";
import { switchWorker } from "@/app/actions/job-level";
import { Repeat } from "lucide-react";

export function SwitchWorkerButton() {
  return (
    <form action={switchWorker}>
      <button
        type="submit"
        className="flex items-center gap-3 h-10 px-2 w-full rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="สลับผู้ใช้งาน"
      >
        <Repeat size={20} className="shrink-0" />
        <span className="hidden lg:inline text-sm font-medium">สลับผู้ใช้งาน</span>
      </button>
    </form>
  );
}
