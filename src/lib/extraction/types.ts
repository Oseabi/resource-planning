import type {
  WorkExperience,
  Education,
  CandidateAvailability,
  SkillCategory,
  Certificate,
  ProjectGroup,
} from "@/lib/supabase/database.types";

/**
 * Fields the extraction engine attempts to pull from a CV or RFQ/RFI document.
 * Every field is a best-effort guess and fully editable on the review form -
 * nothing is saved without human confirmation (plan Decision 2).
 */
export interface ExtractedCandidateFields {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  /** Primary (most recent / best-matched) role. */
  current_role: string | null;
  /** Any additional roles the candidate holds. */
  additional_roles: string[];
  years_experience: number | null;
  professional_summary: string | null;
  /** Professional / soft / domain skills. */
  skills: string[];
  /** Technical skills, languages, frameworks, tools, stacks. */
  technical_skills: string[];
  certifications: string[];
  qualifications: string[];
  sectors: string[];
  languages: string[];
  /** Stated outright on the TiPP Focus template; absent from most other CVs. */
  designated_group: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  work_experience: WorkExperience[];
  education: Education[];
  /**
   * Only set when the document states it outright, as the TiPP Focus template
   * does under AVAILABILITY. Undefined means the CV did not say, which is not
   * the same as saying the candidate is available.
   */
  availability?: CandidateAvailability;
  /** The CV's own words for it ("1 Calendar Month"), when it gave any. */
  availability_note?: string | null;

  // The rest is what the issued TiPP Focus template carries beyond the fields
  // above. Optional here because only the template parser fills them; the
  // generic heuristics and the AI leave them undefined.

  /** As written on the template, e.g. "05 February 1989". */
  date_of_birth?: string | null;
  /** The cover page's "As of date", as written. */
  cv_as_of?: string | null;
  /** The SKILLSET table, category by category. The flat lists above are derived from it. */
  skill_matrix?: SkillCategory[];
  /** CERTIFICATES AND COURSES with institution and year, where the flat list has names only. */
  certificates?: Certificate[];
  /** The PROJECTS table. */
  projects?: ProjectGroup[];
  /** The ACHIEVEMENTS section, verbatim, sub-headings kept. */
  achievements?: string | null;
}

export interface ExtractionResult {
  fields: ExtractedCandidateFields;
  /** Full document text, shown beside the form so the recruiter can grab anything missed. */
  raw_text: string;
  /** Which engine produced this result. */
  engine: "local" | "ai";
  /**
   * Why the AI did not run, or what it had to do to run, when either is worth
   * telling the reviewer. Absent in the ordinary case. Optional so the three
   * callers and the tender route did not have to change.
   */
  ai_note?: string;
  /**
   * True when no document text could be read (e.g. a scanned/image PDF with no
   * embedded text). The form then falls back to fully manual entry.
   */
  no_text_found: boolean;
}

export type SupportedMimeType =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** An empty result, every array present, every scalar null. */
export function emptyExtractedFields(): ExtractedCandidateFields {
  return {
    full_name: null,
    email: null,
    phone: null,
    current_role: null,
    additional_roles: [],
    years_experience: null,
    professional_summary: null,
    skills: [],
    technical_skills: [],
    certifications: [],
    qualifications: [],
    sectors: [],
    languages: [],
    designated_group: null,
    linkedin_url: null,
    portfolio_url: null,
    work_experience: [],
    education: [],
  };
}
