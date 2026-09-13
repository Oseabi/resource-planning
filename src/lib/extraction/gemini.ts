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
 * The models to try, in this order, when GEMINI_MODEL names none.
 *
 * The free tier allows each model twenty requests a day, and a model can be
 * retired, overloaded or slow on any given afternoon. One model is a
 * document that does not get read; three in a row are sixty documents a
 * day and a quiet failover when Google is having a bad one. Ordered by how
 * each read the same set of real tenders: 3.6-flash read every one, 3.7-flash
 * answered "high demand" to half of them on the same morning, and the lite
 * model reads the roles but little of the detail.
 */
export const DEFAULT_GEMINI_MODELS = ["gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.5-flash-lite"] as const;

/** The chain, read at call time: GEMINI_MODEL may name one model or several separated by commas. */
export const geminiModels = (): string[] => {
  const named = (process.env.GEMINI_MODEL ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return named.length > 0 ? named : [...DEFAULT_GEMINI_MODELS];
};
/** The first choice, which is what the audit trail names before the call is made. */
export const geminiModel = (): string => geminiModels()[0];
/** How hard the model thinks before answering: low reads a document well and fast; high for when it does not. */
export const geminiThinkingLevel = (): string => process.env.GEMINI_THINKING?.trim() || "low";
export const geminiEndpoint = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
/** A long document takes a while to read; the route allows sixty seconds in all, shared across the chain. */
const TIMEOUT_MS = 52_000;
/**
 * The most a model gets while another waits behind it. A hundred-page PDF
 * takes a healthy model thirty seconds; one that has not answered in
 * thirty-five is hanging, and the time left is better spent on the next.
 * The last model in the chain gets whatever remains.
 */
const ATTEMPT_MS = 35_000;
/** Below this there is no point starting another model: a document takes ten seconds or more to read. */
const MIN_ATTEMPT_MS = 8_000;
/** Base64 grows a file by a third, and the request may not pass twenty megabytes. */
const MAX_PDF_BYTES = 14 * 1024 * 1024;

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export type TenderAiResult =
  | {
      ok: true;
      /** The model that answered. */
      model: string;
      fields: TenderAiFields;
      truncated: boolean;
      note?: string;
      usage?: { promptTokens: number; outputTokens: number };
      /** Models earlier in the chain that could not, and why. */
      fallbacks: string[];
    }
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
        // Ten seats, each with a paragraph of experience and one of scoring,
        // plus the brief: a few thousand tokens. Room for a thirty-seat RFP.
        maxOutputTokens: 16384,
        // Reading, not reasoning: at the low level the model spends no
        // thinking tokens on this, which on the CV side were what cut the
        // answer off. A model generation that does not know the setting
        // refuses the request, and the call is made again without it.
        ...(thinking ? { thinkingConfig: { thinkingLevel: geminiThinkingLevel() } } : {}),
      },
    },
  };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { retryDelay?: string; violations?: { quotaId?: string; quotaValue?: string }[] }[];
  };
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
 * A 429 in words. The free tier has two limits, a few requests a minute
 * and twenty a day for each model, and the body only says which through a
 * quota id; the retry hint on the daily one says thirty seconds, which is
 * not when it comes back.
 */
function rateLimitReason(data: GeminiResponse | null): string {
  const violations = data?.error?.details?.flatMap((d) => d.violations ?? []) ?? [];
  const daily = violations.find((v) => /PerDay/i.test(v.quotaId ?? ""));
  if (daily) {
    const allowance = daily.quotaValue ? `${daily.quotaValue} requests a day` : "the daily allowance";
    return `daily free limit used up (${allowance} for this model, back at midnight Pacific time)`;
  }
  const retry = data?.error?.details?.find((d) => d.retryDelay)?.retryDelay;
  return `rate limit reached${retry ? `, try again in ${retry}` : ""}`;
}

/** What one model made of the document: an answer, or a reason and whether the next model should be asked. */
type Attempt =
  | { kind: "answered"; data: GeminiResponse; truncated: boolean }
  | { kind: "next" | "stop"; reason: string };

/**
 * Ask the model to read a tender document.
 *
 * The models in the chain are asked in turn until one answers, within one
 * shared time budget. A model that is out of quota, retired or overloaded
 * hands on to the next; a bad key or a dead network stops the chain, since
 * the next model would only say the same. The answer is coerced field by
 * field, because a schema is a promise about the model and not about the
 * network in between, and an answer cut off at the output limit is used as
 * far as it goes rather than thrown away.
 */
