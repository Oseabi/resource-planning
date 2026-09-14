import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/app/login/login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const { link } = await searchParams;
  return (
    <AuthShell title="Sign in" description="Enter your credentials to access your account.">
      {/* Where a sign-in link from an email lands once it has expired or been
          used, said here rather than on a reset form with no session behind it. */}
      {link === "expired" && (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-body-sm text-foreground">
          That link has expired or has already been used. Use Forgot password below to get a fresh one,
          or ask an admin to invite you again.
        </p>
      )}
      <LoginForm />
    </AuthShell>
  );
}
