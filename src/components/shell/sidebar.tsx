import Link from "next/link";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  BarChart3,
  Settings,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/orders", label: "Orders", icon: ShoppingCart },
  { href: "/products", label: "Products", icon: Package },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Sidebar() {
  return (
    <aside className="hidden md:flex flex-col w-16 lg:w-56 h-full shrink-0 bg-sidebar border-r border-white/10">
      <div className="flex items-center justify-center lg:justify-start h-14 px-4 border-b border-white/10 shrink-0">
        <span className="text-accent font-bold text-xl hidden lg:inline">KIDKUBPOS</span>
        <span className="text-accent font-bold text-lg lg:hidden">K</span>
      </div>
      <nav className="flex-1 py-4 flex flex-col gap-1 px-2 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 h-10 px-2 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Icon size={20} className="shrink-0" />
            <span className="hidden lg:inline text-sm font-medium">{label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
