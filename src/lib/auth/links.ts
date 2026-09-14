/**
 * The links in the app's own sign-in emails.
 *
 * Supabase can mint a one-time token for an account without sending
 * anything, and the app mails the link itself through Resend. The link
 * lands on the app's own confirm route, which trades the token for a
 * session and sends the person on to the page that fits: a new account
 * chooses its password, a forgotten one resets it.
 *
 * Pure, no I/O.
 */

/** The two kinds of token the confirm route trades for a session. */
export type ConfirmType = "magiclink" | "recovery";

export const CONFIRM_PATH = "/auth/confirm";

/** Where each kind of link sends the person once they are signed in. */
export const NEXT_AFTER: Record<ConfirmType, string> = {
  magiclink: "/set-password",
  recovery: "/reset-password",
};

export function isConfirmType(value: string | null): value is ConfirmType {
  return value === "magiclink" || value === "recovery";
}

/** The link that goes in the email: the app's confirm route with the token, the kind and the page after. */
export function confirmUrl(appUrl: string, tokenHash: string, type: ConfirmType): string {
  const url = new URL(CONFIRM_PATH, appUrl.replace(/\/+$/, "") + "/");
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  url.searchParams.set("next", NEXT_AFTER[type]);
  return url.toString();
}

/**
 * A "next" path the confirm route may send someone to: a path on this
 * site and nothing else. A link that could name another host would turn
 * a sign-in email into a way of sending people elsewhere.
 */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\s]/.test(next)) return fallback;
  return next;
}
