import { AuthShell } from "@/components/auth/auth-shell";
import { SetPasswordForm } from "@/app/set-password/set-password-form";

export default function SetPasswordPage() {
  return (
    <AuthShell
      title="Set a new password"
      description="Your account was created by an admin. Choose your own password to continue."
    >
      <SetPasswordForm />
    </AuthShell>
  );
}
