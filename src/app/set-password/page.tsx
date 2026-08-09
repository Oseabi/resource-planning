import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-user";
import { AuthShell } from "@/components/auth/auth-shell";
import { SetPasswordForm } from "@/app/set-password/set-password-form";

export default async function SetPasswordPage() {
  // Middleware used to bounce finished users away from here, but that cost a
  // profiles query on every request app-wide. The check belongs on this page,
  // which is visited once per account.
  const profile = await getCurrentProfile();

  if (profile && !profile.mustChangePassword) {
    redirect("/dashboard");
  }

  return (
    <AuthShell
      title="Set a new password"
      description="Your account was created by an admin. Choose your own password to continue."
    >
      <SetPasswordForm />
    </AuthShell>
  );
}
