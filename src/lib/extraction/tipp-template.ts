/**
 * Parser for the TiPP Focus standard CV template.
 *
 * Every CV the business receives is produced from one Word template, so the
 * structure is known rather than guessed. That makes a dedicated parser worth
 * far more than the generic heuristics, which read this layout badly: the
 * three-column tables flatten into a stream of bare cell values, so the
 * heuristics pick up the table's own header row and report every candidate's
 * role as "Duration".
 *
 * The template, as mammoth flattens it:
 *
 *   FULL NAME (S)             label on one line, value on the next
 *   POSITION                  (older copies carry DATE OF BIRTH here instead)
 *   DESIGNATED GROUP
 *   LANGUAGES
 *   AVAILABILITY
 *   CANDIDATE SUMMARY         free prose
 *   CAREER SUMMARY            table: COMPANY / POSITION / DURATION, then triples
 *   QUALIFICATION             table: QUALIFICATION / INSTITUTION / YEAR
 *   CERTIFICATES AND COURSES  same table shape
 *   SKILLS                    one per line
 *   EMPLOYMENT RECORD         Company / Client / Role / Duration / Duties blocks
 *   OTHER ACHIEVEMENTS
 *   REFERENCE
 *
 * Sections are optional and appear in this order. Real files vary, and each
 * variation below came from an actual CV rather than being imagined: one uses
 * DATE OF BIRTH where the others use POSITION, one leaves CANDIDATE SUMMARY
 * empty, one leaves POSITION and LANGUAGES empty, and one puts its summary
 * prose directly under CAREER SUMMARY with no table at all.
 */
import type { WorkExperience, Education } from "@/lib/supabase/database.types";
import type { ExtractedCandidateFields } from "@/lib/extraction/types";

/** Headings that start a section, in the order the template lays them out. */
const SECTION_HEADINGS = [
  "FULL NAME",
  "DATE OF BIRTH",
  "POSITION",
  "DESIGNATED GROUP",
  "LANGUAGES",
  "AVAILABILITY",
  "CANDIDATE SUMMARY",
  "CAREER SUMMARY",
  "QUALIFICATION",
  "CERTIFICATES AND COURSES",
  "SKILLS AND TRAINING",
  "SKILLS",
  "OTHER ACHIEVEMENTS",
  "EMPLOYMENT RECORD",
  "REFERENCE",
] as const;

/** Column headers inside the template's tables. Never content. */
const TABLE_HEADERS = new Set([
  "COMPANY",
  "POSITION",
  "DURATION",
  "QUALIFICATION",
  "INSTITUTION",
  "YEAR",
]);

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

/**
 * A duration cell, e.g. "January 2015 - December 2021" or "Jan 2025 - Current".
 * Hyphen, en dash and em dash all appear in real files, so all three match.
 */
const DURATION_RE = new RegExp(
  `^\\s*((?:${MONTHS})?\\s*\\d{4})\\s*(?:[-\\u2013\\u2014]|to)\\s*((?:${MONTHS})?\\s*\\d{4}|current|present|to date|ongoing)\\s*$`,
  "i",
);

/**
 * The year cell that ends a qualification table row.
 *
 * Often a range rather than a single year: real CVs carry "2021",
 * "2017 - 2021" and "2012 -2016" in the same column. Matching only a bare year
 * left the ranged rows unterminated, so two qualifications merged into one and
 * the institution came out as "University of Johannesburg 2017 - 2021 Matric
 * St John's College 2012 -2016".
 */
const YEAR_CELL_RE = /^\s*(?:19|20)\d{2}\s*(?:[-–—]\s*(?:19|20)\d{2}\s*)?$/;

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE_RE = /(?:\+27|0)\s?(?:\d[\s-]?){8,10}\d/;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+/i;

