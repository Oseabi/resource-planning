import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CreateUserDialog } from "@/app/(app)/settings/users/create-user-dialog";
import { ResetPasswordDialog } from "@/app/(app)/settings/users/reset-password-dialog";
import { RoleSelect } from "@/app/(app)/settings/users/role-select";

export default async function UsersSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: currentProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (currentProfile?.role !== "admin") {
    return (
      <div>
        <h1 className="text-display font-semibold text-foreground">User Management</h1>
        <p className="mt-2 text-body-md text-muted-foreground">
          Only admins can manage users and roles.
        </p>
      </div>
    );
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, must_change_password, created_at")
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-display font-semibold text-foreground">User Management</h1>
          <p className="mt-1 text-body-lg text-muted-foreground">
            Manage platform access, roles, and accounts for your team.
          </p>
        </div>
        <CreateUserDialog />
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User name</TableHead>
              <TableHead>Email address</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(profiles ?? []).map((profile) => (
              <TableRow key={profile.id}>
                <TableCell className="font-medium">{profile.full_name}</TableCell>
                <TableCell className="text-muted-foreground">{profile.email}</TableCell>
                <TableCell>
                  <RoleSelect
                    userId={profile.id}
                    role={profile.role}
                    disabled={profile.id === user.id}
                  />
                </TableCell>
                <TableCell>
                  {profile.must_change_password ? (
                    <Badge variant="outline">Pending first login</Badge>
                  ) : (
                    <Badge className="bg-success text-success-foreground">Active</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <ResetPasswordDialog userId={profile.id} email={profile.email} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
