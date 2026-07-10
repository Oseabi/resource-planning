/**
 * Free local RFQ/RFI parser — pulls tender fields out of already-extracted
 * document text using labelled-field heuristics + dictionary matching.
 * Pure and dependency-free apart from vocabulary data; safe to unit-test.
 * Every value is editable on the review form before saving (plan Decision 2).
 */
import { ALL_ROLES, ALL_TECHNICAL_SKILLS, ALL_SKILLS, ALL_CERTIFICATIONS, ALL_SECTORS } from "@/lib/vocabulary";
import { matchDictionary } from "@/lib/extraction/heuristics";

export interface ExtractedTenderFields {
  title: string | null;
  client: string | null;
  location: string | null;
  value: number | null;
  submission_deadline: string | null; // ISO yyyy-mm-dd
  contract_start_date: string | null; // ISO yyyy-mm-dd
  required_roles: string[];
  required_skills: string[];
  required_certifications: string[];
  sectors: string[];
}

export function emptyTenderFields(): ExtractedTenderFields {
  return {
    title: null,
    client: null,
    location: null,
    value: null,
    submission_deadline: null,
    contract_start_date: null,
    required_roles: [],
    required_skills: [],
    required_certifications: [],
    sectors: [],
  };
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
  const m = raw.match(
    /(?:R|ZAR|£|\$|€|USD|GBP|EUR)\s*([\d][\d\s,.']*)(\s*(?:million|mil|m|bn|billion|k))?/i,
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
const CLIENT_LABELS = [/^client\b/i, /issued by/i, /^employer\b/i, /procuring entity/i, /contracting authority/i, /on behalf of/i];
const LOCATION_LABELS = [/^location\b/i, /project location/i, /site location/i, /place of (?:work|performance)/i];
const VALUE_LABELS = [/estimated (?:contract )?value/i, /contract value/i, /tender value/i, /budget/i, /project value/i];

/** Best-effort tender title: an explicit label, else the first substantial line. */
function guessTitle(lines: string[], filename?: string): string | null {
  const labelled = labelledValue(lines, [/^(?:tender|rfq|rfi|rfp|bid) (?:title|name|description)\b/i, /^title\b/i]);
  if (labelled) return labelled.slice(0, 150);

  for (const line of lines.slice(0, 8)) {
    const t = line.trim();
    if (t.length >= 10 && t.length <= 150 && !/@|www\.|http/i.test(t)) {
      return t.replace(/^(request for (?:quotation|information|proposal)|rfq|rfi|rfp|tender)[\s:—–-]*/i, "").trim() || t;
    }
  }
  if (filename) {
    const base = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    if (base.length >= 6) return base;
  }
  return null;
}

export function parseRfqText(text: string, filename?: string): ExtractedTenderFields {
  const fields = emptyTenderFields();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  fields.title = guessTitle(lines, filename);
  fields.client = labelledValue(lines, CLIENT_LABELS)?.slice(0, 100) ?? null;
  fields.location = labelledValue(lines, LOCATION_LABELS)?.slice(0, 100) ?? null;

  const deadlineRaw = labelledValue(lines, DEADLINE_LABELS);
  fields.submission_deadline = deadlineRaw ? parseDateToIso(deadlineRaw) : null;
  const startRaw = labelledValue(lines, START_LABELS);
  fields.contract_start_date = startRaw ? parseDateToIso(startRaw) : null;

  // Value: prefer a labelled line, else the largest money figure in the document.
  const valueRaw = labelledValue(lines, VALUE_LABELS);
  if (valueRaw) {
    fields.value = parseMoney(valueRaw);
  }
  if (fields.value == null) {
    let best: number | null = null;
    for (const line of lines) {
      const v = parseMoney(line);
      if (v != null && (best == null || v > best)) best = v;
    }
    fields.value = best;
  }

  fields.required_roles = matchDictionary(text, [...ALL_ROLES]).slice(0, 10);
  fields.required_skills = matchDictionary(text, [...ALL_TECHNICAL_SKILLS, ...ALL_SKILLS]).slice(0, 15);
  fields.required_certifications = matchDictionary(text, [...ALL_CERTIFICATIONS]).slice(0, 10);
  fields.sectors = matchDictionary(text, [...ALL_SECTORS]).slice(0, 6);

  return fields;
}
