/**
 * Pure heuristics for pulling structured fields out of already-extracted
 * document text. No AI, no I/O — safe to unit-test in isolation. Depends only on
 * the static vocabulary data.
 */
import { isKnownTechnicalSkill, SEED_LANGUAGES } from "@/lib/vocabulary";
import type { WorkExperience, Education } from "@/lib/supabase/database.types";

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

// A loose phone matcher; candidates are validated by digit count afterwards.
const PHONE_CANDIDATE_RE = /\+?\d[\d\s().-]{7,16}\d/g;

/** First email address found, lowercased. */
export function extractEmail(text: string): string | null {
  const match = text.match(EMAIL_RE);
  return match ? match[0].toLowerCase() : null;
}

/**
 * First plausible phone number (9–13 digits). Skips the local-part of any email
 * so "+27..." style numbers aren't confused with address noise.
 */
export function extractPhone(text: string): string | null {
  const withoutEmails = text.replace(new RegExp(EMAIL_RE.source, "gi"), " ");
  const matches = withoutEmails.match(PHONE_CANDIDATE_RE);
  if (!matches) return null;

  for (const raw of matches) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 9 && digits.length <= 13) {
      return raw.trim().replace(/\s+/g, " ");
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Return every dictionary term that appears in the text, using non-alphanumeric
 * boundaries so "Revit" doesn't match inside "Revitalise". Canonical casing from
 * the dictionary is preserved. Longer matches subsume shorter ones they contain
 * (so "CSCS Gold" wins over a bare "CSCS", "AutoCAD Civil 3D" over "AutoCAD").
 */
export function matchDictionary(text: string, terms: string[]): string[] {
  const found: string[] = [];
  for (const term of terms) {
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(term)}(?![A-Za-z0-9])`, "i");
    if (re.test(text)) found.push(term);
  }

  // Drop any term that is a whole substring of another matched term.
  return found.filter((term) => {
    const lower = term.toLowerCase();
    return !found.some(
      (other) => other !== term && other.toLowerCase().includes(lower),
    );
  });
}

const NAME_LINE_RE = /^[A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*){1,3}$/;

/**
 * Best-effort candidate name. Scans the first several non-empty lines for one that
 * looks like a 2–4 word name (letters only, no digits/@). Falls back to deriving
 * a name from the filename. Rough by design — always confirmed on the form.
 */
export function guessName(text: string, filename?: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines.slice(0, 6)) {
    // Names often precede a comma with suffixes ("ALEXANDER CHEN, P.E.").
    const candidate = line.split(",")[0].trim();
    if (candidate.length > 2 && candidate.length < 50 && NAME_LINE_RE.test(candidate)) {
      return toTitleCase(candidate);
    }
  }

  return filename ? nameFromFilename(filename) : null;
}

function nameFromFilename(filename: string): string | null {
  const base = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b(cv|resume|curriculum vitae|final|updated|copy)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base || /\d/.test(base)) return null;
  const words = base.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 4) return null;
  return toTitleCase(base);
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Guess the current role by matching the text against a known role list and
 * returning the longest (most specific) match, e.g. "Senior Structural Engineer"
 * over "Structural Engineer".
 */
export function guessRole(text: string, roles: string[]): string | null {
  const matches = matchDictionaryAll(text, roles);
  if (matches.length === 0) return null;
  return matches.reduce((longest, r) => (r.length > longest.length ? r : longest));
}

/** Like matchDictionary but without subsumption (used internally for role ranking). */
function matchDictionaryAll(text: string, terms: string[]): string[] {
  return terms.filter((term) => {
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(term)}(?![A-Za-z0-9])`, "i");
    return re.test(text);
  });
}

const YEARS_RE = /(\d{1,2})\s*\+?\s*years?/gi;

