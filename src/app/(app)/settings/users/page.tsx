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
import { DeleteUserDialog } from "@/app/(app)/settings/users/delete-user-dialog";

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
        {/* Desktop: table */}
        <div className="hidden md:block">
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
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      <ResetPasswordDialog userId={profile.id} email={profile.email} />
                      <DeleteUserDialog
                        userId={profile.id}
                        fullName={profile.full_name}
                        email={profile.email}
                        disabled={profile.id === user.id}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile: stacked cards */}
        <ul className="divide-y divide-border md:hidden">
          {(profiles ?? []).map((profile) => (
            <li key={profile.id} className="space-y-3 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">{profile.full_name}</div>
                  <div className="truncate text-body-sm text-muted-foreground">{profile.email}</div>
                </div>
                {profile.must_change_password ? (
                  <Badge variant="outline" className="shrink-0">Pending first login</Badge>
                ) : (
                  <Badge className="shrink-0 bg-success text-success-foreground">Active</Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <RoleSelect userId={profile.id} role={profile.role} disabled={profile.id === user.id} />
                <div className="flex items-center gap-2">
                  <ResetPasswordDialog userId={profile.id} email={profile.email} />
                  <DeleteUserDialog
                    userId={profile.id}
                    fullName={profile.full_name}
                    email={profile.email}
                    disabled={profile.id === user.id}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
