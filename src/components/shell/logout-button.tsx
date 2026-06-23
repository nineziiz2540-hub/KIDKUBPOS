"use client";
import { signOut } from "@/app/actions/auth";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="flex items-center gap-3 h-10 px-2 w-full rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="ออกจากระบบ"
      >
        <LogOut size={20} className="shrink-0" />
        <span className="hidden lg:inline text-sm font-medium">ออกจากระบบ</span>
      </button>
    </form>
  );
}
