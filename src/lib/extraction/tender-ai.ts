/**
 * Everything decidable about AI-assisted tender extraction, with no I/O.
 *
 * The fetch lives in gemini.ts and is deliberately thin. What the model is
 * asked, what its answer is allowed to look like, and how that answer is
 * folded into the local parser's result are all here, where they can be
 * tested without a key.
 *
 * Tenders go to Gemini rather than Groq for one reason: length. An RFP runs
 * to fifty or two hundred pages, and the free Groq tier sends eight thousand
 * tokens a minute, which is about twelve of those pages. Gemini's free tier
 * takes the whole document, and takes it as the PDF itself, so it reads the
 * tables a requirements schedule is made of rather than a flattening of
 * them. A tender document is the buyer's public notice, not a person's
 * record, so what leaves is not personal data; it still goes through the
 * audit trail like everything else that leaves.
 *
 * Pure, no I/O.
 */

import { ALL_ROLES, ALL_SKILLS, ALL_TECHNICAL_SKILLS, ALL_CERTIFICATIONS, ALL_SECTORS } from "@/lib/vocabulary";
import { canonicalise } from "@/lib/extraction/ai-fields";
import { parseDateToIso, parseMoney, type ExtractedTenderFields, type TenderPosition } from "@/lib/extraction/rfq-parser";

// -------------------------------------------------------------------------
// What leaves the building
// -------------------------------------------------------------------------

/**
 * Text mode only, for a .docx. A PDF goes as itself. The free tier allows
 * 250,000 tokens a minute and this is roughly 100,000 of them, well past
 * any requirements schedule; what is cut is annexures and pricing forms.
 */
export const TENDER_TEXT_CHAR_CAP = 400_000;

/** Cut at a line break rather than mid-word, so the model does not read a torn sentence. */
export function truncateTenderText(text: string): { text: string; truncated: boolean } {
  if (text.length <= TENDER_TEXT_CHAR_CAP) return { text, truncated: false };
  const head = text.slice(0, TENDER_TEXT_CHAR_CAP);
  const cut = head.lastIndexOf("\n");
  return { text: cut > TENDER_TEXT_CHAR_CAP / 2 ? head.slice(0, cut) : head, truncated: true };
}

// -------------------------------------------------------------------------
// The schema, in Gemini's dialect
// -------------------------------------------------------------------------

const str = { type: "STRING", nullable: true } as const;
const strList = { type: "ARRAY", items: { type: "STRING" } } as const;

/**
 * What the model may answer. Gemini takes an OpenAPI-style schema with
 * upper-case types and `nullable`, and constrains its output to it; the
 * answer is still coerced field by field, because a schema is a promise
 * about the model and not about the network in between.
 */
export const TENDER_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: str,
    reference_number: str,
    client: str,
    location: str,
    value: { type: "NUMBER", nullable: true },
    submission_deadline: str,
    contract_start_date: str,
    contract_end_date: str,
    contract_duration_months: { type: "NUMBER", nullable: true },
    reference_letters_required: { type: "INTEGER", nullable: true },
    min_experience_years: { type: "NUMBER", nullable: true },
    sectors: strList,
    required_skills: strList,
    required_certifications: strList,
    positions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          role: { type: "STRING" },
          quantity: { type: "INTEGER", nullable: true },
          min_experience_years: { type: "NUMBER", nullable: true },
          required_skills: strList,
          required_certifications: strList,
          required_qualifications: strList,
          notes: str,
        },
        required: ["role", "quantity", "min_experience_years", "required_skills", "required_certifications", "required_qualifications", "notes"],
      },
    },
  },
  required: [
    "title",
    "reference_number",
    "client",
    "location",
    "value",
    "submission_deadline",
    "contract_start_date",
    "contract_end_date",
    "contract_duration_months",
    "reference_letters_required",
    "min_experience_years",
    "sectors",
    "required_skills",
    "required_certifications",
    "positions",
  ],
} as const;

// -------------------------------------------------------------------------
// The prompt
// -------------------------------------------------------------------------

export function buildTenderPrompt(): string {
  return [
    "You are reading a South African tender document (an RFP, RFQ, RFI or bid) for a staffing company that bids to supply people to the buyer.",
    "Extract what the bid team needs as JSON matching the schema. Rules:",
    "- If something is not stated, return null or an empty list. Never guess and never invent.",
    "- title is the tender's own title or description of the services, not the buyer's name. reference_number is the bid or tender number as printed.",
    "- client is the organisation issuing the tender, its full name. location is where the work is to be done, or the buyer's province or city.",
    "- value is the estimated or budgeted contract value in rand as a plain number, or null when the document gives none. Never a bidder's price.",
    "- Dates as YYYY-MM-DD. submission_deadline is the closing date for bids. contract_start_date and contract_end_date only when stated; contract_duration_months when the document gives a period instead (36 months, three years).",
    "- reference_letters_required is how many client reference letters or contactable references a bidder must supply, or null.",
    "- positions: one entry per role the buyer wants staffed, most important first, with how many people (quantity, null when not stated), the minimum years of experience the document sets for that role, and the skills, certifications and qualifications it sets for that role specifically. A resource schedule, a table of key personnel, or a list of required competencies each give these. Do not repeat tender-wide requirements on every role.",
    "- Spell roles exactly as they appear in this list where one fits, otherwise use the document's own words:",
    ALL_ROLES.join(", "),
    "- required_skills and required_certifications are the ones the document sets for the bid as a whole. min_experience_years is the tender-wide minimum, or null.",
    "- sectors: the buyer's sector and the sector of the work, from this list where one fits: " + ALL_SECTORS.join(", ") + ".",
    "- Ignore the standard forms (SBD 1, SBD 4, SBD 6.1, tax and B-BBEE declarations) and the pricing schedule except where they state the closing date, the reference number or the client.",
  ].join("\n");
}

