import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { confirmUrl, type ConfirmType } from "@/lib/auth/links";

/**
 * A one-time sign-in link for an account, minted here and mailed by the
 * app.
 *
 * Supabase's own mailer is built for development: it delivers only to the
 * project's team and a few messages an hour, which is why an invitation or
 * a reset "never arrived". This asks Supabase for the token alone, through
 * the service role, and hands back the app's own link for Resend to send.
 * The token is the only secret in it and it works once; nothing else about
 * the account leaves.
 */
export async function signInLinkFor(email: string, type: ConfirmType): Promise<{ link: string } | { error: string }> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return { error: "NEXT_PUBLIC_APP_URL is not set, so there is no address to link to." };

  const { data, error } = await createAdminClient().auth.admin.generateLink({ type, email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return { error: error?.message ?? "Supabase returned no token." };

  return { link: confirmUrl(appUrl, tokenHash, type) };
}
