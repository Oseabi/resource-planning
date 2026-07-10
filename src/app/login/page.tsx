import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/app/login/login-form";

export default function LoginPage() {
  return (
    <AuthShell title="Sign in" description="Enter your credentials to access your account.">
      <LoginForm />
    </AuthShell>
  );
}