// -------------------------------------------------------------------------
// Reading the answer
// -------------------------------------------------------------------------

const asString = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

const asStringList = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    const s = asString(item);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
};

const asNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) && v.trim() !== "" ? n : null;
  }
  return null;
};

/** Years: a positive number, capped where a sentence has been misread as one. */
const asYears = (v: unknown): number | null => {
  const n = asNumber(v);
  return n !== null && n > 0 && n <= 40 ? Math.round(n * 2) / 2 : null;
};

const asCount = (v: unknown): number | null => {
  const n = asNumber(v);
  return n !== null && n >= 0 && n <= 500 ? Math.round(n) : null;
};

/** A date the model wrote as YYYY-MM-DD, or in words, as ISO; an impossible one is dropped. */
const asIsoDate = (v: unknown): string | null => {
  const s = asString(v);
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : parseDateToIso(s);
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
};

/** The fields the model fills. Everything is optional in effect: the merge falls back to the local parser. */
export interface TenderAiFields extends ExtractedTenderFields {
  contract_end_date: string | null;
  contract_duration_months: number | null;
  reference_letters_required: number | null;
  positions: TenderPosition[];
}

/**
 * Turn whatever came back into fields the app can use.
 *
 * The schema promises the shape, but the model, the network and JSON.parse
 * do not, and a review dialog that crashes on one odd answer is worse than
 * one that shows a blank field. Every value is checked and anything
 * unrecognisable becomes the empty value. This never throws.
 */
export function coerceTenderAi(json: unknown): TenderAiFields {
  const r = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;

  const positions: TenderPosition[] = (Array.isArray(r.positions) ? r.positions : [])
    .map((p): TenderPosition | null => {
      const item = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      const role = asString(item.role);
      if (!role) return null;
      return {
        role: canonicalise([role], ALL_ROLES)[0],
        quantity: asCount(item.quantity) || 1,
        min_experience_years: asYears(item.min_experience_years),
        required_skills: canonicalise(asStringList(item.required_skills), [...ALL_TECHNICAL_SKILLS, ...ALL_SKILLS]),
        required_certifications: canonicalise(asStringList(item.required_certifications), ALL_CERTIFICATIONS),
        required_qualifications: asStringList(item.required_qualifications),
        notes: asString(item.notes),
      };
    })
    .filter((p): p is TenderPosition => p !== null);

  const money = r.value;
  const value = typeof money === "string" ? parseMoney(money) : asNumber(money);

  return {
    title: asString(r.title),
    reference_number: asString(r.reference_number),
    client: asString(r.client),
    location: asString(r.location),
    value: value !== null && value > 0 ? value : null,
    submission_deadline: asIsoDate(r.submission_deadline),
    contract_start_date: asIsoDate(r.contract_start_date),
    contract_end_date: asIsoDate(r.contract_end_date),
    contract_duration_months: asCount(r.contract_duration_months),
    reference_letters_required: asCount(r.reference_letters_required),
    required_roles: positions.map((p) => p.role),
    required_skills: canonicalise(asStringList(r.required_skills), [...ALL_TECHNICAL_SKILLS, ...ALL_SKILLS]),
    required_certifications: canonicalise(asStringList(r.required_certifications), ALL_CERTIFICATIONS),
    sectors: canonicalise(asStringList(r.sectors), ALL_SECTORS),
    min_experience_years: asYears(r.min_experience_years),
    positions,
  };
}

// -------------------------------------------------------------------------
// Folding it in
// -------------------------------------------------------------------------

/**
 * The end date from a start date and a period, when the document gives the
 * period rather than the date. Same day of the month, so 1 April plus 36
 * months is 31 March three years on.
 */
export function endDateFrom(start: string | null, months: number | null): string | null {
  if (!start || !months || months <= 0) return null;
  const d = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The local result with the model's answer laid over it.
 *
 * The model wins on everything it answered: it read the whole document as
 * pages and the heuristics read a flattening of the first part of it. An
 * empty answer never wipes a local value, so a reference number the regex
 * found and the model missed is still there. Positions come from the model
 * alone, since the heuristics have no notion of them beyond a list of role
 * names, which the merge keeps as the fallback.
 */
export function mergeTenderExtraction(local: ExtractedTenderFields, ai: TenderAiFields): ExtractedTenderFields {
  const positions = ai.positions.length > 0 ? ai.positions : undefined;
  return {
    title: ai.title ?? local.title,
    reference_number: ai.reference_number ?? local.reference_number,
    client: ai.client ?? local.client,
    location: ai.location ?? local.location,
    value: ai.value ?? local.value,
    submission_deadline: ai.submission_deadline ?? local.submission_deadline,
    contract_start_date: ai.contract_start_date ?? local.contract_start_date,
    contract_end_date:
      ai.contract_end_date ??
      endDateFrom(ai.contract_start_date ?? local.contract_start_date, ai.contract_duration_months) ??
      local.contract_end_date ??
      null,
    reference_letters_required: ai.reference_letters_required ?? local.reference_letters_required ?? null,
    required_roles: ai.required_roles.length > 0 ? ai.required_roles : local.required_roles,
    required_skills: ai.required_skills.length > 0 ? ai.required_skills : local.required_skills,
    required_certifications:
      ai.required_certifications.length > 0 ? ai.required_certifications : local.required_certifications,
    sectors: ai.sectors.length > 0 ? ai.sectors : local.sectors,
    min_experience_years: ai.min_experience_years ?? local.min_experience_years,
    ...(positions ? { positions } : local.positions ? { positions: local.positions } : {}),
  };
}