// "19 years of overall experience", "15+ years' experience", "10 years experience"
const EXPLICIT_YEARS_RE =
  /(\d{1,2})\s*\+?\s*years?['’]?\s*(?:of\s+)?(?:overall\s+|total\s+|combined\s+|professional\s+|relevant\s+|industry\s+|hands[- ]on\s+)*experience/gi;

/**
 * Years of experience the CV states outright. Preferred over both the largest
 * "N years" mention and any date-span estimate, because it is the candidate's
 * own headline figure.
 */
export function explicitExperienceYears(text: string): number | null {
  let max: number | null = null;
  for (const match of text.matchAll(EXPLICIT_YEARS_RE)) {
    const n = Number(match[1]);
    if (!Number.isNaN(n) && n > 0 && n < 60 && (max === null || n > max)) max = n;
  }
  return max;
}

/** Largest "N years" figure mentioned; a rough proxy for total experience. */
export function guessExperienceYears(text: string): number | null {
  let max: number | null = null;
  for (const match of text.matchAll(YEARS_RE)) {
    const n = Number(match[1]);
    if (!Number.isNaN(n) && (max === null || n > max)) max = n;
  }
  return max;
}

/**
 * Split a block (e.g. a Skills section) into individual items. Handles bullets,
 * commas, pipes, semicolons, slashes-between-spaces, and newlines. Drops empties,
 * dedupes case-insensitively, and skips prose-like lines that are clearly not tags.
 */
const BULLET_START_RE = /^[\s]*[-–—*•·▪◦‣∙]\s*/;

/**
 * Re-join lines that a PDF/Word layout wrapped mid-item, so "Mentorship & Talent\n
 * Development" becomes one item instead of two fragments. A line starts a new item
 * only when it is bulleted or the previous line ended a sentence.
 */
/** Roughly the width at which a layout wraps a line rather than ending an item. */
const WRAPPED_LINE_LENGTH = 60;

/**
 * Whether `line` continues `prev` rather than starting a new item. Only joins
 * when `prev` looks genuinely unfinished, so a plain newline-separated list
 * ("MongoDB\nPostgreSQL") stays as separate items.
 */
function isContinuation(prev: string, line: string): boolean {
  if (/[.!?;:]$/.test(prev)) return false; // prev completed a sentence/label
  if (/[-‐‑‒]$/.test(prev)) return true; // word split across the break
  if (/[,&/+]$/.test(prev)) return true; // dangling separator
  if (/\b(?:and|or|with|including|the|of|to|for|a|an|in|on)$/i.test(prev)) return true;
  if (/^[a-z]/.test(line)) return true; // lowercase fragment
  return prev.length > WRAPPED_LINE_LENGTH; // long enough to have been wrapped
}

export function unwrapLines(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const prev = out[out.length - 1];

    if (BULLET_START_RE.test(rawLine) || prev === undefined || !isContinuation(prev, line)) {
      out.push(line);
    } else if (/[-‐‑‒]$/.test(prev)) {
      out[out.length - 1] = `${prev}${line}`;
    } else {
      out[out.length - 1] = `${prev} ${line}`;
    }
  }
  return out;
}

const LEADING_FILLER_RE = /^(?:and|or|including|incl\.?|such as|e\.?g\.?|etc\.?|with|plus)\s+/i;
const FILLER_ITEMS = new Set([
  "and", "or", "etc", "including", "the", "a", "an", "with", "across", "for", "to",
  "of", "in", "on", "as", "by", "from", "other", "others", "various",
]);
/** Category labels that describe a group rather than being a skill themselves. */
const META_LABEL_RE = /\b(skills?|competenc\w*|tools?|environments?|expertise|proficienc\w*|areas?|technolog\w*)\b/i;

function cleanItem(raw: string): string | null {
  let v = raw.replace(BULLET_START_RE, "").replace(/[\s.,;:]+$/, "").trim();
  v = v.replace(LEADING_FILLER_RE, "").trim();
  // Repair brackets orphaned by comma-splitting, e.g. "SAP (S/4HANA" / "SuccessFactors)".
  if (v.includes("(") && !v.includes(")")) v = v.replace(/\s*\(\s*/, " ").trim();
  if (v.includes(")") && !v.includes("(")) v = v.replace(/\s*\)\s*/, "").trim();
  v = v.replace(/\s+/g, " ").trim();

  if (v.length < 2 || v.length > 45) return null;
  if (v.split(/\s+/).length > 6) return null;
  if (FILLER_ITEMS.has(v.toLowerCase())) return null;
  if (!/[A-Za-z]/.test(v)) return null;
  return v;
}

/**
 * Split a block (e.g. a Skills section) into individual items. Handles bullets,
 * commas, pipes, semicolons, slashes-between-spaces, wrapped lines, and
 * "Category: a, b, c" groupings. Drops filler and prose-like fragments.
 */
