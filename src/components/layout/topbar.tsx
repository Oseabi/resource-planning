import Link from "next/link";
import { Search, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileNav } from "@/components/layout/mobile-nav";

export function Topbar({
  fullName,
  roleLabel,
}: {
  fullName: string;
  roleLabel: string;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border bg-card px-4 shadow-[0_1px_2px_0_oklch(0.28_0.06_262/0.04)] sm:gap-4 sm:px-6">
      <MobileNav fullName={fullName} roleLabel={roleLabel} />
      <div className="relative min-w-0 max-w-md flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          placeholder="Search candidates, skills, or job refs..."
          className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-body-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary"
        />
      </div>
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
