"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { ROLE_LABELS } from "@/lib/roles";

type NavItem = { href: string; label: string; roles?: string[]; extraCheck?: (role?: string, canReceiveParts?: boolean) => boolean };

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Inventory" },
  {
    href: "/warehouse/receiving",
    label: "Warehouse receiving",
    extraCheck: (role, canReceiveParts) => role === "SUPER_ADMIN" || !!canReceiveParts,
  },
  {
    href: "/truck/checkout",
    label: "Truck checkout",
    roles: ["SUPER_ADMIN", "ADMIN", "TRUCK_TECH"],
  },
  { href: "/truck/inventory", label: "Truck inventory" },
  {
    href: "/manager/trucks",
    label: "Manage trucks",
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"],
  },
  {
    href: "/manager/justifications",
    label: "Overage justifications",
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"],
  },
  {
    href: "/manager/reports",
    label: "Usage reports",
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "WAREHOUSE_MANAGER"],
  },
  {
    href: "/admin/users",
    label: "Users & permissions",
    roles: ["SUPER_ADMIN", "ADMIN"],
  },
  {
    href: "/admin/import",
    label: "Mass import",
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
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.extraCheck) return item.extraCheck(role, canReceiveParts);
    return !item.roles || (role && item.roles.includes(role));
  });

  return (
    <div className="min-h-screen bg-nexus-paper md:flex">
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b-2 border-nexus-steel/15 bg-white px-4 py-3 md:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="tap-target rounded-lg px-3 text-nexus-navy"
        >
          ☰
        </button>
        <span className="font-medium text-nexus-navy">Nexus Inventory</span>
        <div className="w-10" />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="w-72 bg-nexus-navy px-4 py-6 text-white">
            <div className="flex items-center justify-between">
              <span className="text-lg font-medium">Menu</span>
              <button onClick={() => setDrawerOpen(false)} aria-label="Close menu" className="tap-target px-3">
                ✕
              </button>
            </div>
            <SidebarLinks items={visibleItems} pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            <SignOutButton />
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setDrawerOpen(false)} />
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-64 flex-shrink-0 bg-nexus-navy px-4 py-6 text-white md:block">
        <p className="mb-6 text-lg font-medium">Nexus Inventory</p>
        {role && <p className="mb-4 text-xs uppercase tracking-wide text-white/60">{ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role}</p>}
        <SidebarLinks items={visibleItems} pathname={pathname} />
        <SignOutButton />
      </aside>

      <main className="flex-1">{children}</main>
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
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`tap-target flex items-center rounded-lg px-3 text-sm ${
              active ? "bg-white/15 font-medium" : "text-white/80 hover:bg-white/10"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="tap-target mt-6 w-full rounded-lg border border-white/30 text-sm text-white/80"
    >
      Sign out
    </button>
  );
}