export function parseListItems(text: string): string[] {
  if (!text) return [];
  const chunks: string[] = [];

  for (const entry of unwrapLines(text)) {
    const body = entry.replace(BULLET_START_RE, "").trim();
    if (!body) continue;

    // "Programme & Project Leadership: Enterprise Programme Management, ..."
    const grouped = body.match(/^([^:]{3,45}):\s*(.+)$/);
    if (grouped) {
      const label = grouped[1].trim();
      if (!META_LABEL_RE.test(label)) chunks.push(label);
      chunks.push(...grouped[2].split(/[,;|]|\s+\/\s+|\t/));
    } else {
      chunks.push(...body.split(/[,;|]|\s+\/\s+|\t/));
    }
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const chunk of chunks) {
    const cleaned = cleanItem(chunk);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

const TRAILING_YEAR_RE = /\s*[–—-]?\s*(?:19|20)\d{2}\s*$/;

/**
 * Certifications are one-per-line and often carry an awarding body and year
 * ("PRINCE2 – APMG International 2016"), so they need looser limits than tag-like
 * list items — splitting them on commas would shred the name.
 */
export function parseCertificationItems(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const entry of unwrapLines(text)) {
    let v = entry.replace(BULLET_START_RE, "").replace(TRAILING_YEAR_RE, "").trim();
    v = v.replace(/[\s.,;:]+$/, "").trim();
    if (v.length < 2 || v.length > 90) continue;
    if (v.split(/\s+/).length > 12) continue;
    if (!/[A-Za-z]/.test(v)) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.slice(0, 20);
}

// Heuristic markers that a bare (non-dictionary) skill is technical.
const TECH_HINT_RE =
  /(\.js\b|\.net\b|\+\+|#$|\bsql\b|\bapi(s)?\b|\baws\b|\bazure\b|\bgcp\b|\bdocker\b|\bkubernetes\b|\bpython\b|\bjava\b|\bnode\b|\breact\b|\bhtml\b|\bcss\b|\bframework\b|\bdatabase\b|\bcloud\b|\bdevops\b|\bgit\b|\blinux\b|\bexcel\b|\bpower\s?bi\b|\btableau\b)/i;

/** Classify parsed skill items into technical vs professional buckets. */
export function classifySkills(items: string[]): { technical: string[]; professional: string[] } {
  const technical: string[] = [];
  const professional: string[] = [];
  for (const item of items) {
    if (isKnownTechnicalSkill(item) || TECH_HINT_RE.test(item)) technical.push(item);
    else professional.push(item);
  }
  return { technical, professional };
}

// Month names only — a generic [A-Za-z]{3,9} prefix would swallow real words,
// e.g. "Financial Officer 2007 – 2009" would lose "Officer" from the title.
const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;
const DATE_TOKEN = String.raw`(?:${MONTH}[\s/-]*)?\d{4}|\d{1,2}\/\d{4}`;

// Matches "2019 - Present", "Jan 2020 – Dec 2022", "2018 to 2020", "03/2019 - 05/2021".
const DATE_RANGE_RE = new RegExp(
  String.raw`(${DATE_TOKEN})\s*(?:-|–|—|to|until)\s*(${DATE_TOKEN}|present|current|now|to date|ongoing)`,
  "i",
);

function splitTitleCompany(line: string): { title: string; company: string | null } {
  const separators = [" at ", " @ ", " | ", " - ", " – ", ", "];
  for (const sep of separators) {
    const idx = line.toLowerCase().indexOf(sep.toLowerCase());
    if (idx > 0) {
      return { title: line.slice(0, idx).trim(), company: line.slice(idx + sep.length).trim() || null };
    }
  }
  return { title: line.trim(), company: null };
}

/**
 * Best-effort work-history parse. Handles the common layout where a title/company
 * line is followed by a date-range line (with any number of blank lines between —
 * .docx exports insert blanks between every paragraph). A non-date line that is
 * immediately followed by a date line is treated as that entry's header; other
 * non-date lines become the current entry's description.
 */
export function parseExperience(text: string): WorkExperience[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const entries: WorkExperience[] = [];

  let current: WorkExperience | null = null;
  let desc: string[] = [];
  let pendingHeader: string | null = null;
  // Set right after an entry header; the following line is often the employer.
  let awaitingCompany = false;

  const flush = () => {
    if (current) {
      if (desc.length) current.description = desc.join("\n").trim();
      entries.push(current);
    }
    current = null;
    desc = [];
    awaitingCompany = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dateMatch = line.match(DATE_RANGE_RE);
    if (dateMatch) {
      flush();
      const isCurrent = /present|current|now|to date|ongoing/i.test(dateMatch[2]);
      let header = line.replace(DATE_RANGE_RE, "").replace(/[|\-–—,]\s*$/, "").trim();
      if (header.length < 3) header = pendingHeader ?? "";
      pendingHeader = null;
      const { title, company } = splitTitleCompany(header);
      current = {
        title: title || "Role",
        company: company ?? "",
        start_date: dateMatch[1].trim(),
        end_date: isCurrent ? null : dateMatch[2].trim(),
        is_current: isCurrent,
        description: null,
      };
      awaitingCompany = !company;
      continue;
    }

    const nextIsDate = i + 1 < lines.length && DATE_RANGE_RE.test(lines[i + 1]);
    if (nextIsDate) {
      pendingHeader = line; // header for the upcoming date entry
      awaitingCompany = false;
      continue;
    }

    if (!current) continue;

    // The first plain, short line under a header is the employer, not prose.
    if (awaitingCompany && isCompanyLine(line)) {
      current.company = line.replace(/[.,;:]\s*$/, "").trim();
      awaitingCompany = false;
      continue;
    }

    awaitingCompany = false;
    desc.push(line.replace(/^[\-–—*•·▪◦‣∙]\s*/, ""));
  }
  flush();
  return entries.slice(0, 15);
}

/** A short, non-bullet, non-sentence line directly under a role header. */
function isCompanyLine(line: string): boolean {
  if (/^[\-–—*•·▪◦‣∙]/.test(line)) return false;
  if (line.length > 70) return false;
  if (/[.!?]$/.test(line)) return false;
  if (/:$/.test(line)) return false; // e.g. "Major Clients:"
  if (line.split(/\s+/).length > 9) return false;
  return true;
}

const QUALIFICATION_HINT_RE =
  /\b(b\.?sc|b\.?eng|b\.?com|b\.?a\b|bba|m\.?sc|m\.?eng|mba|ph\.?d|bachelor|master|magister|doctorate|doctoral|honours|postgraduate|undergraduate|diploma|degree|certificate|matric|national senior certificate|hnd|hnc|nvq)\b/i;
const YEAR_RE = /\b(19|20)\d{2}\b/;

const INSTITUTION_RE = /\b(university|universiteit|college|institute|academy|polytechnic|school of)\b/i;
/** Lines that are clearly a certification/short course rather than a qualification. */
const CERTIFICATE_LINE_RE = /^(?:certified\b|certification\b|certificate in\b)|\b(?:foundation|practitioner|training|course|programme|program)\b/i;
const IN_PROGRESS_RE = /\((?:in progress|ongoing|current|incomplete|expected[^)]*|due[^)]*)\)/i;

/**
 * Best-effort education parse: one entry per qualification-looking line. Requires
 * a degree/qualification word or a named institution — a bare year is too weak a
 * signal, since combined "Education & Certifications" blocks list dated courses.
 */
export function parseEducation(text: string): Education[] {
  if (!text) return [];
  const lines = unwrapLines(text).map((l) => l.replace(BULLET_START_RE, "").trim()).filter(Boolean);
  const out: Education[] = [];
  for (const original of lines) {
    if (original.length > 140) continue;
    // Combined "Education & Certifications" blocks feed both parsers; keep
    // certificate-style lines out of the education timeline.
    if (CERTIFICATE_LINE_RE.test(original)) continue;
    if (!QUALIFICATION_HINT_RE.test(original) && !INSTITUTION_RE.test(original)) continue;
    const inProgress = IN_PROGRESS_RE.test(original);
    const line = original.replace(IN_PROGRESS_RE, "").trim();
    const yearMatch = line.match(YEAR_RE);
    const year = yearMatch ? yearMatch[0] : null;
    let rest = line.replace(YEAR_RE, "").replace(/[()]/g, "").trim();
    let institution: string | null = null;
    const sepMatch = rest.split(/\s+(?:at|from|-|–|,)\s+/i);
    let qualification = rest;
    if (sepMatch.length > 1) {
      qualification = sepMatch[0].trim();
      institution = sepMatch.slice(1).join(" ").trim() || null;
    }
    rest = qualification.replace(/[\s.,-]+$/, "").trim();
    if (!rest) continue;
    out.push({
      qualification: inProgress ? `${rest} (in progress)` : rest,
      field: null,
      institution,
      year: inProgress ? null : year,
    });
  }
  return out.slice(0, 10);
}

const URL_RE = /https?:\/\/[^\s)]+|(?:www\.)?linkedin\.com\/[^\s)]+|(?:www\.)?github\.com\/[^\s)]+/gi;

/** Pull LinkedIn and a portfolio/GitHub URL from the text. */
export function extractLinks(text: string): { linkedin_url: string | null; portfolio_url: string | null } {
  const matches = text.match(URL_RE) ?? [];
  let linkedin: string | null = null;
  let portfolio: string | null = null;
  for (const raw of matches) {
    const url = raw.startsWith("http") ? raw : `https://${raw}`;
    if (/linkedin\.com/i.test(url)) {
      linkedin = linkedin ?? url;
    } else if (!portfolio) {
      portfolio = url;
    }
  }
  return { linkedin_url: linkedin, portfolio_url: portfolio };
}

/** Languages found by matching against the known languages list. */
export function extractLanguages(text: string): string[] {
  return matchDictionary(text, [...SEED_LANGUAGES]);
}
