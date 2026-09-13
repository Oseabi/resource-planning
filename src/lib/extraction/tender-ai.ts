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
import { parseDateToIso, type ExtractedTenderFields, type TenderPosition } from "@/lib/extraction/rfq-parser";

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
    submission_deadline: str,
    contract_start_date: str,
    contract_end_date: str,
    contract_duration_months: { type: "NUMBER", nullable: true },
    reference_letters_required: { type: "INTEGER", nullable: true },
    min_experience_years: { type: "NUMBER", nullable: true },
    sectors: strList,
    required_skills: strList,
    required_certifications: strList,
    summary: str,
    positions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          role: { type: "STRING" },
          document_title: str,
          quantity: { type: "INTEGER", nullable: true },
          min_experience_years: { type: "NUMBER", nullable: true },
          required_skills: strList,
          required_certifications: strList,
          required_qualifications: strList,
          experience: str,
          evaluation: str,
          duration: str,
          notes: str,
        },
        required: [
          "role",
          "document_title",
          "quantity",
          "min_experience_years",
          "required_skills",
          "required_certifications",
          "required_qualifications",
          "experience",
          "evaluation",
          "duration",
          "notes",
        ],
      },
    },
  },
  required: [
    "title",
    "reference_number",
    "client",
    "location",
    "submission_deadline",
    "contract_start_date",
    "contract_end_date",
    "contract_duration_months",
    "reference_letters_required",
    "min_experience_years",
    "sectors",
    "required_skills",
    "required_certifications",
    "summary",
    "positions",
  ],
} as const;

// -------------------------------------------------------------------------
// The prompt
// -------------------------------------------------------------------------

/**
 * The prompt is mostly directions to where a tender keeps its people.
 *
 * No two tenders are laid out alike, and the roles are rarely in one place:
 * a mandatory-requirements table says the bidder "must provide" an Azure
 * administrator with a named certification, an evaluation table scores a
 * lead architect at ten points on a CV attached to Form B2.1, a pricing
 * schedule lists a resource category per role, and the scope of work names
 * a project manager in passing. Told where to look, the model reads all of
 * them; left to itself it reads the first and stops.
 */
export function buildTenderPrompt(): string {
  return [
    "You are reading a South African tender document (an RFP, RFQ, RFI, RFT or bid) for a staffing company that bids to supply the people the buyer asks for.",
    "Read the whole document, tables included, and extract what the bid team needs as JSON matching the schema.",
    "",
    "Where to look. Tenders differ, and the people the buyer wants are seldom in one place. Read all of these before answering:",
    "- the invitation, advertisement or cover page: title, bid number, buyer, closing date, briefing session;",
    "- the terms of reference, scope of work or specification: what is being bought, the contract period, where the work is done;",
    "- the mandatory, compulsory, pre-qualification or gate requirements: roles the bidder must provide, with the CV, certification and years each must show;",
    "- the technical or functional evaluation criteria and their scoring tables: roles scored by points, the form each is submitted on, what must be attached, the points per role and the bands of years that earn them;",
    "- the returnable documents and the forms themselves: a form headed Proposed Team, or one that says to attach the CV of a named role, names a role;",
    "- the pricing schedule or resource rate table: a row per resource category names a role, and a quantity or person-months column says how many and for how long.",
    "",
    "Rules:",
    "- If something is not stated, return null or an empty list. Never guess and never invent.",
    "- title is the tender's own title or description of the services, not the buyer's name. reference_number is the bid or tender number as printed.",
    "- client is the organisation issuing the tender, its full name. location is where the work is to be done, or the buyer's province or city.",
    "- Dates as YYYY-MM-DD. submission_deadline is the closing date for bids. contract_start_date and contract_end_date only when stated; contract_duration_months when the document gives a period instead (36 months, three years).",
    "- reference_letters_required: how many client reference letters or contactable references a bidder must supply. Where none is mandatory but the evaluation awards points by the number of reference letters or referenced projects, give the number that earns full points, and say so in the summary. Null only when the document asks for none.",
    "- summary: a brief for the bid team in four to eight plain sentences: what is being procured and its scope, the contract period, how bids are evaluated (the stages, the threshold, the weights, the criteria that carry the most points), what must be submitted for the people proposed (CVs, certifications, forms, reference letters), and the briefing session if there is one. Facts from the document only.",
    "- positions: one entry per distinct role the buyer wants a person for, wherever in the document it is named, the most heavily weighted first. Never merge two roles into one entry and never list a role twice. For each:",
    "  - role: the closest spelling from this list, otherwise the document's own words. A seniority prefix (Lead, Senior, Principal, Junior) on a listed role is still that role unless the list carries the senior spelling; the document's own title goes in document_title. The list: " + ALL_ROLES.join(", "),
    "  - document_title: the role exactly as the document names it, with its form, item or criterion reference where it has one (Lead Enterprise Architect, Form B2.1; Compulsory requirement 4).",
    "  - quantity: how many people, or null when not stated.",
    "  - min_experience_years: the minimum years the document requires for that role (a minimum of, at least, not less than, the lower figure of a range), or null. A points band is not a minimum: never take a points value or a band boundary as the years.",
    "  - required_skills, required_certifications, required_qualifications: what the document sets for that role specifically. Certifications by their names (AZ-104, TOGAF, PMP). Do not repeat tender-wide requirements on every role.",
    "  - experience: what the document requires the person to have done or to know, in the document's words, in at most three sentences: the technologies, domains and kinds of project it names.",
    "  - evaluation: how the seat is scored and what must be attached, compressed: the points it carries, the criterion or form it falls under, the bands (15 points: 10+ years = 15, 7 to <10 = 12, 5 to <7 = 8, 3 to <5 = 4), and whether it is a mandatory gate. Null where the document does not score the seat.",
    "  - duration: how long or how much of the person is wanted, when stated (17 person-months; full time for 24 months; as required at an hourly rate).",
    "  - notes: anything else the document asks of the seat (a clearance, on-site work, a language, a level of qualification), or null.",
    "- required_skills and required_certifications are the ones the document sets for the bid as a whole. min_experience_years is the tender-wide minimum, or null.",
    "- sectors: the buyer's sector and the sector of the work, from this list where one fits: " + ALL_SECTORS.join(", ") + ".",
    "- Ignore the standard forms (SBD 1, SBD 4, SBD 6.1, tax and B-BBEE declarations) except where they state the closing date, the reference number or the client. Preference points, B-BBEE and company-experience criteria are not roles.",
  ].join("\n");
}

