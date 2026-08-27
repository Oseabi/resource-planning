import type { WorkExperience, Education } from "@/lib/supabase/database.types";

/**
 * The pure half of the CV export, kept out of build-tipp-cv.ts because that
 * module is server-only. The review screen is a client component and needs to
 * warn about gaps as the form is corrected, which means this has to run in the
 * browser too.
 */

/** The subset of a candidate the template needs. Anything else is ignored. */
export interface CvSource {
  full_name: string;
  current_role: string | null;
  designated_group: string | null;
  languages: string[];
  availability: string | null;
  professional_summary: string | null;
  skills: string[];
  technical_skills: string[];
  certifications: string[];
  qualifications: string[];
  work_experience: WorkExperience[];
  education: Education[];
}

/**
 * Fields the template has a row for and this record cannot fill.
 *
 * Returned as the labels the template itself uses, so what the screen says
 * matches what the person will see in the document.
 */
export function missingTemplateFields(source: CvSource): string[] {
  const missing: string[] = [];

  if (!source.full_name?.trim()) missing.push("Full name");
  if (!source.current_role?.trim()) missing.push("Position");
  if (!source.designated_group?.trim()) missing.push("Designated group");
  if (source.languages.length === 0) missing.push("Languages");
  if (!source.availability?.trim()) missing.push("Availability");
  if (!source.professional_summary?.trim()) missing.push("Candidate summary");
  if (source.work_experience.length === 0) missing.push("Career summary");
  // Either shape counts: older records carry qualifications as bare strings.
  if (source.education.length === 0 && source.qualifications.length === 0) {
    missing.push("Qualifications");
  }
  if (source.skills.length === 0 && source.technical_skills.length === 0) {
    missing.push("Skills");
  }

  return missing;
}
