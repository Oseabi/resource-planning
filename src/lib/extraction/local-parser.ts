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
  classifySkills,
  parseExperience,
  parseEducation,
  extractLinks,
  extractLanguages,
} from "@/lib/extraction/heuristics";
import { splitSections } from "@/lib/extraction/sections";
import { emptyExtractedFields, type ExtractedCandidateFields } from "@/lib/extraction/types";

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
 * Turn raw document text into best-effort candidate fields using free local,
 * section-aware heuristics + the seeded vocabulary. No AI, no network. Every
 * value is editable on the review form before saving.
 */
export function parseTextToFields(text: string, filename?: string): ExtractedCandidateFields {
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

  const technical = dedupe([
    ...matchDictionary(text, [...ALL_TECHNICAL_SKILLS]),
    ...explicitTech,
    ...classified.technical,
  ]);
  const professional = without(
    dedupe([...matchDictionary(text, [...ALL_SKILLS]), ...classified.professional]),
    technical,
  );
  fields.technical_skills = technical;
  fields.skills = professional;

  // --- Certifications ---
  fields.certifications = dedupe([
    ...matchDictionary(text, [...VOCABULARY.certifications]),
    ...parseListItems(sections.certifications ?? ""),
  ]);

  // --- Sectors ---
  fields.sectors = matchDictionary(text, [...VOCABULARY.sectors]);

  // --- Languages ---
  fields.languages = dedupe([
    ...extractLanguages(text),
    ...parseListItems(sections.languages ?? ""),
  ]);

  // --- Education & Qualifications ---
  fields.education = parseEducation(sections.education ?? "");
  fields.qualifications = dedupe([
    ...matchDictionary(text, [...VOCABULARY.qualifications]),
    ...fields.education.map((e) => e.qualification),
  ]);

  // --- Experience & roles ---
  fields.work_experience = parseExperience(sections.experience ?? "");
  const experienceTitles = fields.work_experience
    .map((e) => e.title)
    .filter((t) => t && t !== "Role");
  const dictRole = guessRole(text, [...VOCABULARY.roles]);
  const primary = experienceTitles[0] ?? dictRole;
  fields.current_role = primary ?? null;
  fields.additional_roles = without(
    dedupe([
      ...experienceTitles.slice(1),
      ...matchDictionary(text, [...VOCABULARY.roles]),
    ]),
    primary ? [primary] : [],
  ).slice(0, 6);

  // --- Years of experience ---
  fields.years_experience = yearsFromExperience(fields.work_experience) ?? guessExperienceYears(text);

  return fields;
}
