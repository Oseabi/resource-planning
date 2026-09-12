import "server-only";
import { buildTenderPrompt, coerceTenderAi, truncateTenderText, TENDER_SCHEMA, type TenderAiFields } from "@/lib/extraction/tender-ai";

/**
 * The one network call in tender extraction, kept as thin as it can be.
 *
 * Same shape as ai-extractor.ts: gated on an environment variable read at
 * call time, direct fetch with no SDK, and every failure returned as data
 * rather than thrown. The upload must never fail because this did.
 *
 * Gated on GEMINI_API_KEY alone. With it set, a tender document that is
 * uploaded is sent to Google's Gemini API, as the PDF itself when it is one
 * and as text otherwise; with it unset nothing leaves and the local parser
 * does all the work. The free tier's terms allow Google to use what is sent
 * to improve its models, which is fine for a public procurement notice and
 * is the reason a confidential client document should not be uploaded with
 * the key set. Every send is recorded in the audit trail.
 */

/**
 * The model, read at call time so a deployment can move to a newer one
 * without a change here. The default is the one Google's API itself pointed
 * new keys at when it retired gemini-2.5-flash.
 */
export const geminiModel = (): string => process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
export const geminiEndpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
/** A long document takes a while to read; the route allows sixty seconds in all. */
const TIMEOUT_MS = 50_000;
/** Base64 grows a file by a third, and the request may not pass twenty megabytes. */
const MAX_PDF_BYTES = 14 * 1024 * 1024;

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export type TenderAiResult =
  | { ok: true; fields: TenderAiFields; truncated: boolean; note?: string; usage?: { promptTokens: number; outputTokens: number } }
  | { ok: false; reason: string };

export interface TenderDocument {
  /** The document's text, for a .docx or as the fallback when the PDF is too large to send. */
  text: string;
  /** The PDF's own bytes, sent as the document so the model reads its tables as tables. */
  pdf?: Buffer | null;
  filename?: string;
}

/**
 * What goes over the wire, minus the key. Built here rather than in the
 * caller so the bench sends exactly what the app sends.
 */
export function buildTenderRequest(
  doc: TenderDocument,
  { thinking = true }: { thinking?: boolean } = {},
): { body: Record<string, unknown>; truncated: boolean; asPdf: boolean } {
  const asPdf = !!doc.pdf && doc.pdf.length > 0 && doc.pdf.length <= MAX_PDF_BYTES;
  const { text, truncated } = asPdf ? { text: "", truncated: false } : truncateTenderText(doc.text);
  const parts: Record<string, unknown>[] = [{ text: buildTenderPrompt() }];
  if (asPdf) {
    parts.push({ inlineData: { mimeType: "application/pdf", data: doc.pdf!.toString("base64") } });
  } else {
    parts.push({ text: `\n\nDOCUMENT:\n${text}` });
  }
  return {
    asPdf,
    truncated,
    body: {
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: TENDER_SCHEMA,
        maxOutputTokens: 8192,
        // Reading, not reasoning: at the low level the model spends no
        // thinking tokens on this, which on the CV side were what cut the
        // answer off. A model generation that does not know the setting
        // refuses the request, and the call is made again without it.
        ...(thinking ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
      },
    },
  };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { code?: number; message?: string; status?: string; details?: { retryDelay?: string }[] };
}

/**
 * The JSON in a model answer that may have been cut off: closed as far as
 * it goes. The brackets still open are tracked through the text, an
 * unfinished string or key is dropped, and the brackets are closed in
 * order; the reader treats every field as optional, so whatever was
 * complete is kept.
 */
function parseAnswer(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (const ch of text) {
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") stack.pop();
    }
    if (stack.length === 0) return null;
    let closed = inString ? text + '"' : text;
    // A value that never came: a trailing comma, or a key with nothing after it.
    closed = closed.replace(/,\s*$/, "").replace(/"[^"]*"\s*:\s*$/, "").replace(/,\s*$/, "");
    while (stack.length) closed += stack.pop() === "{" ? "}" : "]";
    try {
      return JSON.parse(closed);
    } catch {
      return null;
    }
  }
}

/**
 * Ask the model to read a tender document.
 *
 * The answer is coerced field by field, because a schema is a promise about
 * the model and not about the network in between, and an answer cut off at
 * the output limit is used as far as it goes rather than thrown away.
 */
export async function extractTenderWithGemini(doc: TenderDocument): Promise<TenderAiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, reason: "GEMINI_API_KEY is not set" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const send = (thinking: boolean) => {
    const { body, truncated } = buildTenderRequest(doc, { thinking });
    return fetch(geminiEndpoint(geminiModel()), {
      method: "POST",
      signal: controller.signal,
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (res) => ({ res, truncated, data: (await res.json().catch(() => null)) as GeminiResponse | null }));
  };

  try {
    let { res, data, truncated } = await send(true);
    // The thinking setting is the one part of the request that differs
    // between model generations. Refused, it is dropped and the call made
    // once more, rather than a whole generation of models being unusable.
    if (res.status === 400 && /argument/i.test(data?.error?.message ?? "")) {
      ({ res, data, truncated } = await send(false));
    }

    if (res.status === 429) {
      const retry = data?.error?.details?.find((d) => d.retryDelay)?.retryDelay;
      return { ok: false, reason: `Gemini rate limit reached${retry ? `, try again in ${retry}` : ""}` };
    }
    if (!res.ok) {
      const message = data?.error?.message ?? "";
      return { ok: false, reason: `Gemini ${res.status}: ${message.slice(0, 200)}` };
    }
    if (data?.promptFeedback?.blockReason) {
      return { ok: false, reason: `Gemini declined the document: ${data.promptFeedback.blockReason}` };
    }

    const candidate = data?.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) return { ok: false, reason: "Gemini returned no content" };

    const parsed = parseAnswer(text);
    if (parsed === null) return { ok: false, reason: "Gemini returned something that was not JSON" };

    const cutOff = candidate?.finishReason === "MAX_TOKENS";
    return {
      ok: true,
      fields: coerceTenderAi(parsed),
      truncated,
      ...(cutOff ? { note: "The AI's answer ran past its length limit; what it did give was used and the local parser filled the gaps." } : {}),
      usage: {
        promptTokens: data?.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data?.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, reason: `Gemini did not answer within ${TIMEOUT_MS / 1000}s` };
    }
    return { ok: false, reason: e instanceof Error ? e.message : "Gemini call failed" };
  } finally {
    clearTimeout(timer);
  }
}
