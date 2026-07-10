import "server-only";

/**
 * Minimal Resend email sender via the REST API (no SDK dependency).
 * Gated on RESEND_API_KEY — returns { configured: false } when no key is set,
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
  const subject = `Match alert: ${candidateName} — ${score}% for ${requirementTitle}`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#131b2e;line-height:1.5">
      <h2 style="margin:0 0 8px">Strong candidate match (${score}%)</h2>
      <p style="margin:0 0 12px;color:#434655">
        <strong>${candidateName}</strong>${candidateRole ? ` — ${candidateRole}` : ""}
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
