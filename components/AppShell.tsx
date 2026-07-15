"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  Boxes,
  ScanLine,
  Truck,
  ClipboardList,
  AlertTriangle,
  BarChart3,
  Users,
  Upload,
  ShieldCheck,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { ROLE_LABELS } from "@/lib/roles";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  roles?: string[];
  extraCheck?: (role?: string, canReceiveParts?: boolean) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Inventory", icon: Boxes },
  {
    href: "/warehouse/receiving",
    label: "Receiving",
    icon: ScanLine,
    extraCheck: (role, canReceiveParts) => role === "SUPER_ADMIN" || !!canReceiveParts,
  },
  {
    href: "/truck/checkout",
    label: "Truck checkout",
    icon: Truck,
    roles: ["SUPER_ADMIN", "ADMIN", "TRUCK_TECH"],
  },
  { href: "/truck/inventory", label: "Truck inventory", icon: ClipboardList },
  {
    href: "/manager/trucks",
    label: "Manage trucks",
    icon: Truck,
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"],
  },
  {
    href: "/manager/justifications",
    label: "Overage justifications",
    icon: AlertTriangle,
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"],
  },
  {
    href: "/manager/reports",
    label: "Usage reports",
    icon: BarChart3,
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "WAREHOUSE_MANAGER"],
  },
  {
    href: "/manager/audit",
    label: "Inventory audit",
    icon: ShieldCheck,
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "WAREHOUSE_MANAGER"],
  },
  {
    href: "/admin/users",
    label: "Users & permissions",
    icon: Users,
    roles: ["SUPER_ADMIN", "ADMIN"],
  },
  {
    href: "/admin/import",
    label: "Mass import",
    icon: Upload,
    roles: ["SUPER_ADMIN"],
  },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (pathname === "/login") return <>{children}</>;

  const role = (session?.user as { role?: string; canReceiveParts?: boolean } | undefined)?.role;
  const canReceiveParts = (session?.user as { canReceiveParts?: boolean } | undefined)?.canReceiveParts;
  const userName = (session?.user as { name?: string } | undefined)?.name;
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.extraCheck) return item.extraCheck(role, canReceiveParts);
    return !item.roles || (role && item.roles.includes(role));
  });

  return (
    <div className="min-h-screen bg-nexus-paper md:flex">
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-nexus-line bg-white/95 px-4 py-3 backdrop-blur md:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="tap-target -ml-2 rounded-lg px-2 text-nexus-navy"
        >
          <Menu size={22} />
        </button>
        <span className="font-display font-bold text-nexus-navy">Nexus Inventory</span>
        <div className="w-8" />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="flex w-72 flex-col bg-nexus-navy px-4 py-6 text-white">
            <div className="flex items-center justify-between">
              <span className="font-display text-lg font-bold">Nexus Inventory</span>
              <button onClick={() => setDrawerOpen(false)} aria-label="Close menu" className="tap-target px-2">
                <X size={20} />
              </button>
            </div>
            <SidebarLinks items={visibleItems} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            <UserFooter userName={userName} role={role} />
          </div>
          <div className="flex-1 bg-nexus-navydark/50" onClick={() => setDrawerOpen(false)} />
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-shrink-0 flex-col bg-nexus-navy px-4 py-6 text-white md:flex">
        <p className="font-display text-lg font-bold">Nexus Inventory</p>
        <SidebarLinks items={visibleItems} pathname={pathname} />
        <UserFooter userName={userName} role={role} />
      </aside>

      <main className="min-h-screen flex-1">{children}</main>
    </div>
  );
}

function SidebarLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="mt-6 flex flex-1 flex-col gap-0.5">
      {items.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`tap-target flex items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
              active ? "bg-white/15 font-medium text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <Icon size={18} strokeWidth={2} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserFooter({ userName, role }: { userName?: string; role?: string }) {
  return (
    <div className="mt-auto border-t border-white/10 pt-4">
      {userName && (
        <div className="px-1 pb-3">
          <p className="text-sm font-medium text-white">{userName}</p>
          {role && <p className="text-xs text-white/50">{ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role}</p>}
        </div>
      )}
      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="tap-target flex w-full items-center gap-2 rounded-lg border border-white/20 px-3 text-sm text-white/80 hover:bg-white/10"
      >
        <LogOut size={16} />
        Sign out
      </button>
    </div>
  );
}
