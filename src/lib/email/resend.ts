import "server-only";

/**
 * Minimal Resend email sender via the REST API (no SDK dependency).
 * Gated on RESEND_API_KEY, returns { configured: false } when no key is set,
 * so the app runs fully without email configured.
 */

export type SendResult =
  | { configured: false }
  | { configured: true; ok: true; id: string | null }
  | { configured: true; ok: false; error: string };

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
}

async function sendEmail({ to, subject, html }: SendEmailArgs): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { configured: false };

  const from = process.env.RESEND_FROM ?? "Resource Planning <onboarding@resend.dev>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { configured: true, ok: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { configured: true, ok: true, id: data.id ?? null };
  } catch (e) {
    return { configured: true, ok: false, error: e instanceof Error ? e.message : "Send failed" };
  }
}

/** Text as it goes into an HTML email, with nothing in it read as markup. */
const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const button = (href: string, label: string) =>
  `<a href="${escapeHtml(href)}" style="background:#004ac6;color:#fff;padding:8px 14px;border-radius:4px;text-decoration:none">${label}</a>`;

const footer = `<p style="margin:0;color:#737686;font-size:12px">Sent by Resource Planning · Staffing Intelligence</p>`;

export interface InviteEmailArgs {
  to: string;
  fullName: string;
  /** Who is inviting them, so the email is from a person they know and not a system. */
  invitedBy: string;
  link: string;
}

/** The invitation a new account gets: one link that signs them in and asks them to choose a password. */
export async function sendInviteEmail({ to, fullName, invitedBy, link }: InviteEmailArgs): Promise<SendResult> {
  const subject = `${invitedBy} has invited you to Resource Planning`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#131b2e;line-height:1.5">
      <h2 style="margin:0 0 8px">Welcome, ${escapeHtml(fullName)}</h2>
      <p style="margin:0 0 12px;color:#434655">
        ${escapeHtml(invitedBy)} has set up an account for you on TiPP Focus Resource Planning.
        The button below signs you in and asks you to choose a password.
      </p>
      <p style="margin:0 0 16px">${button(link, "Choose a password and sign in")}</p>
      <p style="margin:0 0 16px;color:#434655;font-size:13px">
        The link works once and for a limited time. If it has expired, open the sign-in page and use
        Forgot password with this email address to get a fresh one.
      </p>
      ${footer}
    </div>`;
  return sendEmail({ to, subject, html });
}

/** The reset a person asks for from the sign-in page. */
export async function sendPasswordResetEmail({ to, link }: { to: string; link: string }): Promise<SendResult> {
  const subject = "Reset your Resource Planning password";
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#131b2e;line-height:1.5">
      <h2 style="margin:0 0 8px">Reset your password</h2>
      <p style="margin:0 0 12px;color:#434655">
        Somebody asked to reset the password for this account. If that was you, the button below
        signs you in and lets you choose a new one. If it was not, nothing changes and you can
        ignore this email.
      </p>
      <p style="margin:0 0 16px">${button(link, "Choose a new password")}</p>
      <p style="margin:0 0 16px;color:#434655;font-size:13px">The link works once and for a limited time.</p>
      ${footer}
    </div>`;
  return sendEmail({ to, subject, html });
}

export interface MatchAlertArgs {
  to: string;
  candidateName: string;
  candidateRole: string | null;
  requirementTitle: string;
  client: string | null;
  score: number;
  appUrl: string;
  candidateId: string;
}

/** Send a "strong candidate match" alert to a requirement's manager. */
export async function sendMatchAlert(args: MatchAlertArgs): Promise<SendResult> {
  const { to, candidateName, candidateRole, requirementTitle, client, score, appUrl, candidateId } =
    args;
  const subject = `Match alert: ${candidateName}, ${score}% for ${requirementTitle}`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#131b2e;line-height:1.5">
      <h2 style="margin:0 0 8px">Strong candidate match (${score}%)</h2>
      <p style="margin:0 0 12px;color:#434655">
        <strong>${candidateName}</strong>${candidateRole ? `, ${candidateRole}` : ""}
        scored <strong>${score}%</strong> against
        <strong>${requirementTitle}</strong>${client ? ` (${client})` : ""}.
      </p>
      <p style="margin:0 0 16px">
        <a href="${appUrl}/candidates/${candidateId}"
           style="background:#004ac6;color:#fff;padding:8px 14px;border-radius:4px;text-decoration:none">
          View candidate
        </a>
      </p>
      <p style="margin:0;color:#737686;font-size:12px">Sent by Resource Planning · Staffing Intelligence</p>
    </div>`;
  return sendEmail({ to, subject, html });
}