function normaliseHeading(line: string): string {
  return line
    .replace(/\(s\)/gi, "")
    .replace(/[^A-Za-z& ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** The heading this line starts, or null when it is ordinary content. */
function headingAt(line: string): string | null {
  const norm = normaliseHeading(line);
  if (!norm) return null;
  return SECTION_HEADINGS.find((h) => norm === h) ?? null;
}

/**
 * Recognise the template so the generic heuristics stay out of the way.
 * Three of these labels together do not occur on an ordinary CV.
 */
export function looksLikeTippTemplate(text: string): boolean {
  const upper = text.toUpperCase();
  const markers = [
    "FULL NAME",
    "DESIGNATED GROUP",
    "CAREER SUMMARY",
    "EMPLOYMENT RECORD",
    "CANDIDATE SUMMARY",
  ];
  return markers.filter((m) => upper.includes(m)).length >= 3;
}

interface Section {
  heading: string;
  lines: string[];
}

/**
 * The column-header rows the template uses, as runs.
 *
 * These matter because two of the words are also section headings. Left alone,
 * the POSITION column header inside CAREER SUMMARY opens a new section and
 * swallows the rest of the table, and the QUALIFICATION column header does the
 * same to the qualification table. Matching the run as a whole disambiguates
 * them: a lone POSITION near the top is the label, three in a row is a table.
 */
const HEADER_RUNS = [
  ["COMPANY", "POSITION", "DURATION"],
  ["QUALIFICATION", "INSTITUTION", "YEAR"],
];

/** Length of the header run starting here, or 0 when this is not one. */
function headerRunAt(lines: string[], i: number): number {
  for (const run of HEADER_RUNS) {
    if (run.every((word, k) => lines[i + k]?.toUpperCase() === word)) return run.length;
  }
  return 0;
}

/** Split the document into template sections, dropping blank lines. */
function splitIntoSections(text: string): Section[] {
  // Non-breaking spaces and tabs both appear inside template cells.
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/ /g, " ").replace(/\t+/g, " ").trim())
    .filter(Boolean);

  const sections: Section[] = [];
  let current: Section = { heading: "PREAMBLE", lines: [] };

  for (let i = 0; i < lines.length; i++) {
    const run = headerRunAt(lines, i);
    if (run > 0) {
      i += run - 1;
      continue;
    }

    const heading = headingAt(lines[i]);
    if (heading) {
      sections.push(current);
      current = { heading, lines: [] };
      continue;
    }
    current.lines.push(lines[i]);
  }
  sections.push(current);
  return sections;
}

/**
 * Lines of a section. The first occurrence wins: a heading word repeats later
 * as a table column header, and that repeat is never the section itself.
 */
function sectionLines(sections: Section[], heading: string): string[] {
  return sections.find((s) => s.heading === heading)?.lines ?? [];
}

/** The value of a label section, e.g. the name under FULL NAME. */
function firstValue(lines: string[]): string | null {
  const value = lines.find((l) => l && !TABLE_HEADERS.has(l.toUpperCase()));
  return value ? value.trim() : null;
}

/**
 * Split on commas that are not inside brackets.
 *
 * "Cloud Services (Azure, Office 365)" has to survive as one skill, so a naive
 * split on every comma would cut it into "Cloud Services (Azure" and
 * "Office 365)".
 */
function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buffer = "";

  for (const ch of value) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);

    if (ch === "," && depth === 0) {
      parts.push(buffer);
      buffer = "";
      continue;
    }
    buffer += ch;
  }
  parts.push(buffer);
  return parts;
}

/**
 * Leading clause on a prose skills line, e.g. "He has skills in the following
 * areas". The middle is greedy so it strips up to the *last* marker before the
 * first comma; lazy matching stopped at "in" and left "the following areas"
 * glued to the front of the first real skill.
 */
const SKILL_PREAMBLE_RE =
  /^.*?\b(?:skills?|competenc\w+|proficient|experience)\b[^,]*\b(?:in|areas|including|following)\b[:\s]*/i;

/**
 * Turn one line of the SKILLS section into individual skills.
 *
 * Most CVs list one per line and need no work. One writes the whole section as
 * a sentence: "He has skills in the following areas Project Management,
 * Systems Development Life Cycle, ...". Left whole that is a single unusable
 * value, and the matcher scores on exact skill names, so it would never match
 * anything.
 */
export function expandSkillLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes(",")) return [trimmed];

  const body = trimmed.replace(SKILL_PREAMBLE_RE, "");
  return splitTopLevelCommas(body)
    .flatMap((part) => part.split(/\bas well as\b/i))
    // A list written "BPMN, EPC, or DMN" leaves the conjunction on the last item.
    .map((part) => part.replace(/\.$/, "").replace(/^\s*(?:or|and)\s+/i, "").trim())
    .filter((part) => part.length > 1);
}

/** Split "English, IsiXhosa and SeSotho" into its parts. */
export function splitList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/,|;|\/|\band\b/i)
    .map((v) => v.trim())
    .filter((v) => v.length > 1);
}

/** Map the template's free-text availability onto the app's three values. */
export function mapAvailability(
  value: string | null,
): "available" | "notice_period" | "unavailable" | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  // Checked before "available", because "available from 1 March" is a notice
  // period, not immediate availability.
  if (/notice|month|week|available from|resign/.test(v)) return "notice_period";
  if (/not available|unavailable|committed/.test(v)) return "unavailable";
  if (/immediate|available|now|ready/.test(v)) return "available";
  return undefined;
}

