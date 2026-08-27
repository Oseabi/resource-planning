/**
 * Read a TiPP Focus CV from the document's real tables.
 *
 * The template is entirely tables, so working from actual rows and cells
 * removes the guessing that the text-based parser has to do. An empty
 * qualification year stays an empty cell instead of merging two rows together,
 * and a career table whose dates are written unusually is still a career table
 * rather than collapsing into prose.
 *
 * tipp-template.ts remains for PDFs and for anything the table reader cannot
 * make sense of. The two share their field-level helpers so they cannot drift
 * apart in how they interpret a value once it has been located.
 */
import type { WorkExperience, Education } from "@/lib/supabase/database.types";
import type { ExtractedCandidateFields } from "@/lib/extraction/types";
import type { DocumentTables } from "@/lib/extraction/docx-tables";
import { isEmptyRow } from "@/lib/extraction/docx-tables";
import { classifySkills } from "@/lib/extraction/heuristics";
import {
  mapAvailability,
  splitList,
  splitDuration,
  expandSkillLine,
  mostRecentRole,
  yearsFromRows,
} from "@/lib/extraction/tipp-template";

/** Section headings, each of which occupies a single-cell table of its own. */
const HEADINGS = [
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

const normalise = (value: string): string =>
  value.replace(/\(s\)/gi, "").replace(/[^A-Za-z& ]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();

const isHeadingRow = (row: string[]): string | null => {
  const cells = row.filter((c) => c.trim());
  if (cells.length !== 1) return null;
  const text = normalise(cells[0]);
  return HEADINGS.find((h) => text === h) ?? null;
};

const isColumnHeader = (row: string[], words: string[]): boolean =>
  row.length >= words.length && words.every((w, i) => normalise(row[i] ?? "") === w);

/**
 * A qualification that is really a certification.
 *
 * These CVs put Microsoft and vendor certifications in the QUALIFICATION table
 * alongside degrees, so reading that table as education alone loses every
 * certification a candidate holds. Certifications are worth 20 of the 100
 * matching points, so this is not cosmetic.
 */
export function looksLikeCertification(qualification: string, institution: string | null): boolean {
  const q = qualification.trim();

  // An academic award, whatever else it mentions.
  if (/\b(?:bachelor|bsc|beng|bcom|ba|ma|msc|meng|mba|phd|honours|hons|pgdip|postgraduate|national diploma|higher certificate|matric|national senior certificate|degree)\b/i.test(q)) {
    return false;
  }

  // Named certification schemes and the vendors that issue them.
  if (/\b(?:certified|certification|microsoft|azure|aws|cisco|oracle|sap|itil|prince2|pmp|cbap|togaf|scrum|safe|comptia|kubernetes|cissp|cisa|six sigma)\b/i.test(q)) {
    return true;
  }
  // A vendor as the awarding body rather than a school.
  if (institution && /\b(?:microsoft|aws|amazon|cisco|oracle|sap|pmi|iiba|axelos|scrum\.org|comptia)\b/i.test(institution)) {
    return true;
  }
  return /\b(?:course|training|certificate in)\b/i.test(q);
}

/**
 * A skills-list entry that is really a certification.
 *
 * Stricter than the qualification-table test, because a skills list is full of
 * product names: "Microsoft Dynamics 365" is a skill, while "PL-400 Microsoft"
 * and "ITIL v4" are exams somebody sat. An exam code or an explicit
 * certification word is required rather than a vendor name alone.
 */
export function isCertificationEntry(value: string): boolean {
  const v = value.trim();
  // Vendor exam codes: PL-400, AZ-104, MS-700, MB-330, SC-200, DP-203.
  if (/\b(?:pl|az|ms|mb|sc|dp|ai|pk|md)\s?[-–]\s?\d{3}\b/i.test(v)) return true;
  if (/\b(?:itil|prince2|togaf|cbap|pmp|cissp|cisa|comptia|safe\s*\d|scrum\s*master)\b/i.test(v)) {
    return true;
  }
  return /\b(?:certified|certification|fundamentals|associate|practitioner)\b/i.test(v);
  return /(?:certified|certification|fundamentals|associate|practitioner)/i.test(v);
}

interface Row3 {
  a: string;
  b: string;
  c: string;
}

/** Rows of a three-column table, header and blank rows dropped. */
function dataRows(rows: string[][], header: string[]): Row3[] {
  return rows
    .filter((r) => !isEmptyRow(r) && !isColumnHeader(r, header))
    .map((r) => ({ a: (r[0] ?? "").trim(), b: (r[1] ?? "").trim(), c: (r[2] ?? "").trim() }))
    .filter((r) => r.a || r.b);
}

/** Employment blocks are two-column label/value tables, one per job. */
function employmentFromTable(rows: string[][]) {
  const block = { company: "", client: "", role: "", duration: "", duties: [] as string[] };

  for (const row of rows) {
    const label = normalise(row[0] ?? "").toLowerCase();
    const value = (row[1] ?? "").trim();

    if (label.startsWith("company")) block.company = value;
    else if (label.startsWith("client")) block.client = value;
    else if (label.startsWith("role") || label.startsWith("position")) block.role = value;
    else if (label.startsWith("duration")) block.duration = value;
    else if (label.startsWith("duties") || label.startsWith("responsibilities")) {
      // The duties cell holds one bullet per line, and on some CVs the label
      // and the list share a single cell.
      const source = value || (row[0] ?? "");
      block.duties = source
        .split("\n")
        .map((l) => l.replace(/^duties:?\s*/i, "").trim())
        .filter(Boolean);
    }
  }

  return block;
}

/**
 * Parse a TiPP Focus CV from its tables.
 *
 * Returns null when the tables do not look like the template, so the caller can
 * fall back to reading the text.
 */
export function parseTippTables(
  tables: DocumentTables,
  now: Date = new Date(),
): ExtractedCandidateFields | null {
  if (tables.length === 0) return null;

  // The header block is the first table of label/value pairs.
  const header = new Map<string, string>();
  for (const rows of tables) {
    for (const row of rows) {
      if (row.length < 2) continue;
      const label = normalise(row[0] ?? "");
      if (!label || header.has(label)) continue;
      if (["FULL NAME", "POSITION", "DESIGNATED GROUP", "LANGUAGES", "AVAILABILITY", "DATE OF BIRTH"].includes(label)) {
        header.set(label, (row[1] ?? "").trim());
      }
    }
    if (header.has("FULL NAME")) break;
  }

  if (!header.has("FULL NAME")) return null;

  // Walk the tables in order, using the heading tables as section markers.
  let section: string | null = null;
  const career: Row3[] = [];
  const education: Row3[] = [];
  const certificates: Row3[] = [];
  const skills: string[] = [];
  const employment: ReturnType<typeof employmentFromTable>[] = [];
  let summary = "";
  // Prose sitting under CAREER SUMMARY where the table should be. One CV is
  // written that way, and it is the candidate's summary in all but the heading.
  let careerProse = "";

  for (const table of tables) {
    // A section heading is sometimes a table of its own and sometimes the first
    // row of the table holding that section's content. Both layouts occur
    // across these CVs, so the heading is consumed either way.
    let rows = table;
    const leading = isHeadingRow(rows[0] ?? []);
    if (leading) {
      section = leading;
      rows = rows.slice(1);
      if (rows.length === 0) continue;
    }

    if (isColumnHeader(rows[0] ?? [], ["COMPANY", "POSITION", "DURATION"])) {
      career.push(...dataRows(rows, ["COMPANY", "POSITION", "DURATION"]));
      continue;
    }
    if (isColumnHeader(rows[0] ?? [], ["QUALIFICATION", "INSTITUTION", "YEAR"])) {
      const parsed = dataRows(rows, ["QUALIFICATION", "INSTITUTION", "YEAR"]);
      // Both tables share a shape, so the preceding heading decides which it is.
      (section === "CERTIFICATES AND COURSES" ? certificates : education).push(...parsed);
      continue;
    }

    // Free-content tables carry their section's body in a single cell.
    const text = rows
      .filter((r) => !isEmptyRow(r))
      .map((r) => r.join("\n"))
      .join("\n")
      .trim();
    if (!text) continue;

    if (section === "CANDIDATE SUMMARY" && !summary) {
      summary = text;
      section = null;
    } else if (section === "CAREER SUMMARY" && !careerProse) {
      // Reached only when the section held no career table, so this is prose
      // written under the wrong heading rather than a row that failed to parse.
      careerProse = text;
    } else if (section === "SKILLS" || section === "SKILLS AND TRAINING") {
      skills.push(...text.split("\n").flatMap(expandSkillLine));
    } else if (section === "EMPLOYMENT RECORD" && rows.some((r) => normalise(r[0] ?? "").startsWith("COMPANY"))) {
      employment.push(employmentFromTable(rows));
    }
  }

  // Certifications also sit in the qualification table on many of these CVs.
  const educationRows = education.filter((r) => !looksLikeCertification(r.a, r.b || null));
  const certFromEducation = education.filter((r) => looksLikeCertification(r.a, r.b || null));

  // And in the skills list: one CV puts PL-400, ITIL v4 and the Microsoft
  // fundamentals exams under SKILLS AND TRAINING, which is exactly where the
  // heading says they would be. Left as skills they score nothing against a
  // tender's certification requirement.
  const certFromSkills = skills.filter(isCertificationEntry);
  const plainSkills = skills.filter((s) => !isCertificationEntry(s));

  // Split technical from professional, so a profile does not show every skill
  // in one column and an empty one beside it.
  const { technical, professional } = classifySkills(plainSkills);

  const workFromEmployment: WorkExperience[] = employment.map((b) => {
    const { start, end, current } = splitDuration(b.duration);
    return {
      title: b.role,
      company: b.company,
      location: null,
      employment_type: null,
      start_date: start,
      end_date: end,
      is_current: current,
      description: [b.client ? `Client: ${b.client}` : null, ...b.duties].filter(Boolean).join("\n") || null,
      achievements: null,
    };
  });

  const workFromCareer: WorkExperience[] = career.map((r) => {
    const { start, end, current } = splitDuration(r.c);
    return {
      title: r.b,
      company: r.a,
      location: null,
      employment_type: null,
      start_date: start,
      end_date: end,
      is_current: current,
      description: null,
      achievements: null,
    };
  });

  // One CV writes its summary under CAREER SUMMARY with no table beneath it.
  // The text parser already recovers that, and dropping it here would have been
  // a regression rather than a simplification.
  const summaryText = summary || (career.length === 0 ? careerProse : "");

  const statedRole = header.get("POSITION")?.trim() || null;
  const durations = career.length ? career.map((r) => r.c) : employment.map((b) => b.duration);

  return {
    full_name: header.get("FULL NAME")?.trim() || null,
    email: null,
    phone: null,
    current_role:
      statedRole ??
      mostRecentRole(career.map((r) => ({ position: r.b, duration: r.c }))) ??
      mostRecentRole(employment.map((b) => ({ position: b.role, duration: b.duration }))),
    additional_roles: [],
    years_experience: yearsFromRows(durations, now.getUTCFullYear()),
    professional_summary: summaryText || null,
    skills: professional.filter((s, i, all) => all.indexOf(s) === i),
    technical_skills: technical.filter((s, i, all) => all.indexOf(s) === i),
    certifications: [
      ...certificates.map((r) => r.a),
      ...certFromEducation.map((r) => r.a),
      ...certFromSkills,
    ].filter(
      (c, i, all) => c && all.indexOf(c) === i,
    ),
    qualifications: educationRows.map((r) => r.a),
    sectors: [],
    languages: splitList(header.get("LANGUAGES") ?? null),
    designated_group: header.get("DESIGNATED GROUP")?.trim() || null,
    linkedin_url: null,
    portfolio_url: null,
    work_experience: workFromEmployment.length ? workFromEmployment : workFromCareer,
    education: educationRows.map(
      (r): Education => ({
        qualification: r.a,
        field: null,
        institution: r.b || null,
        year: r.c || null,
      }),
    ),
    availability: mapAvailability(header.get("AVAILABILITY") ?? null),
  };
}
