"use server";

import { createClient } from "@/lib/supabase/server";
import { isEmailConfigured, sendPasswordResetEmail } from "@/lib/email/resend";
import { signInLinkFor } from "@/lib/auth/sign-in-links";

export type ForgotPasswordState = { sent: boolean; error: string | null };

/**
 * Send a reset link.
 *
 * Through Resend when the app can send mail: Supabase's own mailer, which
 * the fallback below uses, delivers only to the project's team and a few
 * messages an hour, and a reset that never arrives is the one email people
 * are certain to be waiting for. The answer is the same whether or not an
 * account exists, so this page cannot be used to find out who has one.
 */
export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { sent: false, error: "Enter your email address." };

  if (isEmailConfigured()) {
    const link = await signInLinkFor(email, "recovery");
    // No account: nothing to send, and nothing to say about it.
    if ("error" in link) return { sent: true, error: null };
    const result = await sendPasswordResetEmail({ to: email, link: link.link });
    if (result.configured && !result.ok) {
      console.error(`[password reset] could not email ${email}: ${result.error}`);
      return { sent: false, error: "Could not send the reset email. Please try again, or ask an admin." };
    }
    return { sent: true, error: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/reset-password`,
  });

  if (error) {
    return { sent: false, error: "Could not send reset email. Please try again." };
  }

  return { sent: true, error: null };
}