export interface CareerRow {
  company: string;
  position: string;
  duration: string;
}

/**
 * Read the CAREER SUMMARY table.
 *
 * The duration cell terminates a row, rather than counting in threes, because
 * a company or position cell is occasionally blank in the source document and
 * strict grouping would then shift every later row by one.
 */
export function parseCareerSummary(lines: string[]): CareerRow[] {
  const rows: CareerRow[] = [];
  let pending: string[] = [];

  for (const line of lines) {
    if (TABLE_HEADERS.has(line.toUpperCase())) continue;

    if (DURATION_RE.test(line)) {
      rows.push({
        company: (pending[0] ?? "").trim(),
        // Anything between the company and the duration is the position, which
        // keeps a wrapped job title in one piece.
        position: pending.slice(1).join(" ").trim(),
        duration: line.trim(),
      });
      pending = [];
      continue;
    }
    pending.push(line);
  }

  return rows.filter((r) => r.company || r.position);
}

export interface QualificationRow {
  qualification: string;
  institution: string | null;
  year: string | null;
}

/** Read a QUALIFICATION / INSTITUTION / YEAR table, terminated by the year. */
export function parseQualificationTable(lines: string[]): QualificationRow[] {
  const rows: QualificationRow[] = [];
  let pending: string[] = [];

  for (const line of lines) {
    if (TABLE_HEADERS.has(line.toUpperCase())) continue;

    if (YEAR_CELL_RE.test(line)) {
      if (pending.length > 0) {
        rows.push({
          qualification: pending[0].trim(),
          institution: pending.slice(1).join(" ").trim() || null,
          year: line.trim(),
        });
      }
      pending = [];
      continue;
    }
    pending.push(line);
  }

  // A trailing row with no year still counts. The year is the optional part.
  if (pending.length > 0) {
    rows.push({
      qualification: pending[0].trim(),
      institution: pending.slice(1).join(" ").trim() || null,
      year: null,
    });
  }

  return rows;
}

export interface EmploymentBlock {
  company: string | null;
  client: string | null;
  role: string | null;
  duration: string | null;
  duties: string[];
}

const EMPLOYMENT_LABELS: Record<string, keyof EmploymentBlock> = {
  company: "company",
  client: "client",
  role: "role",
  position: "role",
  duration: "duration",
  duties: "duties",
  responsibilities: "duties",
};

/** Read the EMPLOYMENT RECORD blocks: label/value pairs plus a duty list. */
export function parseEmploymentRecord(lines: string[]): EmploymentBlock[] {
  const blocks: EmploymentBlock[] = [];
  let current: EmploymentBlock | null = null;
  let field: keyof EmploymentBlock | null = null;

  for (const line of lines) {
    const label = EMPLOYMENT_LABELS[line.toLowerCase().replace(/[:\s]+$/, "")];

    // "Company" starts a new block, so it is what separates one job from the next.
    if (label === "company") {
      if (current) blocks.push(current);
      current = { company: null, client: null, role: null, duration: null, duties: [] };
      field = "company";
      continue;
    }
    if (!current) continue;

    if (label) {
      field = label;
      continue;
    }

    if (field === "duties") {
      current.duties.push(line);
    } else if (field && current[field] === null) {
      // Only the first line after a label is its value; anything further is a
      // wrapped cell and would overwrite what was already read correctly.
      (current[field] as string) = line;
    }
  }

  if (current) blocks.push(current);
  return blocks.filter((b) => b.company || b.role);
}

/** Split a duration cell into its two halves. */
export function splitDuration(duration: string | null): {
  start: string | null;
  end: string | null;
  current: boolean;
} {
  if (!duration) return { start: null, end: null, current: false };
  const m = duration.match(DURATION_RE);
  if (!m) return { start: duration.trim() || null, end: null, current: false };
  const end = m[2].trim();
  const isCurrent = /current|present|to date|ongoing/i.test(end);
  return { start: m[1].trim(), end: isCurrent ? null : end, current: isCurrent };
}

