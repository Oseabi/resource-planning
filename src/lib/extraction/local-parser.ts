import {
  VOCABULARY,
  ALL_TECHNICAL_SKILLS,
  ALL_SKILLS,
} from "@/lib/vocabulary";
import {
  extractEmail,
  extractPhone,
  matchDictionary,
  guessName,
  guessRole,
  guessExperienceYears,
  parseListItems,
  parseCertificationItems,
  classifySkills,
  parseExperience,
  parseEducation,
  extractLinks,
  extractLanguages,
  explicitExperienceYears,
} from "@/lib/extraction/heuristics";
import { splitSections } from "@/lib/extraction/sections";
import { emptyExtractedFields, type ExtractedCandidateFields } from "@/lib/extraction/types";
import { parseTippTemplate } from "@/lib/extraction/tipp-template";
import { parseTippTables } from "@/lib/extraction/tipp-tables";
import type { DocumentTables } from "@/lib/extraction/docx-tables";

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(v.trim());
    }
  }
  return out;
}

/** Remove any items already present (case-insensitive) in `exclude`. */
function without(values: string[], exclude: string[]): string[] {
  const ex = new Set(exclude.map((v) => v.toLowerCase()));
  return values.filter((v) => !ex.has(v.toLowerCase()));
}

/** Drop items wholly contained in a longer sibling ("SuccessFactors" vs "SAP SuccessFactors"). */
function dropSubsumed(values: string[]): string[] {
  return values.filter((value) => {
    const lower = value.toLowerCase();
    return !values.some((other) => {
      if (other === value) return false;
      const otherLower = other.toLowerCase();
      return otherLower.length > lower.length && otherLower.includes(lower);
    });
  });
}

/** Estimate total years from experience date ranges (current year for "present"). */
function yearsFromExperience(entries: { start_date?: string | null; end_date?: string | null; is_current?: boolean }[]): number | null {
  const yearOf = (s?: string | null) => {
    const m = s?.match(/(19|20)\d{2}/);
    return m ? Number(m[0]) : null;
  };
  let minStart: number | null = null;
  let maxEnd: number | null = null;
  const now = new Date().getFullYear();
  for (const e of entries) {
    const start = yearOf(e.start_date);
    if (start && (minStart === null || start < minStart)) minStart = start;
    const end = e.is_current ? now : yearOf(e.end_date);
    if (end && (maxEnd === null || end > maxEnd)) maxEnd = end;
  }
  if (minStart === null) return null;
  const span = (maxEnd ?? now) - minStart;
  return span > 0 && span < 60 ? span : null;
}

/**
 * Roles from the headline under a candidate's name, e.g.
 * "Enterprise Architect | Programme Executive | Delivery Leader". Contact lines
 * (which also use pipes) are skipped via their digits/@ markers.
 */
