/**
 * Free local RFQ/RFI parser — pulls tender fields out of already-extracted
 * document text using labelled-field heuristics + dictionary matching.
 * Pure and dependency-free apart from vocabulary data; safe to unit-test.
 * Every value is editable on the review form before saving (plan Decision 2).
 */
import { ALL_ROLES, ALL_TECHNICAL_SKILLS, ALL_SKILLS, ALL_CERTIFICATIONS, ALL_SECTORS } from "@/lib/vocabulary";
import { matchDictionary } from "@/lib/extraction/heuristics";
import { tenderBody } from "@/lib/extraction/tender-sections";

export interface ExtractedTenderFields {
  title: string | null;
  reference_number: string | null;
  client: string | null;
  location: string | null;
  value: number | null;
  submission_deadline: string | null; // ISO yyyy-mm-dd
  contract_start_date: string | null; // ISO yyyy-mm-dd
  required_roles: string[];
  required_skills: string[];
  required_certifications: string[];
  sectors: string[];
  min_experience_years: number | null;
}

export function emptyTenderFields(): ExtractedTenderFields {
  return {
    title: null,
    reference_number: null,
    client: null,
    location: null,
    value: null,
    submission_deadline: null,
    contract_start_date: null,
    required_roles: [],
    required_skills: [],
    required_certifications: [],
    sectors: [],
    min_experience_years: null,
  };
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};

const QUALIFIER = String.raw`(?:minimum(?:\s+of)?|at least|min\.?|no less than|not less than)`;

/**
 * Best-effort minimum-experience extraction. Handles the numeric forms
 * ("minimum 5 years", "5+ years experience") and the legal-document style ZA
 * tenders use — "a minimum of three (3) years' experience" — where the figure is
 * spelled out with the numeral in brackets.
 *
 * Returns the smallest figure found: the floor a candidate must clear.
 */