export async function extractTenderWithGemini(doc: TenderDocument): Promise<TenderAiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, reason: "GEMINI_API_KEY is not set" };

  const deadline = Date.now() + TIMEOUT_MS;
  // The PDF is base64-encoded once per setting, not once per model.
  const bodies = new Map<boolean, ReturnType<typeof buildTenderRequest>>();
  const request = (thinking: boolean) => {
    let built = bodies.get(thinking);
    if (!built) {
      built = buildTenderRequest(doc, { thinking });
      bodies.set(thinking, built);
    }
    return built;
  };

  const ask = async (model: string, last: boolean): Promise<Attempt> => {
    const controller = new AbortController();
    const allowed = Math.max(0, Math.min(deadline - Date.now(), last ? Infinity : ATTEMPT_MS));
    const timer = setTimeout(() => controller.abort(), allowed);
    const send = async (thinking: boolean) => {
      const { body, truncated } = request(thinking);
      const res = await fetch(geminiEndpoint(model), {
        method: "POST",
        signal: controller.signal,
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { res, truncated, data: (await res.json().catch(() => null)) as GeminiResponse | null };
    };

    try {
      let { res, data, truncated } = await send(true);
      // The thinking setting is the one part of the request that differs
      // between model generations. Refused, it is dropped and the call made
      // once more, rather than a whole generation of models being unusable.
      if (res.status === 400 && /argument/i.test(data?.error?.message ?? "")) {
        ({ res, data, truncated } = await send(false));
      }

      if (res.status === 429) return { kind: "next", reason: rateLimitReason(data) };
      if (!res.ok) {
        const message = (data?.error?.message ?? "").slice(0, 200);
        // Not there, or not coping: the next model may be. Anything else,
        // a bad key say, is true of every model.
        const kind = res.status === 404 || res.status >= 500 ? "next" : "stop";
        return { kind, reason: `${res.status}: ${message}` };
      }
      if (data?.promptFeedback?.blockReason) {
        return { kind: "next", reason: `declined the document: ${data.promptFeedback.blockReason}` };
      }
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      if (!text.trim()) return { kind: "next", reason: "returned no content" };
      return { kind: "answered", data: data!, truncated };
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        return { kind: "next", reason: `did not answer within ${Math.round(allowed / 1000)}s` };
      }
      return { kind: "stop", reason: `could not be reached: ${e instanceof Error ? e.message : "call failed"}` };
    } finally {
      clearTimeout(timer);
    }
  };

  const models = geminiModels();
  const failed: { model: string; reason: string }[] = [];
  let notTried = 0;
  for (const [i, model] of models.entries()) {
    if (i > 0 && deadline - Date.now() < MIN_ATTEMPT_MS) {
      notTried = models.length - i;
      break;
    }
    const attempt = await ask(model, i === models.length - 1);
    if (attempt.kind === "answered") {
      const candidate = attempt.data.candidates?.[0];
      const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      const parsed = parseAnswer(text);
      if (parsed === null) {
        failed.push({ model, reason: "returned something that was not JSON" });
        continue;
      }
      const cutOff = candidate?.finishReason === "MAX_TOKENS";
      return {
        ok: true,
        model,
        fields: coerceTenderAi(parsed),
        truncated: attempt.truncated,
        ...(cutOff ? { note: "The AI's answer ran past its length limit; what it did give was used and the local parser filled the gaps." } : {}),
        usage: {
          promptTokens: attempt.data.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: attempt.data.usageMetadata?.candidatesTokenCount ?? 0,
        },
        fallbacks: failed.map((f) => `${f.model}: ${f.reason}`),
      };
    }
    failed.push({ model, reason: attempt.reason });
    if (attempt.kind === "stop") {
      notTried = models.length - i - 1;
      break;
    }
  }

  // One model: its reason, plainly. A chain: each model's reason in turn,
  // so the log says which limit was hit where.
  if (models.length === 1) return { ok: false, reason: `Gemini ${failed[0].reason}` };
  const rest = notTried > 0 ? `; ${notTried} more not tried, no time left` : "";
  return { ok: false, reason: `Gemini could not read the document (${failed.map((f) => `${f.model}: ${f.reason}`).join("; ")}${rest})` };
}
