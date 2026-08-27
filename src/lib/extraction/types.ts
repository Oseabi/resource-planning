import type {
  WorkExperience,
  Education,
  CandidateAvailability,
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
}

export interface ExtractionResult {
  fields: ExtractedCandidateFields;
  /** Full document text, shown beside the form so the recruiter can grab anything missed. */
  raw_text: string;
  /** Which engine produced this result. */
  engine: "local" | "ai";
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
