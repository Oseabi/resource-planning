import "server-only";

/**
 * The one network call behind the deep match.
 *
 * Split from fields.ts the way extraction is, so the prompt and the schema can
 * be imported by a test or a bench without dragging a server-only module in.
 *
 * Failures come back as data, never thrown, and nothing is written when one
 * happens: the deterministic shortlist is already on screen and stays exactly
 * as it was. The feature is additive and skippable by construction.
 *
 * Zero retries, as extraction has. A retry inside a sixty second route burns
 * the next minute's token budget as well. The button is the retry.
 */

import { GROQ_ENDPOINT, salvageRefusedAnswer, isAiExtractionConfigured } from "@/lib/extraction/ai-extractor";
import { AI_MODEL } from "@/lib/extraction/ai-fields";
import {
  buildDeepMatchBody,
  coerceDeepMatch,
  type DeepMatchCandidate,
  type DeepMatchEntry,
  type DeepMatchSeat,
} from "@/lib/deep-match/fields";

const TIMEOUT_MS = 20_000;

export type DeepMatchResult =
  | { ok: true; model: string; entries: DeepMatchEntry[]; note?: string }
  | { ok: false; reason: string };

/** The same key that turns on CV extraction. One switch, not two. */
export function isDeepMatchConfigured(): boolean {
  return isAiExtractionConfigured();
}

export async function deepMatchSeat(
  seat: DeepMatchSeat,
  candidates: DeepMatchCandidate[],
): Promise<DeepMatchResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ok: false, reason: "GROQ_API_KEY is not set" };
  if (candidates.length === 0) return { ok: false, reason: "There is nobody on this seat's shortlist yet" };

  const body = buildDeepMatchBody(seat, candidates);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const retry = res.headers.get("retry-after");
      return { ok: false, reason: `Groq rate limit reached${retry ? `, try again in ${retry}s` : ""}` };
    }
    if (res.status === 413) {
      return { ok: false, reason: "this shortlist is too long for the AI's per-minute budget" };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // Strict mode is a check after the fact on this model, so a refused
      // answer that parses is still a usable ranking.
      const salvaged = salvageRefusedAnswer(text);
      if (salvaged) {
        return {
          ok: true,
          model: AI_MODEL,
          entries: coerceDeepMatch(salvaged.answer, candidates.length),
          note: "The AI's answer did not match the expected shape in full; what it did give was used.",
        };
      }
      return { ok: false, reason: `Groq ${res.status}: ${text.slice(0, 200)}` };
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

    const entries = coerceDeepMatch(parsed, candidates.length);
    if (entries.length === 0) return { ok: false, reason: "Groq did not rank anybody" };
    return { ok: true, model: AI_MODEL, entries };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, reason: `Groq did not answer within ${TIMEOUT_MS / 1000}s` };
    }
    return { ok: false, reason: e instanceof Error ? e.message : "Groq call failed" };
  } finally {
    clearTimeout(timer);
  }
}