/** Calendar year out of a duration half. */
function yearOf(value: string | null): number | null {
  const m = value?.match(/(?:19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

/**
 * Total years of experience, measured from the earliest start to the latest end.
 *
 * The span is measured once rather than summing each row, because the template
 * lists concurrent contracts as separate rows and summing them double-counts
 * the same years. One of these CVs overlaps four roles across 2020 to 2022 and
 * would otherwise report roughly double the real figure.
 */
export function yearsFromRows(durations: string[], thisYear: number): number | null {
  let earliest: number | null = null;
  let latest: number | null = null;

  for (const duration of durations) {
    const { start, end, current } = splitDuration(duration);
    const startYear = yearOf(start);
    const endYear = current ? thisYear : yearOf(end);
    if (startYear !== null && (earliest === null || startYear < earliest)) earliest = startYear;
    if (endYear !== null && (latest === null || endYear > latest)) latest = endYear;
  }

  if (earliest === null) return null;
  const span = (latest ?? thisYear) - earliest;
  return span > 0 && span < 60 ? span : null;
}

/**
 * Parse a CV written on the TiPP Focus template.
 *
 * Returns null when the document is not on the template, so the caller falls
 * back to the generic heuristics.
 */
export function parseTippTemplate(
  text: string,
  now: Date = new Date(),
): ExtractedCandidateFields | null {
  if (!looksLikeTippTemplate(text)) return null;

  const sections = splitIntoSections(text);
  const thisYear = now.getUTCFullYear();

  const careerLines = sectionLines(sections, "CAREER SUMMARY");
  const careerRows = parseCareerSummary(careerLines);

  // One CV puts its summary prose directly under CAREER SUMMARY with no table.
  // Detected by the absence of any duration row, not by looking for a name.
  const careerIsProse = careerRows.length === 0 && careerLines.length > 0;

  const summaryLines = sectionLines(sections, "CANDIDATE SUMMARY");
  const professional_summary =
    summaryLines.length > 0
      ? summaryLines.join("\n\n")
      : careerIsProse
        ? careerLines.join("\n\n")
        : null;

  const employment = parseEmploymentRecord(sectionLines(sections, "EMPLOYMENT RECORD"));

  // EMPLOYMENT RECORD carries the client and the duties, so it is preferred.
  // CAREER SUMMARY stands in when a CV omits the detailed section.
  const work_experience: WorkExperience[] = employment.length
    ? employment.map((b) => {
        const { start, end, current } = splitDuration(b.duration);
        return {
          title: b.role ?? "",
          company: b.company ?? "",
          location: null,
          employment_type: null,
          start_date: start,
          end_date: end,
          is_current: current,
          // The client leads, because on a bid that is what an evaluator reads.
          description:
            [b.client ? `Client: ${b.client}` : null, ...b.duties].filter(Boolean).join("\n") ||
            null,
          achievements: null,
        };
      })
    : careerRows.map((r) => {
        const { start, end, current } = splitDuration(r.duration);
        return {
          title: r.position,
          company: r.company,
          location: null,
          employment_type: null,
          start_date: start,
          end_date: end,
          is_current: current,
          description: null,
          achievements: null,
        };
      });

  const educationRows = parseQualificationTable(sectionLines(sections, "QUALIFICATION"));
  const education: Education[] = educationRows.map((r) => ({
    qualification: r.qualification,
    field: null,
    institution: r.institution,
    year: r.year,
  }));

  const certRows = parseQualificationTable(sectionLines(sections, "CERTIFICATES AND COURSES"));

  const skills = [
    ...sectionLines(sections, "SKILLS"),
    ...sectionLines(sections, "SKILLS AND TRAINING"),
  ]
    .filter((s) => s.length > 1 && !TABLE_HEADERS.has(s.toUpperCase()))
    .flatMap(expandSkillLine)
    .filter((s, i, all) => all.indexOf(s) === i);

  // POSITION is the stated role. Older copies use that slot for DATE OF BIRTH
  // and state no role at all, so the most recent job title stands in.
  const statedRole = firstValue(sectionLines(sections, "POSITION"));
  const current_role = statedRole ?? careerRows[0]?.position ?? employment[0]?.role ?? null;

  const durations = careerRows.length
    ? careerRows.map((r) => r.duration)
    : employment.map((b) => b.duration ?? "");

  return {
    full_name: firstValue(sectionLines(sections, "FULL NAME")),
    email: text.match(EMAIL_RE)?.[0] ?? null,
    phone: text.match(PHONE_RE)?.[0]?.trim() ?? null,
    current_role,
    additional_roles: [],
    years_experience: yearsFromRows(durations, thisYear),
    professional_summary,
    skills,
    technical_skills: [],
    certifications: certRows.map((r) => r.qualification),
    qualifications: educationRows.map((r) => r.qualification),
    sectors: [],
    languages: splitList(firstValue(sectionLines(sections, "LANGUAGES"))),
    designated_group: firstValue(sectionLines(sections, "DESIGNATED GROUP")),
    linkedin_url: text.match(LINKEDIN_RE)?.[0] ?? null,
    portfolio_url: null,
    work_experience,
    education,
    availability: mapAvailability(firstValue(sectionLines(sections, "AVAILABILITY"))),
  };
}
