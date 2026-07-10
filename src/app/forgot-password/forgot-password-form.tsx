"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/app/forgot-password/actions";

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(requestPasswordReset, {
    sent: false,
    error: null,
  });

  if (state.sent) {
    return (
      <div className="space-y-4">
        <p className="text-body-sm text-foreground">
          If an account exists for that email, a password reset link has been sent.
        </p>
        <Link href="/login" className="text-body-sm text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {state.error && <p className="text-body-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Sending..." : "Send reset link"}
      </Button>
      <div className="text-center">
        <Link href="/login" className="text-body-sm text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    </form>
  );
}
