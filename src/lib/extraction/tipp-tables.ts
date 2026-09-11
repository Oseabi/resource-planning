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
import type {
  WorkExperience,
  Education,
  SkillCategory,
  Certificate,
  ProjectGroup,
} from "@/lib/supabase/database.types";
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

/**
 * Section headings, each of which occupies a single-cell table of its own.
 *
 * The PDF reader maps the issued template's spellings (SKILLSET, EMPLOYMENT
 * HISTORY, CANDIDATE OVERVIEW) onto these before they arrive, so this list is
 * the canonical one. ACHIEVEMENTS, PROJECTS and CERTIFICATIONS are sections
 * the issued template has that the docx-era one did not.
 */
const HEADINGS = [
  "CANDIDATE SUMMARY",
  "CAREER SUMMARY",
  "QUALIFICATION",
  "CERTIFICATES AND COURSES",
  "CERTIFICATIONS",
  "SKILLS AND TRAINING",
  "SKILLS",
  "PROJECTS",
  "ACHIEVEMENTS",
  "OTHER ACHIEVEMENTS",
  "EMPLOYMENT RECORD",
  "REFERENCE",
] as const;

/**
 * Header-block labels, with the spellings issued copies carry. POSITON is a
 * typo every current copy of the template has.
 */
const HEADER_LABELS: Record<string, string> = {
  "FULL NAME": "FULL NAME",
  POSITION: "POSITION",
  POSITON: "POSITION",
  "DESIGNATED GROUP": "DESIGNATED GROUP",
  LANGUAGES: "LANGUAGES",
  AVAILABILITY: "AVAILABILITY",
  "DATE OF BIRTH": "DATE OF BIRTH",
  "YEARS OF EXPERIENCE": "YEARS OF EXPERIENCE",
};

