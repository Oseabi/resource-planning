import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileNav } from "@/components/layout/mobile-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { GlobalSearch } from "@/components/layout/global-search";
import { DepartmentSwitcher } from "@/components/layout/department-switcher";
import type { DepartmentBrand } from "@/lib/departments";

export function Topbar({
  fullName,
  roleLabel,
  isAdmin,
  departments = [],
  lensSlug = null,
}: {
  fullName: string;
  roleLabel: string;
  isAdmin?: boolean;
  /** Only an admin gets the switcher; everybody else wears their own department. */
  departments?: DepartmentBrand[];
  lensSlug?: string | null;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border bg-card px-4 shadow-[0_1px_2px_0_oklch(0.28_0.06_262/0.04)] sm:gap-4 sm:px-6">
      <MobileNav fullName={fullName} roleLabel={roleLabel} isAdmin={isAdmin} />
      <GlobalSearch />
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/job-requirements" />}
          className="hidden sm:inline-flex"
        >
          Match Candidates
        </Button>
        <Button
          nativeButton={false}
          render={<Link href="/candidates" />}
          className="hidden sm:inline-flex"
        >
          Upload CV
        </Button>
        {isAdmin && departments.length > 0 && <DepartmentSwitcher departments={departments} lensSlug={lensSlug} />}
        <ThemeToggle />
        <button
          aria-label="Notifications"
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent"
        >
          <Bell className="size-4" />
        </button>
      </div>
    </header>
  );
}
