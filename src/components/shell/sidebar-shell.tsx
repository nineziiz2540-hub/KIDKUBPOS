"use client";
import { useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  CreditCard,
  ShoppingBag,
  Package,
  Tag,
  FlaskConical,
  Sliders,
  Settings,
  Clock,
  Users,
  Calculator,
  type LucideIcon,
} from "lucide-react";
import { LogoutButton } from "./logout-button";
import { SwitchWorkerButton } from "./switch-worker-button";

// Server Components can't pass component references (functions) to Client
// Components as props — only plain, serializable data. Nav items cross that
// boundary as icon *names*; this map resolves them back to components here,
// client-side.
const ICONS = {
  LayoutDashboard,
  CreditCard,
  ShoppingBag,
  Package,
  Tag,
  FlaskConical,
  Sliders,
  Settings,
  Clock,
  Users,
  Calculator,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

const STORAGE_KEY = "kidkubpos:sidebarExpanded";
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === null ? true : saved === "true";
}

// Server has no localStorage — default to expanded, matching the old lg:
// breakpoint's "full" experience. useSyncExternalStore guarantees the first
// client render also uses this value (no hydration mismatch), then
// re-renders with the real snapshot right after.
function getServerSnapshot() {
  return true;
}

function setExpandedPreference(value: boolean) {
  localStorage.setItem(STORAGE_KEY, String(value));
  listeners.forEach((callback) => callback());
}

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
};

type Props = {
  items: NavItem[];
  userName: string | null;
  role: string;
};

export function SidebarShell({ items, userName, role }: Props) {
  const expanded = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    setExpandedPreference(!expanded);
  }

  return (
    <aside
      className={`hidden md:flex relative flex-col h-full shrink-0 bg-sidebar border-r border-white/10 transition-all duration-200 ${
        expanded ? "w-56" : "w-16"
      }`}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={expanded ? "ย่อเมนู" : "ขยายเมนู"}
        className="absolute -right-3 top-14 z-10 w-6 h-6 rounded-full bg-sidebar border border-white/20 text-white/70 hover:text-white hover:border-white/40 flex items-center justify-center transition-colors"
      >
        {expanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>

      <div
        className={`flex items-center h-14 px-4 border-b border-white/10 shrink-0 ${
          expanded ? "justify-start" : "justify-center"
        }`}
      >
        <span className={`text-accent font-bold text-xl ${expanded ? "inline" : "hidden"}`}>
          KIDKUBPOS
        </span>
        <span className={`text-accent font-bold text-lg ${expanded ? "hidden" : "inline"}`}>
          K
        </span>
      </div>
      <nav className="flex-1 py-4 flex flex-col gap-1 px-2 overflow-y-auto">
        {items.map(({ href, label, icon }) => {
          const Icon = ICONS[icon];
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 h-10 px-2 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              <Icon size={20} className="shrink-0" />
              {expanded && <span className="text-sm font-medium">{label}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-2 py-3">
        {expanded && (
          <div className="px-2 pb-2">
            <p className="text-xs text-white/50 truncate">{userName ?? "—"}</p>
            <p className="text-xs text-accent font-medium capitalize">{role}</p>
          </div>
        )}
        <SwitchWorkerButton expanded={expanded} />
        <LogoutButton expanded={expanded} />
      </div>
    </aside>
  );
}
