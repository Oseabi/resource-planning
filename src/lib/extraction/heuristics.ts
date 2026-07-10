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
export function parseListItems(text: string): string[] {
  if (!text) return [];
  const parts = text
    .split(/\r?\n|[•·▪◦‣∙]|[,;|]|\s+\/\s+|\t/)
    .map((p) => p.replace(/^[\s\-–—*•·]+/, "").replace(/[\s.]+$/, "").trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    // Skip sentence-like fragments (long, or ending in prose punctuation runs).
    if (raw.length > 45) continue;
    if (raw.split(/\s+/).length > 6) continue;
    const key = raw.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(raw);
    }
  }
  return out;
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

// Matches "2019 - Present", "Jan 2020 – Dec 2022", "2018 to 2020", "03/2019 - 05/2021".
const DATE_RANGE_RE =
  /((?:[A-Za-z]{3,9}\.?\s*)?\d{4}|\d{1,2}\/\d{4})\s*(?:-|–|—|to)\s*((?:[A-Za-z]{3,9}\.?\s*)?\d{4}|\d{1,2}\/\d{4}|present|current|now)/i;

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

  const flush = () => {
    if (current) {
      if (desc.length) current.description = desc.join("\n").trim();
      entries.push(current);
    }
    current = null;
    desc = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dateMatch = line.match(DATE_RANGE_RE);
    if (dateMatch) {
      flush();
      const isCurrent = /present|current|now/i.test(dateMatch[2]);
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
    } else {
      const nextIsDate = i + 1 < lines.length && DATE_RANGE_RE.test(lines[i + 1]);
      if (nextIsDate) {
        pendingHeader = line; // header for the upcoming date entry
      } else if (current) {
        desc.push(line.replace(/^[\-–—*•·]\s*/, ""));
      }
    }
  }
  flush();
  return entries.slice(0, 15);
}

const QUALIFICATION_HINT_RE =
  /\b(b\.?sc|b\.?eng|b\.?com|b\.?a\b|bba|m\.?sc|m\.?eng|mba|ph\.?d|honours|diploma|degree|certificate|matric|national senior certificate|hnd|hnc|nvq)\b/i;
const YEAR_RE = /\b(19|20)\d{2}\b/;

/** Best-effort education parse: one entry per qualification-looking line. */
export function parseEducation(text: string): Education[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((l) => l.replace(/^[\s\-–—*•·]+/, "").trim()).filter(Boolean);
  const out: Education[] = [];
  for (const line of lines) {
    if (line.length > 120) continue;
    if (!QUALIFICATION_HINT_RE.test(line) && !YEAR_RE.test(line)) continue;
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
    out.push({ qualification: rest, field: null, institution, year });
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
