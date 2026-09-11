import "server-only";
import { buildRequestBody, coerceAiFields, type AiFields } from "@/lib/extraction/ai-fields";

/**
 * The one network call in CV extraction, kept as thin as it can be.
 *
 * Same shape as src/lib/email/resend.ts: gated on an environment variable read
 * at call time, direct fetch with no SDK, and every failure returned as data
 * rather than thrown. The upload must never fail because this did.
 *
 * Gated on GROQ_API_KEY alone. That is the whole switch: a CV that is not on
 * the TiPP template leaves for Groq's servers in the United States when the
 * key is set, and nothing leaves when it is not. It stays unset until whoever
 * handles POPIA has read Groq's data processing terms and said yes.
 */

export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
/** Long enough for a slow answer, short enough that an upload does not hang. */
const TIMEOUT_MS = 20_000;

export function isAiExtractionConfigured(): boolean {
  return !!process.env.GROQ_API_KEY;
}

export type AiResult =
  | { ok: true; fields: AiFields; truncated: boolean }
  | { ok: false; reason: string };

/**
 * Ask the model to read a CV.
 *
 * Contact details are removed before the text leaves, and the text is capped
 * so one long document cannot spend the whole per-minute budget. The answer is
 * coerced field by field, because strict mode is a promise about the model
 * and not about the network in between.
 */
export async function extractWithAi(rawText: string): Promise<AiResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ok: false, reason: "GROQ_API_KEY is not set" };

  const { body, truncated } = buildRequestBody(rawText);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const retry = res.headers.get("retry-after");
      return {
        ok: false,
        reason: `Groq rate limit reached${retry ? `, try again in ${retry}s` : ""}`,
      };
    }
    // One request over the per-minute token budget on its own. Groq answers
    // 413 rather than 429 for that, and it means the CV is long, not busy.
    if (res.status === 413) {
      return { ok: false, reason: "this CV is too long for the AI's per-minute budget" };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `Groq ${res.status}: ${body.slice(0, 200)}` };
    }

    const data = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string | null } }[];
    } | null;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return { ok: false, reason: "Groq returned no content" };

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, reason: "Groq returned something that was not JSON" };
    }

    return { ok: true, fields: coerceAiFields(parsed), truncated };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, reason: `Groq did not answer within ${TIMEOUT_MS / 1000}s` };
    }
    return { ok: false, reason: e instanceof Error ? e.message : "Groq call failed" };
  } finally {
    clearTimeout(timer);
  }
}
