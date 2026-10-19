/**
 * A written second opinion on a seat's shortlist.
 *
 * The scorer says how well somebody fits by arithmetic: how many required
 * skills they hold, whether the role matches, how many years. It cannot say
 * that one of two equally-scored people has actually run the thing being
 * bought, or that a 72 with the right domain beats a 78 without it. That is
 * the judgement this asks for.
 *
 * It is an opinion and nothing more. The stored score is never touched, the
 * shortlist stays in score order, and the note sits beside the deterministic
 * breakdown clearly labelled, so a bid manager can still defend the ranking to
 * a client without reference to an AI.
 *
 * Pure, with no server-only import, so the bench and the tests send exactly
 * what the app sends. Two copies of a prompt drift, and the fetch lives next
 * door in groq.ts.
 */

import { stripPii, AI_MODEL } from "@/lib/extraction/ai-fields";

/**
 * How many of a seat's shortlist go to the model.
 *
 * The same five position-matches.tsx already shows. Reranking the people on
 * screen is honest; reranking twenty the UI hides would produce an order
 * nobody can see the inputs for. It also keeps one call near a third of the
 * free tier's per-minute token budget.
 */
export const AI_RERANK_N = 5;

/** Enough for a seat's requirements without the whole scope of work. */
const SEAT_CHAR_CAP = 800;
/** Enough for a person's lists without their whole history. */
const CANDIDATE_CHAR_CAP = 600;
/** A reason is a sentence or two. Anything longer is the model rambling. */
const REASON_CHAR_CAP = 400;

export type Confidence = "high" | "medium" | "low";

/** What the model is told about the seat. No free text from the tender body. */
export interface DeepMatchSeat {
  role: string;
  requiredSkills: string[];
  requiredCertifications: string[];
  minExperienceYears: number | null;
  notes?: string | null;
}

/** What the model is told about one candidate. Deliberately no name and no id. */
export interface DeepMatchCandidate {
  /** Position in the list the model sees, 1 based. Never a uuid. */
  index: number;
  currentRole: string | null;
  additionalRoles: string[];
  skills: string[];
  technicalSkills: string[];
  certifications: string[];
  yearsExperience: number | null;
  availability: string;
  /** What the scorer already decided. Context, not something to change. */
  score: number;
}

export interface DeepMatchEntry {
  /** 1 based, into the list that was sent. */
  candidate: number;
  rank: number;
  reason: string;
  confidence: Confidence;
}

const clip = (value: string, cap: number) => (value.length <= cap ? value : `${value.slice(0, cap - 3)}...`);

const list = (values: string[], cap: number) => clip(values.filter(Boolean).join(", "), cap) || "none given";

/**
 * The seat and its shortlist, as the model sees them.
 *
 * Candidates are numbered, never named and never identified by uuid. A uuid is
 * thirty-six characters of waste five times over, and more to the point an
 * index cannot be hallucinated into another person's match row: the route
 * holds the mapping and refuses anything outside the range. The name is left
 * out because it has no bearing on the fit and no reason to leave the country.
 */
export function buildDeepMatchPrompt(seat: DeepMatchSeat, candidates: DeepMatchCandidate[]): string {
  const seatLines = [
    `  role: ${seat.role}`,
    `  needs skills: ${list(seat.requiredSkills, SEAT_CHAR_CAP)}`,
    `  needs certifications: ${list(seat.requiredCertifications, 200)}`,
    `  minimum experience: ${seat.minExperienceYears != null ? `${seat.minExperienceYears} years` : "none stated"}`,
    seat.notes?.trim() ? `  what the document says about this seat: ${clip(seat.notes.trim(), SEAT_CHAR_CAP)}` : null,
  ].filter(Boolean);

  const candidateLines = candidates.map((c) =>
    clip(
      [
        `  [${c.index}] role: ${c.currentRole ?? "none given"}`,
        c.additionalRoles.length ? `also: ${list(c.additionalRoles, 150)}` : null,
        `skills: ${list([...c.skills, ...c.technicalSkills], CANDIDATE_CHAR_CAP)}`,
        `certifications: ${list(c.certifications, 200)}`,
        `years: ${c.yearsExperience ?? "not given"}`,
        `availability: ${c.availability.replace(/_/g, " ")}`,
        `score: ${c.score}`,
      ]
        .filter(Boolean)
        .join(" | "),
      CANDIDATE_CHAR_CAP + 200,
    ),
  );

  return [
    "You are helping a South African staffing company shortlist people for one seat on a bid.",
    "You are given the seat's requirements and candidates who have already been scored.",
    "Say how well each one fits, and put them in the order you would interview them.",
    "",
    "Rules:",
    "- Use only what you are given. Never invent experience, a certification or a year.",
    "- The score is context. You may disagree with the order. You may not change the score.",
    "- A reason names something concrete from that candidate's own listed skills or roles.",
    "- If a fit is weak, say so plainly. A polite non-answer is worse than a blunt one.",
    "- One or two sentences per candidate.",
    "",
    "Seat:",
    ...seatLines,
    "",
    "Candidates:",
    ...candidateLines,
  ].join("\n");
}

