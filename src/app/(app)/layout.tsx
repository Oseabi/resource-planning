import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Topbar } from "@/components/layout/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Cached for the whole render, so pages that also need the user or their role
  // reuse this instead of issuing their own auth + profile round-trips.
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  // Enforced here rather than in middleware, which would cost a profiles query
  // on every request. /set-password is outside (app), so this cannot loop.
  if (profile.mustChangePassword) {
    redirect("/set-password");
  }

  const fullName = profile.fullName;
  const roleLabel = profile.isAdmin ? "Admin" : "Recruiter";

  return (
    <div className="flex h-screen">
      <SidebarNav fullName={fullName} roleLabel={roleLabel} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar fullName={fullName} roleLabel={roleLabel} />
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-background p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
