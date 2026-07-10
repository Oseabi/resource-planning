import { SidebarContent } from "@/components/layout/sidebar-content";

/**
 * Desktop sidebar. Hidden below md, where `MobileNav` takes over with a drawer.
 */
export function SidebarNav({
  fullName,
  roleLabel,
}: {
  fullName: string;
  roleLabel: string;
}) {
  return (
    <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <SidebarContent fullName={fullName} roleLabel={roleLabel} />
    </aside>
  );
}