export function parseMinExperience(text: string): number | null {
  const patterns: RegExp[] = [
    // "minimum of three (3) years" — bracketed numeral wins, word is decoration.
    new RegExp(String.raw`${QUALIFIER}\s+(?:[a-z]+\s+)?\((\d{1,2})\)\s*(?:years?|yrs?)`, "gi"),
    // "minimum of 3 years"
    new RegExp(String.raw`${QUALIFIER}\s+(\d{1,2})\s*\+?\s*(?:years?|yrs?)`, "gi"),
    // "(3) years' experience" anywhere
    /\((\d{1,2})\)\s*(?:years?|yrs?)['’]?\s*(?:of\s+)?experience/gi,
    // "5+ years experience"
    /\b(\d{1,2})\s*\+\s*(?:years?|yrs?)(?:['’]?\s*(?:of\s+)?experience)?/gi,
  ];

  let min: number | null = null;
  const consider = (n: number) => {
    if (!Number.isNaN(n) && n > 0 && n < 50 && (min === null || n < min)) min = n;
  };

  for (const re of patterns) {
    for (const m of text.matchAll(re)) consider(Number(m[1]));
  }

  // "minimum of three years" — spelled out with no bracketed numeral.
  const wordRe = new RegExp(
    String.raw`${QUALIFIER}\s+(${Object.keys(WORD_NUMBERS).join("|")})\s+(?:years?|yrs?)`,
    "gi",
  );
  for (const m of text.matchAll(wordRe)) consider(WORD_NUMBERS[m[1].toLowerCase()]);

  return min;
}

// Personnel requirements: "The bidder must provide a Business Analyst with…",
// "must appoint a designated Project Manager who holds…".
const ROLE_PROVISION_RE =
  /(?:must|shall|should)\s+(?:provide|appoint|assign|nominate|supply)\s+(?:a|an|the|one)?\s*(?:designated|dedicated|proposed|suitably qualified|experienced|full[- ]time)?\s*([A-Z][A-Za-z()/&.\- ]{3,45}?)\s*(?=\b(?:who|that|which|with|holding|holds|having|responsible|to\b)|[,.:;])/g;

// Table-label form: "Project Team: Business Analyst (BA)", "Project Manager: Experience".
const ROLE_LABEL_RE =
  /^(?:project team|proposed team|key personnel|team member)\s*:\s*([A-Za-z()/&.\- ]{3,45}?)\s*$/i;
const ROLE_ATTRIBUTE_RE =
  /^([A-Z][A-Za-z()/&.\- ]{3,45}?)\s*:\s*(?:qualification|experience|certification)s?\b/i;

const ROLE_NOISE_RE =
  /\b(bid|bidder|tender|contract|service provider|company|letter|document|copy|evidence|proof|template|cv|curriculum)\b/i;

/** Tidy a captured role: drop bracketed abbreviations and trailing noise words. */
function cleanRole(raw: string): string | null {
  let role = raw
    .replace(/\([A-Z]{2,5}\)/g, " ") // "(BA)", "(QA)"
    .replace(/\s+/g, " ")
    .replace(/[\s.,:;-]+$/, "")
    .trim();

  // Drop a leading article the capture may have kept.
  role = role.replace(/^(?:a|an|the)\s+/i, "").trim();

  if (role.length < 4 || role.length > 45) return null;
  if (ROLE_NOISE_RE.test(role)) return null;
  if (!/[A-Za-z]{3}/.test(role)) return null;
  // Require at least one capitalised word — role titles are proper nouns here.
  if (!/\b[A-Z][a-z]/.test(role) && role !== role.toUpperCase()) return null;
  return role;
}

/**
 * Roles a tender explicitly asks the bidder to staff. Dictionary matching alone
 * misses tender-specific titles like "Lead Implementation Specialist", so the
 * personnel/mandatory-requirements phrasing is parsed directly.
 */
export function extractRequiredRoles(lines: string[]): string[] {
  const found: string[] = [];
  const text = lines.join("\n");

  for (const m of text.matchAll(ROLE_PROVISION_RE)) {
    const role = cleanRole(m[1]);
    if (role) found.push(role);
  }

  for (const line of lines) {
    for (const re of [ROLE_LABEL_RE, ROLE_ATTRIBUTE_RE]) {
      const m = line.match(re);
      if (m) {
        const role = cleanRole(m[1]);
        if (role) found.push(role);
      }
    }
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const role of found) {
    const key = role.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(role);
  }
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parse a date string in common document formats to ISO yyyy-mm-dd.
 * Supports "15 August 2026", "August 15, 2026", "2026-08-15", "15/08/2026"
 * (day-first, as is standard in ZA/UK documents).
 */
export function parseDateToIso(raw: string): string | null {
  const text = raw.trim();

  // ISO already
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 15 August 2026 / 15 Aug 2026
  const dmy = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/);
  if (dmy) {
    const month = MONTHS[dmy[2].slice(0, 3).toLowerCase()];
    if (month) return `${dmy[3]}-${String(month).padStart(2, "0")}-${String(Number(dmy[1])).padStart(2, "0")}`;
  }

  // August 15, 2026
  const mdy = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/);
  if (mdy) {
    const month = MONTHS[mdy[1].slice(0, 3).toLowerCase()];
    if (month) return `${mdy[3]}-${String(month).padStart(2, "0")}-${String(Number(mdy[2])).padStart(2, "0")}`;
  }

  // 15/08/2026 or 15-08-2026 (day first)
  const slash = text.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${slash[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

/**
 * Parse a monetary amount: "R 12,500,000", "R12.5m", "£4.2 million", "$950k",
 * "ZAR 3 000 000". Returns the numeric value (in plain units).
 */
export function parseMoney(raw: string): number | null {
  // The currency symbol must not be the tail of a word and the magnitude suffix
  // must not be the head of one — otherwise "FURTHER 24 MONTHS" parses as
  // R24 million (the "R" of FURTHER plus the "M" of MONTHS).
  const m = raw.match(
    /(?<![A-Za-z])(?:R|ZAR|£|\$|€|USD|GBP|EUR)\s*([\d][\d\s,.']*)(\s*(?:million|mil|bn|billion|[mk])\b)?/i,
  );
  if (!m) return null;
  const numText = m[1].replace(/[\s,']/g, "");
  let value = Number(numText);
  if (Number.isNaN(value)) return null;
  const suffix = (m[2] ?? "").trim().toLowerCase();
  if (suffix === "k") value *= 1_000;
  else if (suffix === "m" || suffix === "mil" || suffix === "million") value *= 1_000_000;
  else if (suffix === "bn" || suffix === "billion") value *= 1_000_000_000;
  return value;
}

/** Value of the first line matching any of the label patterns ("Label: value"). */
function labelledValue(lines: string[], labels: RegExp[]): string | null {
  for (const line of lines) {
    for (const label of labels) {
      const m = line.match(label);
      if (m) {
        const value = line.slice((m.index ?? 0) + m[0].length).replace(/^[\s:—–-]+/, "").trim();
        if (value) return value;
      }
    }
  }
  return null;
}

const DEADLINE_LABELS = [/submission deadline/i, /closing date/i, /closing time/i, /submission date/i, /deadline/i, /due date/i];
const START_LABELS = [/contract start/i, /commencement date/i, /start date/i, /anticipated start/i, /contract commencement/i];
// NOTE: "on behalf of" was removed — it matched the SBD boilerplate line
// "AUTHORITY TO SIGN ON BEHALF OF THE COMPANY" and yielded "THE COMPANY".
const CLIENT_LABELS = [
  /^client\b/i,
  /issued by/i,
  /^employer\b/i,
  /procuring entity/i,
  /contracting authority/i,
  /^name of (?:the )?(?:institution|department|entity|organ of state)\b/i,
  /requirements of the\b/i,
];
const LOCATION_LABELS = [/^location\b/i, /project location/i, /site location/i, /place of (?:work|performance)/i];
const VALUE_LABELS = [/estimated (?:contract )?value/i, /contract value/i, /tender value/i, /budget/i, /project value/i];

/**
 * Client from the invitation sentence, e.g.
 * "THE BORDER MANAGEMENT AUTHORITY (BMA) HEREBY INVITES SUITABLY QUALIFIED…".
 * Takes the words before "invites" rather than a capitalisation pattern, since
 * these pages are frequently set entirely in capitals.
 */
function clientFromInvitation(line: string): string | null {
  const m = line.match(/^(.*?)\s+(?:hereby\s+)?invites\b/i);
  if (!m) return null;
  const name = m[1]
    .trim()
    .split(/\s+/)
    .slice(-8) // guard against a long preamble running into the sentence
    .join(" ")
    .replace(/^(?:the)\s+/i, "")
    .replace(/[\s,;:]+$/, "")
    .trim();
  return name.length >= 4 && name.length <= 100 ? name : null;
}

/** Lines mentioning a statutory threshold rather than this tender's value. */
const THRESHOLD_NOISE_RE =
  /(preference point|threshold|pppfa|equal to or above|equal to or below|exceeds|less than|more than|rand value of (?:this )?bid is|80\/20|90\/10)/i;

/**
 * Tender titles routinely wrap across several lines. Join consecutive lines from
 * the start until the sentence terminates, so the title isn't truncated at the
 * first line break.
 */
function joinWrappedTitle(lines: string[]): string | null {
  const parts: string[] = [];
  for (const line of lines.slice(0, 6)) {
    const t = line.trim();
    if (!t || /@|www\.|http/i.test(t)) break;
    parts.push(t);
    // A line ending in a full stop (and not an abbreviation) closes the title.
    if (/[.]$/.test(t) && !/\b[A-Z]\.$/.test(t)) break;
    if (parts.join(" ").length > 200) break;
  }
  const joined = parts.join(" ").replace(/\s+/g, " ").trim();
  return joined.length >= 10 ? joined : null;
}

/**
 * Bid / reference number, e.g. "BID NUMBER: H004L2705RFP00048". This is the
 * identifier the issuing authority uses on every submission, so it is worth
 * lifting out even though it is rarely on its own line.
 */
export function parseReferenceNumber(lines: string[]): string | null {
  for (const line of lines) {
    const m = line.match(
      /\b(?:bid|tender|rfp|rfq|rfi|reference|enquiry|quotation)\s*(?:number|no\.?|ref\.?)\s*[:\-–]?\s*([A-Za-z0-9][A-Za-z0-9/\-_]{4,40})/i,
    );
    if (!m) continue;
    const ref = m[1].replace(/[.,;:]+$/, "");
    // Must contain a digit — otherwise it caught a following word like "CLOSING".
    if (/\d/.test(ref)) return ref;
  }
  return null;
}

/** Best-effort tender title: an explicit label, else the (wrapped) opening block. */
function guessTitle(lines: string[], filename?: string): string | null {
  const labelled = labelledValue(lines, [/^(?:tender|rfq|rfi|rfp|bid) (?:title|name|description)\b/i, /^title\b/i]);
  if (labelled) return labelled.slice(0, 200);

  const wrapped = joinWrappedTitle(lines);
  if (wrapped) {
    return (
      wrapped
        .replace(/^(request for (?:quotation|information|proposal)|rfq|rfi|rfp|tender)[\s:—–-]*/i, "")
        .replace(/[\s.]+$/, "")
        .trim()
        .slice(0, 200) || wrapped.slice(0, 200)
    );
  }

  if (filename) {
    const base = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    if (base.length >= 6) return base;
  }
  return null;
}


export function parseRfqText(text: string, filename?: string): ExtractedTenderFields {
  const fields = emptyTenderFields();

  // Large tenders are mostly standard-form boilerplate; matching against the
  // whole file yields "Tax Compliance"-style noise. Scope requirement matching
  // to the substantive section, but read identity/date fields from the preamble
  // (the invitation page) where they actually live.
  const { core, all } = tenderBody(text);
  const coreText = core.join("\n");

  fields.title = guessTitle(all, filename);
  fields.reference_number = parseReferenceNumber(all);
  fields.location = labelledValue(all, LOCATION_LABELS)?.slice(0, 100) ?? null;

  // Client: the "<entity> hereby invites" phrasing is checked first because it
  // carries the organisation's full legal name; labelled fields often hold a
  // shortened or informal variant.
  for (const line of all.slice(0, 80)) {
    const name = clientFromInvitation(line);
    if (name) {
      fields.client = name.slice(0, 100);
      break;
    }
  }
  if (!fields.client) {
    fields.client = labelledValue(all, CLIENT_LABELS)?.slice(0, 100) ?? null;
  }

  const deadlineRaw = labelledValue(all, DEADLINE_LABELS);
  fields.submission_deadline = deadlineRaw ? parseDateToIso(deadlineRaw) : null;
  const startRaw = labelledValue(all, START_LABELS);
  fields.contract_start_date = startRaw ? parseDateToIso(startRaw) : null;

  // Value: a labelled line is authoritative. Otherwise take the largest figure
  // from the requirements section only, skipping statutory thresholds — the
  // preference-points table quotes R50m on every ZA tender regardless of size.
  const valueRaw = labelledValue(all, VALUE_LABELS);
  if (valueRaw && !THRESHOLD_NOISE_RE.test(valueRaw)) {
    fields.value = parseMoney(valueRaw);
  }
  if (fields.value == null) {
    let best: number | null = null;
    for (const line of core) {
      if (THRESHOLD_NOISE_RE.test(line)) continue;
      const v = parseMoney(line);
      if (v != null && (best == null || v > best)) best = v;
    }
    fields.value = best;
  }

  // Roles: tender-specific personnel requirements first, then dictionary hits.
  const statedRoles = extractRequiredRoles(core);
  const dictRoles = matchDictionary(coreText, [...ALL_ROLES]);
  const seenRoles = new Set(statedRoles.map((r) => r.toLowerCase()));
  fields.required_roles = [
    ...statedRoles,
    ...dictRoles.filter((r) => !seenRoles.has(r.toLowerCase())),
  ].slice(0, 12);

  fields.required_skills = matchDictionary(coreText, [...ALL_TECHNICAL_SKILLS, ...ALL_SKILLS]).slice(0, 15);
  fields.required_certifications = matchDictionary(coreText, [...ALL_CERTIFICATIONS]).slice(0, 10);
  fields.sectors = matchDictionary(coreText, [...ALL_SECTORS]).slice(0, 6);
  fields.min_experience_years = parseMinExperience(coreText);

  return fields;
}
