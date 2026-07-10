"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Users,
  UserSquare2,
  FileText,
  BarChart3,
  Settings,
  HelpCircle,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SignOutButton } from "@/components/layout/sign-out-button";

export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/candidates", label: "Candidates", icon: Users },
  { href: "/job-requirements", label: "Job Requirements", icon: UserSquare2 },
  { href: "/tenders", label: "Tenders", icon: FileText },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

/**
 * Inner content shared by the desktop sidebar (`SidebarNav`) and the mobile
 * drawer (`MobileNav`). `onNavigate` lets the drawer close itself when a link
 * is tapped.
 */
export function SidebarContent({
  fullName,
  roleLabel,
  onNavigate,
}: {
  fullName: string;
  roleLabel: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-5">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground text-label-md font-semibold">
          RP
        </div>
        <div className="leading-tight">
          <div className="text-headline-sm font-semibold text-sidebar-foreground">
            Resource Planning
          </div>
          <div className="text-label-sm uppercase tracking-wide text-muted-foreground">
            Staffing Intelligence
          </div>
        </div>
      </div>

      <div className="px-3">
        <Link
          href="/candidates"
          onClick={onNavigate}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-body-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" />
          New Placement
        </Link>
      </div>

      <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-body-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-2 border-primary"
                  : "text-sidebar-foreground hover:bg-accent",
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-0.5 border-t border-sidebar-border px-3 py-3">
        <Link
          href="/settings/users"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-body-sm font-medium text-sidebar-foreground transition-colors hover:bg-accent"
        >
          <Settings className="size-4" />
          Settings
        </Link>
        <Link
          href="/support"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-body-sm font-medium text-sidebar-foreground transition-colors hover:bg-accent"
        >
          <HelpCircle className="size-4" />
          Support
        </Link>
      </div>

      <div className="flex items-center justify-between border-t border-sidebar-border px-4 py-3">
        <div className="leading-tight">
          <div className="text-body-sm font-medium text-sidebar-foreground">{fullName}</div>
          <div className="text-label-sm text-muted-foreground">{roleLabel}</div>
        </div>
        <SignOutButton />
      </div>
    </>
  );
}