/**
 * The seat's paragraph for a reader, from the strings the model read off the
 * document. One labelled line each, blank ones left out, so the notes field
 * on the form reads as a short brief rather than a form.
 */
export function seatNotes(p: {
  role: string;
  document_title: string | null;
  experience: string | null;
  evaluation: string | null;
  duration: string | null;
  required_qualifications: string[];
  notes: string | null;
}): string | null {
  const title = p.document_title && p.document_title.toLowerCase() !== p.role.toLowerCase() ? p.document_title : null;
  const lines = [
    title ? `In the document: ${title}` : null,
    p.experience ? `Experience: ${p.experience}` : null,
    p.evaluation ? `Scoring: ${p.evaluation}` : null,
    p.duration ? `Duration: ${p.duration}` : null,
    p.required_qualifications.length > 0 ? `Qualifications: ${p.required_qualifications.join("; ")}` : null,
    p.notes,
  ].filter((l): l is string => !!l);
  return lines.length > 0 ? lines.join("\n") : null;
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

/**
 * Years: a positive number. No tender asks for more than fifteen years of
 * anything; a larger figure is a points value or a band boundary read off
 * an evaluation table, and is dropped rather than shown as a requirement.
 */
const asYears = (v: unknown): number | null => {
  const n = asNumber(v);
  return n !== null && n > 0 && n <= 15 ? Math.round(n * 2) / 2 : null;
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
  summary: string | null;
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
      const seat = {
        role: canonicalise([role], ALL_ROLES)[0],
        quantity: asCount(item.quantity) || 1,
        min_experience_years: asYears(item.min_experience_years),
        required_skills: canonicalise(asStringList(item.required_skills), [...ALL_TECHNICAL_SKILLS, ...ALL_SKILLS]),
        required_certifications: canonicalise(asStringList(item.required_certifications), ALL_CERTIFICATIONS),
        required_qualifications: asStringList(item.required_qualifications),
        document_title: asString(item.document_title),
        experience: asString(item.experience),
        evaluation: asString(item.evaluation),
        duration: asString(item.duration),
        notes: asString(item.notes),
      };
      return { ...seat, notes: seatNotes(seat) };
    })
    .filter((p): p is TenderPosition => p !== null);

  // The same seat read twice, from the evaluation table and again from the
  // pricing schedule, is one seat, and the first, fuller entry is kept. Two
  // seats that share a listed role but not a title (a Finance & Operations
  // functional consultant and a CRM one) are two people, and both stay.
  const seen = new Set<string>();
  const distinct = positions.filter((p) => {
    const key = `${p.role}|${p.document_title ?? ""}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    title: asString(r.title),
    // "A- ICT 03- 2026" is a line-wrapped "A-ICT 03-2026".
    reference_number: asString(r.reference_number)?.replace(/\s*([-/])\s*/g, "$1") ?? null,
    client: asString(r.client),
    location: asString(r.location),
    submission_deadline: asIsoDate(r.submission_deadline),
    contract_start_date: asIsoDate(r.contract_start_date),
    contract_end_date: asIsoDate(r.contract_end_date),
    contract_duration_months: asCount(r.contract_duration_months),
    reference_letters_required: asCount(r.reference_letters_required),
    required_roles: [...new Set(distinct.map((p) => p.role))],
    required_skills: canonicalise(asStringList(r.required_skills), [...ALL_TECHNICAL_SKILLS, ...ALL_SKILLS]),
    required_certifications: canonicalise(asStringList(r.required_certifications), ALL_CERTIFICATIONS),
    sectors: canonicalise(asStringList(r.sectors), ALL_SECTORS),
    min_experience_years: asYears(r.min_experience_years),
    summary: asString(r.summary),
    positions: distinct,
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
    // The one field where the model's null is an answer. The heuristics read
    // "11+ years = 10 points" off an evaluation table as an eleven-year
    // minimum, which is exactly what the model was told not to do; once it
    // has read the roles, its silence on a tender-wide minimum means there
    // is none, and the page must not print one anyway.
    min_experience_years: ai.positions.length > 0 ? ai.min_experience_years : (ai.min_experience_years ?? local.min_experience_years),
    summary: ai.summary ?? local.summary ?? null,
    ...(positions ? { positions } : local.positions ? { positions: local.positions } : {}),
  };
}
