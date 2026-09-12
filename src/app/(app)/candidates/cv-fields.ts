import type { CandidateFormFields } from "@/app/(app)/candidates/actions";
import type { ExtractedFlags } from "@/app/(app)/candidates/candidate-fields";
import type { ExtractionResult, ExtractedCandidateFields } from "@/lib/extraction/types";
import { deriveCategories } from "@/lib/resource-categories";

/**
 * What an extraction becomes on the form, in one place.
 *
 * The review dialog builds a new record from a CV and the edit page lays a
 * replacement CV over an existing one. They used to keep separate lists of
 * the fields a CV carries, and the edit page's list stopped at the fields
 * the template had two revisions ago, so a replaced CV re-read the jobs and
 * silently dropped the skills table, the certificates, the projects and the
 * date of birth. One mapping, used by both.
 *
 * Pure, no I/O.
 */

function derivedCategories(f: ExtractedCandidateFields): string[] {
  return deriveCategories({
    skills: f.skills,
    technical_skills: f.technical_skills,
    current_role: f.current_role,
    additional_roles: f.additional_roles,
  });
}

/** A new record from a CV: everything the document said, and the system's defaults for the rest. */
export function fieldsFromExtraction(r: ExtractionResult): CandidateFormFields {
  const f = r.fields;
  return {
    full_name: f.full_name ?? "",
    email: f.email,
    phone: f.phone,
    current_role: f.current_role,
    additional_roles: f.additional_roles,
    years_experience: f.years_experience,
    professional_summary: f.professional_summary,
    // What the document said, when it said anything. The TiPP template
    // states it outright and the AI reads it off other CVs; this used to
    // discard both and write "available" over the top.
    availability: f.availability ?? "available",
    availability_note: f.availability_note ?? null,
    // A CV in another format rarely states this; the TiPP template does.
    designated_group: f.designated_group,
    // A CV never states this; it is set by hand when someone knows a date.
    available_from: null,
    status: "active",
    location: null,
    notes: null,
    skills: f.skills,
    technical_skills: f.technical_skills,
    certifications: f.certifications,
    qualifications: f.qualifications,
    sectors: f.sectors,
    languages: f.languages,
    resource_categories: derivedCategories(f),
    linkedin_url: f.linkedin_url,
    portfolio_url: f.portfolio_url,
    work_experience: f.work_experience,
    education: f.education,
    date_of_birth: f.date_of_birth ?? null,
    cv_as_of: f.cv_as_of ?? null,
    skill_matrix: f.skill_matrix ?? [],
    certificates: f.certificates ?? [],
    projects: f.projects ?? [],
    achievements: f.achievements ?? null,
  };
}

/** Which fields the document filled, so the form can say "auto-filled" beside them. */
export function flagsFromExtraction(r: ExtractionResult): ExtractedFlags {
  const f = r.fields;
  return {
    full_name: !!f.full_name,
    email: !!f.email,
    phone: !!f.phone,
    current_role: !!f.current_role,
    additional_roles: f.additional_roles.length > 0,
    years_experience: f.years_experience != null,
    professional_summary: !!f.professional_summary,
    skills: f.skills.length > 0,
    technical_skills: f.technical_skills.length > 0,
    certifications: f.certifications.length > 0,
    qualifications: f.qualifications.length > 0,
    sectors: f.sectors.length > 0,
    languages: f.languages.length > 0,
    resource_categories: derivedCategories(f).length > 0,
    linkedin_url: !!f.linkedin_url,
    portfolio_url: !!f.portfolio_url,
    work_experience: f.work_experience.length > 0,
    education: f.education.length > 0,
    designated_group: !!f.designated_group,
    availability: f.availability !== undefined,
    availability_note: !!f.availability_note,
    date_of_birth: !!f.date_of_birth,
    cv_as_of: !!f.cv_as_of,
    skill_matrix: (f.skill_matrix?.length ?? 0) > 0,
    certificates: (f.certificates?.length ?? 0) > 0,
    projects: (f.projects?.length ?? 0) > 0,
    achievements: !!f.achievements,
  };
}

const union = (a: string[], b: string[]) => Array.from(new Set([...a, ...b]));

/**
 * A replacement CV laid over an existing record.
 *
 * The new CV is the newer truth about the person, so every section it
 * carries replaces what the record had: the jobs, the education, the
 * skills table, the certificates, the projects, the achievements, the
 * summary and the header fields. Appending the jobs, as this once did,
 * doubled every job the moment somebody uploaded an updated copy of the
 * same CV. The flat matching lists are unioned, since they are re-derived
 * from the tables on save anyway, and the fields no CV carries (status,
 * notes, available from, location) are left alone. Anything the new CV did
 * not state keeps its current value rather than being blanked.
 */
export function mergeExtractionIntoFields(
  prev: CandidateFormFields,
  r: ExtractionResult,
): { fields: CandidateFormFields; flags: ExtractedFlags } {
  const fresh = fieldsFromExtraction(r);
  const flags = flagsFromExtraction(r);
  const next: CandidateFormFields = { ...prev };

  const replaceWhenSet = [
    "full_name",
    "email",
    "phone",
    "linkedin_url",
    "portfolio_url",
    "current_role",
    "professional_summary",
    "years_experience",
    "designated_group",
    "availability_note",
    "date_of_birth",
    "cv_as_of",
    "achievements",
  ] as const;
  for (const key of replaceWhenSet) {
    if (flags[key]) (next as Record<typeof key, unknown>)[key] = fresh[key];
  }
  if (flags.availability) next.availability = fresh.availability;

  const unionLists = [
    "additional_roles",
    "technical_skills",
    "skills",
    "certifications",
    "qualifications",
    "sectors",
    "languages",
  ] as const;
  for (const key of unionLists) {
    if (flags[key]) next[key] = union(prev[key], fresh[key]);
  }

  const replaceSections = ["work_experience", "education", "skill_matrix", "certificates", "projects"] as const;
  for (const key of replaceSections) {
    if (flags[key]) (next as Record<typeof key, unknown>)[key] = fresh[key];
  }

  // Categories suggested by the merged skills and roles, added to any set by hand.
  const derived = deriveCategories(next);
  if (derived.length) {
    const merged = union(prev.resource_categories, derived);
    if (merged.length !== prev.resource_categories.length) {
      next.resource_categories = merged;
      flags.resource_categories = true;
    } else {
      flags.resource_categories = false;
    }
  } else {
    flags.resource_categories = false;
  }

  return { fields: next, flags };
}
