import { getProfile, type Role } from "@/lib/dal";
import { SidebarShell, type NavItem } from "./sidebar-shell";

const allNavItems: (NavItem & { minRole: Role })[] = [
  { href: "/", label: "Dashboard", icon: "LayoutDashboard", minRole: "staff" },
  { href: "/pos", label: "POS", icon: "CreditCard", minRole: "staff" },
  { href: "/orders", label: "Orders", icon: "ShoppingBag", minRole: "staff" },
  { href: "/shifts", label: "Shifts", icon: "Clock", minRole: "staff" },
  { href: "/products", label: "Products", icon: "Package", minRole: "manager" },
  { href: "/categories", label: "Categories", icon: "Tag", minRole: "manager" },
  { href: "/inventory", label: "Inventory", icon: "FlaskConical", minRole: "manager" },
  { href: "/modifiers", label: "Modifiers", icon: "Sliders", minRole: "manager" },
  { href: "/customers", label: "Customers", icon: "Users", minRole: "manager" },
  { href: "/pricing-calculator", label: "คำนวณราคาขาย", icon: "Calculator", minRole: "manager" },
  { href: "/settings", label: "Settings", icon: "Settings", minRole: "owner" },
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
    <SidebarShell
      items={visibleItems}
      userName={profile?.full_name ?? null}
      role={role}
    />
  );
}
