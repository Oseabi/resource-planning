import type {
  WorkExperience,
  Education,
  SkillCategory,
  Certificate,
  ProjectGroup,
} from "@/lib/supabase/database.types";

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
  /** The CV's own words, printed over the status label when present. */
  availability_note?: string | null;
  professional_summary: string | null;
  skills: string[];
  technical_skills: string[];
  certifications: string[];
  qualifications: string[];
  work_experience: WorkExperience[];
  education: Education[];
  /** ISO date or the template's own "05 February 1989"; either prints. */
  date_of_birth?: string | null;
  years_experience?: number | null;
  skill_matrix?: SkillCategory[];
  certificates?: Certificate[];
  projects?: ProjectGroup[];
  achievements?: string | null;
}

/**
 * Fields the issued template always prints and this record cannot fill.
 *
 * Returned as the labels the template itself uses, so what the screen says
 * matches what the person will see in the document. Certificates, projects
 * and achievements are not here: the template prints those only when the
 * CV had them, so their absence is not a gap.
 */
export function missingTemplateFields(source: CvSource): string[] {
  const missing: string[] = [];

  if (!source.full_name?.trim()) missing.push("Full name");
  if (!source.date_of_birth?.trim()) missing.push("Date of birth");
  if (!source.current_role?.trim()) missing.push("Position");
  if (!source.designated_group?.trim()) missing.push("Designated group");
  if (source.years_experience == null) missing.push("Years of experience");
  if (!source.availability?.trim() && !source.availability_note?.trim()) missing.push("Availability");
  if (!source.professional_summary?.trim()) missing.push("Candidate overview");
  if (source.work_experience.length === 0) missing.push("Career summary");
  // Either shape counts: older records carry qualifications as bare strings.
  if (source.education.length === 0 && source.qualifications.length === 0) {
    missing.push("Qualifications");
  }
  if (
    (source.skill_matrix ?? []).length === 0 &&
    source.skills.length === 0 &&
    source.technical_skills.length === 0
  ) {
    missing.push("Skillset");
  }

  return missing;
}
