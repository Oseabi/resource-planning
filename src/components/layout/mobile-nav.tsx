"use client";

import * as React from "react";
import { Menu, X } from "lucide-react";
import { SidebarContent } from "@/components/layout/sidebar-content";
import { cn } from "@/lib/utils";

/**
 * Mobile navigation: a hamburger trigger plus a left slide-in drawer that
 * reuses the desktop sidebar content. Rendered only below md (`md:hidden`).
 */
export function MobileNav({
  fullName,
  roleLabel,
}: {
  fullName: string;
  roleLabel: string;
}) {
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);

  // Close on Escape and lock body scroll while the drawer is open.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={open}
        className="flex size-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent"
      >
        <Menu className="size-5" />
      </button>

      {/* Overlay + drawer. Kept mounted for enter/exit transitions. */}
      <div
        className={cn(
          "fixed inset-0 z-50",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
        aria-hidden={!open}
      >
        <div
          onClick={close}
          className={cn(
            "absolute inset-0 bg-foreground/40 transition-opacity duration-200 ease-out motion-reduce:transition-none",
            open ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          className={cn(
            "absolute inset-y-0 left-0 flex w-72 max-w-[82%] flex-col border-r border-sidebar-border bg-sidebar shadow-pop transition-transform duration-200 ease-out will-change-transform motion-reduce:transition-none",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close navigation menu"
            className="absolute right-3 top-4 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
          >
            <X className="size-4" />
          </button>
          <SidebarContent fullName={fullName} roleLabel={roleLabel} onNavigate={close} />
        </div>
      </div>
    </div>
  );
}
