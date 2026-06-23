import { Menu } from "lucide-react";
import { LogoutButton } from "./logout-button";

export function Topbar() {
  return (
    <header className="flex md:hidden items-center gap-4 h-14 px-4 bg-sidebar border-b border-white/10 sticky top-0 z-10 shrink-0">
      <button
        type="button"
        aria-label="Open menu"
        className="text-white/70 hover:text-white transition-colors"
      >
        <Menu size={22} />
      </button>
      <span className="text-accent font-bold text-lg flex-1">KIDKUBPOS</span>
      <LogoutButton />
    </header>
  );
}