function headlineRoles(preamble: string): string[] {
  const lines = preamble.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  for (const line of lines.slice(0, 5)) {
    if (!line.includes("|")) continue;
    if (line.includes("@") || /\d{3}/.test(line)) continue; // phone / email row
    for (const part of line.split("|")) {
      const value = part.trim().replace(/[.,;]+$/, "");
      if (value.length < 4 || value.length > 60) continue;
      if (value.split(/\s+/).length > 7) continue;
      if (!/^[A-Za-z][A-Za-z\s&/'’-]*$/.test(value)) continue;
      out.push(value);
    }
  }
  return out;
}

/**
 * Turn raw document text into best-effort candidate fields using free local,
 * section-aware heuristics + the seeded vocabulary. No AI, no network. Every
 * value is editable on the review form before saving.
 */
export function parseTextToFields(
  text: string,
  filename?: string,
  tables: DocumentTables = [],
): ExtractedCandidateFields {
  // Real tables beat reconstructed ones, so they are tried first. Falls through
  // for PDFs, which carry no table structure, and for anything the table reader
  // does not recognise as the template.
  const fromTables = tables.length > 0 ? parseTippTables(tables) : null;
  if (fromTables) {
    // Some of the template's content is not in a table at all: contact details
    // sit in the page header, and one CV writes its summary as a loose
    // paragraph between two tables. Those fields are read from the text and
    // filled in behind the table result, which stays authoritative for
    // everything it did find.
    const fromText = parseTippTemplate(text);
    return {
      ...fromTables,
      email: fromTables.email ?? extractEmail(text),
      phone: fromTables.phone ?? extractPhone(text),
      linkedin_url: fromTables.linkedin_url ?? extractLinks(text).linkedin_url,
      professional_summary: fromTables.professional_summary ?? fromText?.professional_summary ?? null,
    };
  }

  // Every CV the business receives comes off one Word template, and its tables
  // flatten in a way the generic heuristics below read badly, reporting the
  // table header as the candidate role. When the template is recognised its own
  // parser is authoritative.
  const templated = parseTippTemplate(text);
  if (templated) return templated;

  const fields = emptyExtractedFields();
  const { preamble, sections } = splitSections(text);

  // --- Contact / identity (from the top block, falling back to whole text) ---
  fields.full_name = guessName(preamble || text, filename);
  fields.email = extractEmail(text);
  fields.phone = extractPhone(text);
  const links = extractLinks(text);
  fields.linkedin_url = links.linkedin_url;
  fields.portfolio_url = links.portfolio_url;

  // --- Summary ---
  if (sections.summary) {
    fields.professional_summary = sections.summary.replace(/\s+/g, " ").trim().slice(0, 1200) || null;
  }

  // --- Skills (section items + whole-text dictionary), split technical/professional ---
  const sectionSkillItems = [
    ...parseListItems(sections.technical_skills ?? ""),
    ...parseListItems(sections.skills ?? ""),
  ];
  const classified = classifySkills(sectionSkillItems);
  // Anything under an explicit "technical skills" heading is technical.
  const explicitTech = parseListItems(sections.technical_skills ?? "");

  const technical = dropSubsumed(
    dedupe([
      ...matchDictionary(text, [...ALL_TECHNICAL_SKILLS]),
      ...explicitTech,
      ...classified.technical,
    ]),
  );
  const professional = without(
    dedupe([...matchDictionary(text, [...ALL_SKILLS]), ...classified.professional]),
    technical,
  );
  fields.technical_skills = technical;
  fields.skills = professional;

  // --- Certifications (one per line; commas would shred awarding bodies) ---
  const certItems = dedupe([
    ...matchDictionary(text, [...VOCABULARY.certifications]),
    ...parseCertificationItems(sections.certifications ?? ""),
  ]);

  // --- Sectors ---
  fields.sectors = matchDictionary(text, [...VOCABULARY.sectors]);

  // --- Languages (prefer the dedicated section so prose can't leak in) ---
  fields.languages = dedupe(extractLanguages(sections.languages ?? text));

  // --- Education & Qualifications ---
  fields.education = parseEducation(sections.education ?? "");
  const degreeText = fields.education.map((e) => e.qualification);
  // The dictionary pass runs over the education section rather than the whole
  // CV. Degree abbreviations are short and collide with everything else: "BA"
  // means Business Analyst far more often than Bachelor of Arts, and one CV
  // using it that way was credited with a degree it never mentioned. Falls back
  // to the whole text when a CV has no education section to look in.
  //
  // dropSubsumed, because the dictionary yields the bare abbreviation while the
  // education parse yields the full award, and the list carried both: a
  // candidate appeared to hold a "BCom" and a "BCom Information Systems".
  const qualificationSource = sections.education || text;
  fields.qualifications = dropSubsumed(
    dedupe([
      ...matchDictionary(qualificationSource, [...VOCABULARY.qualifications]),
      ...degreeText,
    ]),
  );
  // A combined "Education & Certifications" heading feeds both sections, so drop
  // anything already captured as a degree from the certification list.
  fields.certifications = certItems.filter(
    (c) => !degreeText.some((d) => d.toLowerCase().startsWith(c.toLowerCase().slice(0, 25))),
  );

  // --- Experience & roles ---
  fields.work_experience = parseExperience(sections.experience ?? "");
  const experienceTitles = fields.work_experience
    .map((e) => e.title)
    .filter((t) => t && t !== "Role");
  const headline = headlineRoles(preamble);
  const dictRole = guessRole(text, [...VOCABULARY.roles]);
  const primary = experienceTitles[0] ?? headline[0] ?? dictRole;
  fields.current_role = primary ?? null;
  fields.additional_roles = without(
    dedupe([
      ...headline,
      ...experienceTitles.slice(1),
      ...matchDictionary(text, [...VOCABULARY.roles]),
    ]),
    primary ? [primary] : [],
  ).slice(0, 6);

  // --- Years of experience ---
  // An explicit "19 years of experience" beats a date-span estimate, which
  // over-counts when early-career odd jobs are listed.
  fields.years_experience =
    explicitExperienceYears(text) ??
    yearsFromExperience(fields.work_experience) ??
    guessExperienceYears(text);

  return fields;
}