/** "14+ years", "18 years", "8+ Years" to a number. */
function statedYears(value: string | null | undefined): number | null {
  const m = (value ?? "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n <= 60 ? n : null;
}

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
 * Does a table open with this column header, allowing one stray row before
 * it? A PDF can put a fragment of the section heading, or a blank, ahead of
 * the header row.
 */
const opensWith = (rows: string[][], words: string[]): boolean =>
  isColumnHeader(rows[0] ?? [], words) || isColumnHeader(rows[1] ?? [], words);

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

interface EmploymentBlock {
  company: string;
  client: string;
  role: string;
  duration: string;
  duties: string[];
}

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.? \\d{4}";
/**
 * A titled sub-role inside one employer's block, as every issued CV writes
 * them: "Business Architect (CA ANZ) (June 2016 - March 2018)", sometimes
 * with a pipe before the dates or a note after. Year-only ranges occur too.
 */
const SUB_ROLE_RE = new RegExp(
  `^(.{3,120}?)\\s*\\|?\\s*\\(\\s*(${MONTH}|\\d{4})\\s*[-\\u2013\\u2014]\\s*(${MONTH}|\\d{4}|current|present|to date|ongoing)\\s*\\)`,
  "i",
);

const LABEL_RE = /^(company|client|role|position|duration|duties|responsibilities)\s*:?\s*(.*)$/i;

/**
 * The jobs in one employer's block: the block itself, and one per titled
 * sub-role inside it.
 *
 * Every issued CV nests roles: three titles at one company, each with its own
 * dates and duties, under a single Company label. They are flattened to one
 * entry each, sharing the company and client, because that is what the
 * career summary table already does and what matching can score. The block's
 * own Role and Duration are the roll-up; it is kept as an entry only when it
 * has duties of its own before the first sub-role, so nothing is lost and
 * nothing is doubled.
 */
function employmentBlocks(rows: string[][]): EmploymentBlock[] {
  const main: EmploymentBlock = { company: "", client: "", role: "", duration: "", duties: [] };
  const subs: EmploymentBlock[] = [];
  let current: EmploymentBlock = main;

  // The block's rows, flattened to lines. How the PDF reader split them into
  // rows depends on vertical gaps, so a sub-role can arrive inside the duties
  // cell or as a row of its own, and only the lines are reliable.
  const lines: string[] = [];
  for (const row of rows) {
    const label = normalise(row[0] ?? "").toLowerCase();
    const value = (row[1] ?? "").trim();
    if (value && /^(company|client|role|position|duration)$/.test(label)) {
      lines.push(`${row[0].trim()}: ${value}`);
    } else {
      for (const cell of row) for (const line of cell.split("\n")) if (line.trim()) lines.push(line.trim());
    }
  }

  for (const line of lines) {
    const sub = line.match(SUB_ROLE_RE);
    if (sub) {
      current = { company: main.company, client: main.client, role: sub[1].trim(), duration: `${sub[2]} - ${sub[3]}`, duties: [] };
      subs.push(current);
      continue;
    }
    const labelled = line.match(LABEL_RE);
    if (labelled) {
      const [, key, rest] = labelled;
      const k = key.toLowerCase();
      if (k === "company") main.company = rest.trim();
      else if (k === "client") main.client = rest.trim();
      else if (k === "role" || k === "position") current.role = rest.trim() || current.role;
      else if (k === "duration") current.duration = rest.trim() || current.duration;
      else if (rest.trim()) current.duties.push(rest.trim());
      continue;
    }
    current.duties.push(line.replace(/^[••▪●\-]\s*/, "").trim());
  }

  // A CV that carries only the roll-up, or that writes duties before the first
  // sub-role, keeps the block as an entry of its own.
  const keepMain = subs.length === 0 || main.duties.length > 0;
  return keepMain ? [main, ...subs] : subs;
}

/** "36 Months" to "3 years", "12 Months" to "1 year", anything else as written. */
function monthsToYears(value: string): string | null {
  const m = value.match(/(\d+)\s*months?/i);
  if (!m) return value.trim() || null;
  const years = Math.round((Number(m[1]) / 12) * 2) / 2;
  return years < 1 ? "under a year" : `${years} year${years === 1 ? "" : "s"}`;
}

/**
 * Rows of the older SKILLS MATRIX. A row with nothing past the first cell is
 * a category; every other row is "Skill N" where N is a self-rating.
 */
function matrixRows(rows: string[][]): SkillCategory[] {
  const out: SkillCategory[] = [];
  let current: SkillCategory = { category: "General", skills: [] };
  for (const r of rows) {
    if (isEmptyRow(r) || isColumnHeader(r, ["SKILL SELF RATING", "EXPERIENCE", "LAST USED"])) continue;
    const first = (r[0] ?? "").trim();
    const rest = r.slice(1).map((c) => (c ?? "").trim()).filter(Boolean);
    if (!first || /^matrix$/i.test(first)) continue;
    if (rest.length === 0) {
      if (current.skills.length) out.push(current);
      current = { category: first, skills: [] };
      continue;
    }
    const m = first.match(/^(.*?)\s+(\d{1,2})$/);
    const name = m ? m[1].trim() : first;
    const rating = m ? `self-rated ${m[2]}/10` : null;
    const lastUsed = rest[1] ? `last used ${rest[1]}` : null;
    current.skills.push({
      name,
      years: rest[0] ? monthsToYears(rest[0]) : null,
      note: [rating, lastUsed].filter(Boolean).join(", ") || null,
    });
  }
  if (current.skills.length) out.push(current);
  return out;
}

/**
 * The skills in one SKILLSET cell.
 *
 * One per line, or separated by semicolons, or by commas. A cell that uses
 * semicolons is split on those alone, because on such a cell a comma is part
 * of a name ("Microsoft Excel, Word and PowerPoint" is one item in a
 * semicolon list). One CV wrote every category this way and came through as
 * eight skills, each a whole sentence.
 */
function splitSkillCell(cell: string): string[] {
  const separator = cell.includes(";") ? /\n|;/ : /\n|,(?![^(]*\))/;
  return cell
    .split(separator)
    .map((n) => n.trim().replace(/[.;]$/, ""))
    .filter(Boolean);
}

/**
 * Rows of the SKILLSET table. The category is the first cell, the skills the
 * second, one per line or comma separated, and the years the third with one
 * value per skill when the CV gives them and one for the row when it does
 * not. A row that carries a category but no skills is a label alone, and one
 * with skills but no category belongs to the row before it.
 */
function skillRows(rows: string[][]): SkillCategory[] {
  const out: SkillCategory[] = [];
  for (const r of rows) {
    if (isEmptyRow(r) || isColumnHeader(r, ["SKILLS", "PROFICIENCY", "YEARS OF EXPERIENCE"])) continue;
    const category = (r[0] ?? "").trim();
    const names = splitSkillCell(r[1] ?? "");
    const years = (r[2] ?? "").split("\n").map((y) => y.trim()).filter(Boolean);

    if (names.length === 0) continue;
    const entries = names.map((name, i) => ({
      name,
      years: years.length === names.length ? years[i] : (years[0] ?? null),
    }));

    if (!category && out.length > 0) {
      out[out.length - 1].skills.push(...entries);
    } else {
      out.push({ category: category || "General", skills: entries });
    }
  }
  return out;
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
      const label = HEADER_LABELS[normalise(row[0] ?? "")];
      if (!label || header.has(label)) continue;
      header.set(label, (row[1] ?? "").trim());
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
  const skillMatrix: SkillCategory[] = [];
  const projects: ProjectGroup[] = [];
  const achievementBlocks: string[] = [];
  const employment: EmploymentBlock[] = [];
  let summary = "";
  // Prose sitting under CAREER SUMMARY where the table should be. One CV is
  // written that way, and it is the candidate's summary in all but the heading.
  let careerProse = "";

  for (const table of tables) {
    // A section heading is sometimes a table of its own and sometimes the first
    // row of the table holding that section's content. Both layouts occur
    // across these CVs, so the heading is consumed either way.
    let rows = table;

    // QUALIFICATION alone is both a section heading and, under CERTIFICATES
    // AND COURSES on one issued CV, the header of a single-column table. With
    // rows beneath it in that section it is the header, and reading it as
    // the section would drop every certificate that follows.
    if (
      section === "CERTIFICATES AND COURSES" &&
      rows.length > 1 &&
      (rows[0] ?? []).filter((c) => c.trim()).length === 1 &&
      normalise(rows[0][0] ?? "") === "QUALIFICATION"
    ) {
      for (const r of rows.slice(1)) {
        for (const line of (r[0] ?? "").split("\n")) {
          if (line.trim()) certificates.push({ a: line.trim(), b: "", c: "" });
        }
      }
      continue;
    }

    const leading = isHeadingRow(rows[0] ?? []);
    if (leading) {
      section = leading;
      rows = rows.slice(1);
      if (rows.length === 0) continue;
    }

    if (opensWith(rows, ["COMPANY", "POSITION", "DURATION"])) {
      career.push(...dataRows(rows, ["COMPANY", "POSITION", "DURATION"]));
      continue;
    }
    if (opensWith(rows, ["QUALIFICATION", "INSTITUTION", "YEAR"])) {
      const parsed = dataRows(rows, ["QUALIFICATION", "INSTITUTION", "YEAR"]);
      // Both tables share a shape, so the preceding heading decides which it is.
      (section === "CERTIFICATES AND COURSES" ? certificates : education).push(...parsed);
      continue;
    }
    // The SKILLSET table: category, the skills under it, and years per skill.
    // Its header reads SKILLS / PROFICIENCY / YEARS OF EXPERIENCE, though no
    // issued CV records a proficiency; the middle column is the skill list.
    if (opensWith(rows, ["SKILLS", "PROFICIENCY", "YEARS OF EXPERIENCE"])) {
      skillMatrix.push(...skillRows(rows));
      continue;
    }
    // The older template's matrix: skill with a self-rating out of ten, then
    // months of experience, then when it was last used. Category names sit
    // on rows of their own. Read into the same shape, with the rating and
    // the last-used date kept as a note.
    if (opensWith(rows, ["SKILL SELF RATING", "EXPERIENCE", "LAST USED"])) {
      skillMatrix.push(...matrixRows(rows));
      continue;
    }
    if (opensWith(rows, ["COMPANY NAME", "PROJECT NAME"])) {
      for (const r of dataRows(rows, ["COMPANY NAME", "PROJECT NAME"])) {
        const names = r.b.split("\n").map((l) => l.trim()).filter(Boolean);
        if (r.a || names.length) projects.push({ company: r.a, projects: names });
      }
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
    } else if (section === "ACHIEVEMENTS" || section === "OTHER ACHIEVEMENTS") {
      // Kept as written, sub-headings and all. Its shape differs on every CV
      // and it is read by people, not scored.
      achievementBlocks.push(text);
    } else if (section === "CERTIFICATIONS") {
      // A free-form block one CV carries beside the certificates table:
      // course names with providers and dates. Short lines that are not
      // dates are certificate names; the rest is kept with achievements.
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (t && t.length <= 90 && !/^\w+ \d{4}$/.test(t) && !/^[a-z]/.test(t)) {
          certificates.push({ a: t, b: "", c: "" });
        }
      }
      achievementBlocks.push(`Certifications:\n${text}`);
    } else if (section === "PROJECTS") {
      // Projects written as prose rather than the two-column table.
      achievementBlocks.push(`Projects:\n${text}`);
    } else if (section === "EMPLOYMENT RECORD" && rows.some((r) => normalise(r[0] ?? "").startsWith("COMPANY"))) {
      employment.push(...employmentBlocks(rows));
    }
  }

  // Certifications also sit in the qualification table on many of these CVs.
  const educationRows = education.filter((r) => !looksLikeCertification(r.a, r.b || null));
  const certFromEducation = education.filter((r) => looksLikeCertification(r.a, r.b || null));

  // And in the skills list: one CV puts PL-400, ITIL v4 and the Microsoft
  // fundamentals exams under SKILLS AND TRAINING, which is exactly where the
  // heading says they would be. Left as skills they score nothing against a
  // tender's certification requirement.
  const matrixSkills = skillMatrix.flatMap((c) => c.skills.map((s) => s.name));
  const allSkills = [...skills, ...matrixSkills];
  const certFromSkills = allSkills.filter(isCertificationEntry);
  const plainSkills = allSkills.filter((s) => !isCertificationEntry(s));

  // Split technical from professional, so a profile does not show every skill
  // in one column and an empty one beside it.
  const { technical, professional } = classifySkills(plainSkills);

  const workFromEmployment: WorkExperience[] = employment.map((b) => {
    const { start, end, current } = splitDuration(b.duration);
    return {
      title: b.role,
      company: b.company,
      client: b.client || null,
      location: null,
      employment_type: null,
      start_date: start,
      end_date: end,
      is_current: current,
      description: b.duties.join("\n") || null,
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
  // The figure the template states wins over one summed from the career
  // table, which double counts every overlapping contract.
  const years =
    statedYears(header.get("YEARS OF EXPERIENCE")) ?? yearsFromRows(durations, now.getUTCFullYear());

  return {
    full_name: header.get("FULL NAME")?.trim() || null,
    email: null,
    phone: null,
    current_role:
      statedRole ??
      mostRecentRole(career.map((r) => ({ position: r.b, duration: r.c }))) ??
      mostRecentRole(employment.map((b) => ({ position: b.role, duration: b.duration }))),
    additional_roles: [],
    years_experience: years,
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
    date_of_birth: header.get("DATE OF BIRTH")?.trim() || null,
    skill_matrix: skillMatrix,
    certificates: certificates
      .filter((r) => r.a)
      .map((r): Certificate => ({ name: r.a, institution: r.b || null, year: r.c || null })),
    projects,
    achievements: achievementBlocks.join("\n\n") || null,
  };
}
