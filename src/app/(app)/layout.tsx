import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Topbar } from "@/components/layout/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  const fullName = profile?.full_name ?? user.email ?? "User";
  const roleLabel = profile?.role === "admin" ? "Admin" : "Recruiter";

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
