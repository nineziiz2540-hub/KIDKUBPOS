"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShellOffline } from "@/lib/offline/status-store";
import { LayoutDashboard, CreditCard, ShoppingBag, Settings } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "แดชบอร์ด", icon: LayoutDashboard },
  { href: "/pos", label: "POS", icon: CreditCard },
  { href: "/orders", label: "ออเดอร์", icon: ShoppingBag },
  { href: "/settings", label: "ตั้งค่า", icon: Settings },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const offline = useShellOffline();

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-sidebar border-t border-white/10 flex h-16"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        if (offline && href !== "/pos") {
          return (
            <span
              key={href}
              role="link"
              aria-disabled="true"
              title="ใช้ไม่ได้ตอนเน็ตหลุด"
              className="flex-1 flex items-center justify-center text-xs text-white/30 cursor-not-allowed"
            >
              <span className="flex flex-col items-center justify-center gap-0.5 px-3 py-1">
                <Icon size={22} />
                <span className="max-w-[5.5rem] text-center text-[9px] leading-3">
                  ใช้ไม่ได้ตอนเน็ตหลุด
                </span>
              </span>
            </span>
          );
        }
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex items-center justify-center text-xs transition-colors ${
              active ? "text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            <span
              className={`flex flex-col items-center justify-center gap-0.5 rounded-full px-3 py-1 ${
                active ? "bg-accent/15" : ""
              }`}
            >
              <Icon size={22} />
              <span>{label}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
