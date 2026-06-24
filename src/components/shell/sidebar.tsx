import Link from "next/link";
import {
  LayoutDashboard,
  CreditCard,
  ShoppingBag,
  Package,
  Tag,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { LogoutButton } from "./logout-button";
import { getProfile, type Role } from "@/lib/dal";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  minRole: Role;
};

const allNavItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, minRole: "staff" },
  { href: "/pos", label: "POS", icon: CreditCard, minRole: "staff" },
  { href: "/orders", label: "Orders", icon: ShoppingBag, minRole: "staff" },
  { href: "/products", label: "Products", icon: Package, minRole: "staff" },
  { href: "/categories", label: "Categories", icon: Tag, minRole: "manager" },
  { href: "/reports", label: "Reports", icon: BarChart3, minRole: "manager" },
  { href: "/settings", label: "Settings", icon: Settings, minRole: "owner" },
];

function getRoleLevel(role: Role): number {
  switch (role) {
    case "owner":
      return 3;
    case "manager":
      return 2;
    case "staff":
      return 1;
  }
}

function canAccess(userRole: Role, minRole: Role): boolean {
  return getRoleLevel(userRole) >= getRoleLevel(minRole);
}

export async function Sidebar() {
  const profile = await getProfile();
  const role = (profile?.role ?? "staff") as Role;
  const visibleItems = allNavItems.filter((item) =>
    canAccess(role, item.minRole)
  );

  return (
    <aside className="hidden md:flex flex-col w-16 lg:w-56 h-full shrink-0 bg-sidebar border-r border-white/10">
      <div className="flex items-center justify-center lg:justify-start h-14 px-4 border-b border-white/10 shrink-0">
        <span className="text-accent font-bold text-xl hidden lg:inline">
          KIDKUBPOS
        </span>
        <span className="text-accent font-bold text-lg lg:hidden">K</span>
      </div>
      <nav className="flex-1 py-4 flex flex-col gap-1 px-2 overflow-y-auto">
        {visibleItems.map(({ href, label, icon: Icon }) => (
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
      <div className="border-t border-white/10 px-2 py-3">
        <div className="hidden lg:block px-2 pb-2">
          <p className="text-xs text-white/50 truncate">
            {profile?.full_name ?? "—"}
          </p>
          <p className="text-xs text-accent font-medium capitalize">{role}</p>
        </div>
        <LogoutButton />
      </div>
    </aside>
  );
}
