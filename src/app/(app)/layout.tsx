import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Topbar } from "@/components/layout/topbar";
import { SessionHeartbeat } from "@/app/(app)/session-heartbeat";

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
  // Says which lens the whole app is being seen through. Without it, a manager
  // whose colleague's bid is missing from the list has nothing on screen
  // telling them the list is scoped at all.
  const base = profile.isAdmin ? "Admin" : profile.role === "manager" ? "Manager" : "Recruiter";
  const roleLabel = profile.departmentName ? `${base} · ${profile.departmentName}` : base;

  return (
    <div className="flex h-screen">
      {/* Renders nothing. In the layout so it survives navigation. */}
      <SessionHeartbeat />
      <SidebarNav fullName={fullName} roleLabel={roleLabel} isAdmin={profile.isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar fullName={fullName} roleLabel={roleLabel} isAdmin={profile.isAdmin} />
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-background p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
