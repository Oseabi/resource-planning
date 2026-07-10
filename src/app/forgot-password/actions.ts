"use server";

import { createClient } from "@/lib/supabase/server";

export type ForgotPasswordState = { sent: boolean; error: string | null };

export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "");
  const supabase = await createClient();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/reset-password`,
  });

  if (error) {
    return { sent: false, error: "Could not send reset email. Please try again." };
  }

  return { sent: true, error: null };
}