/** Strict-mode schema, the dialect ai-fields.ts already proves against Groq. */
export const DEEP_MATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ranking"],
  properties: {
    ranking: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidate", "rank", "reason", "confidence"],
        properties: {
          candidate: { type: "integer" },
          rank: { type: "integer" },
          reason: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
  },
} as const;

/**
 * The whole request, minus the key.
 *
 * Every assembled field goes through stripPii even though structured skill and
 * role lists should carry no contact details; extraction has put stray text in
 * those columns before, and the redaction is pure and already tested.
 */
export function buildDeepMatchBody(
  seat: DeepMatchSeat,
  candidates: DeepMatchCandidate[],
): Record<string, unknown> {
  return {
    model: AI_MODEL,
    reasoning_effort: "low",
    include_reasoning: false,
    // The same shortlist should give the same reading twice.
    temperature: 0,
    // Five short reasons plus hidden reasoning. Roughly 1,400 tokens go in,
    // so one call sits near a third of the 8,000 a minute the free tier
    // allows, leaving room for a CV extraction at the same time.
    max_completion_tokens: 1200,
    messages: [{ role: "user", content: stripPii(buildDeepMatchPrompt(seat, candidates)) }],
    response_format: {
      type: "json_schema",
      json_schema: { name: "deep_match", strict: true, schema: DEEP_MATCH_SCHEMA },
    },
  };
}

const CONFIDENCES: Confidence[] = ["high", "medium", "low"];

/**
 * The model's answer, made safe.
 *
 * Never throws, in the manner of coerceAiFields: an answer that is partly
 * wrong is still worth having, and the alternative is a feature that fails
 * whenever a model is creative. An index outside the range is dropped rather
 * than clamped, because clamping would attribute one person's reason to
 * another; that is the one thing this must never do.
 */
export function coerceDeepMatch(value: unknown, sent: number): DeepMatchEntry[] {
  const raw = (value as { ranking?: unknown })?.ranking;
  if (!Array.isArray(raw)) return [];

  const seen = new Set<number>();
  const entries: DeepMatchEntry[] = [];
  for (const item of raw) {
    const row = item as Partial<DeepMatchEntry>;
    const candidate = Number(row?.candidate);
    if (!Number.isInteger(candidate) || candidate < 1 || candidate > sent) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const reason = typeof row?.reason === "string" ? clip(row.reason.trim(), REASON_CHAR_CAP) : "";
    entries.push({
      candidate,
      rank: Number.isInteger(Number(row?.rank)) ? Number(row.rank) : Number.MAX_SAFE_INTEGER,
      reason,
      confidence: CONFIDENCES.includes(row?.confidence as Confidence) ? (row.confidence as Confidence) : "low",
    });
  }

  // Renumber from the order it asked for, so 1, 1, 3 still reads 1, 2, 3.
  return entries
    .sort((a, b) => a.rank - b.rank || a.candidate - b.candidate)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

export interface DeepMatchNote {
  reason: string;
  rank: number;
  of: number;
  confidence: Confidence;
  model: string;
  at: string;
}

/**
 * What goes in the column.
 *
 * A versioned envelope rather than prose, because ai_deep_match_notes is text
 * and a bare sentence would make every future change to how this renders a
 * migration. Slightly dishonest for a column called notes, and the tolerant
 * reader below is the price of not adding a column.
 */
export function deepMatchNote(entry: DeepMatchEntry, of: number, model = AI_MODEL): string {
  const note: DeepMatchNote & { v: 1 } = {
    v: 1,
    reason: entry.reason,
    rank: entry.rank,
    of,
    confidence: entry.confidence,
    model,
    at: new Date().toISOString(),
  };
  return JSON.stringify(note);
}

/** Reads the envelope, or anything else somebody has put in the column. */
export function parseDeepMatchNote(text: string | null): DeepMatchNote | null {
  if (!text?.trim()) return null;
  try {
    const parsed = JSON.parse(text) as Partial<DeepMatchNote>;
    if (parsed && typeof parsed === "object" && typeof parsed.reason === "string") {
      return {
        reason: parsed.reason,
        rank: Number(parsed.rank) || 0,
        of: Number(parsed.of) || 0,
        confidence: CONFIDENCES.includes(parsed.confidence as Confidence) ? (parsed.confidence as Confidence) : "low",
        model: typeof parsed.model === "string" ? parsed.model : "",
        at: typeof parsed.at === "string" ? parsed.at : "",
      };
    }
  } catch {
    // Not the envelope. Fall through and treat it as what somebody wrote.
  }
  return { reason: text.trim(), rank: 0, of: 0, confidence: "low", model: "", at: "" };
}

/**
 * The only thing this feature may write to a match row.
 *
 * One key, by construction and by test, so no amount of later editing can let
 * an opinion reach the score column.
 */
export function deepMatchUpdate(note: string): { ai_deep_match_notes: string } {
  return { ai_deep_match_notes: note };
}
