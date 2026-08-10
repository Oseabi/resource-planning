export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type ProfileRole = "admin" | "user";
export type CandidateAvailability = "available" | "notice_period" | "unavailable";
export type CandidateStatus = "active" | "inactive" | "placed";
export type JobRequirementStatus = "open" | "closed" | "on_hold";
export type TenderStatus = "draft" | "live" | "submitted" | "won" | "lost";
/** Matching runs per position; the two parent types remain for legacy rows. */
export type MatchTargetType = "job_requirement" | "tender" | "position";
export type PlacementSourceType = "job_requirement" | "tender";
/** A position hangs off either a job requirement or a tender. */
export type PositionParentType = "job_requirement" | "tender";
/** A tender seat is proposed until the bid is won; a vacancy places at once. */
export type AssignmentStatus = "proposed" | "placed";
/** What a timeline entry hangs off. Polymorphic, so no FK backs it. */
export type ActivityEntityType = "candidate" | "tender" | "job_requirement" | "oem_letter";
/** A note is written by a person; an event is recorded by the system. */
export type ActivityKind = "note" | "event";

export interface WorkExperience {
  title: string;
  company: string;
  location?: string | null;
  employment_type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean;
  description?: string | null;
  achievements?: string | null;
}

export interface Education {
  qualification: string;
  field?: string | null;
  institution?: string | null;
  year?: string | null;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          role: ProfileRole;
          must_change_password: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          email: string;
          role?: ProfileRole;
          must_change_password?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      candidates: {
        Row: {
          id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          current_role: string | null;
          additional_roles: string[];
          years_experience: number | null;
          professional_summary: string | null;
          skills: string[];
          technical_skills: string[];
          certifications: string[];
          qualifications: string[];
          sectors: string[];
          languages: string[];
          resource_categories: string[];
          linkedin_url: string | null;
          portfolio_url: string | null;
          work_experience: WorkExperience[];
          education: Education[];
          availability: CandidateAvailability;
          /** Manual override for when they next come free; null means now. */
          available_from: string | null;
          status: CandidateStatus;
          location: string | null;
          cv_file_path: string | null;
          cv_original_filename: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          /** Generated column: concatenated searchable text. Read-only. */
          search_text: string;
        };
        Insert: Partial<Omit<Database["public"]["Tables"]["candidates"]["Row"], "search_text">> & {
          full_name: string;
        };
        Update: Partial<Omit<Database["public"]["Tables"]["candidates"]["Row"], "search_text">>;
        Relationships: [];
      };
      positions: {
        Row: {
          id: string;
          parent_type: PositionParentType;
          parent_id: string;
          role: string;
          /** Number of seats needed for this role. */
          quantity: number;
          min_experience_years: number | null;
          required_skills: string[];
          required_certifications: string[];
          required_availability: string | null;
          sort_order: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["positions"]["Row"]> & {
          parent_type: PositionParentType;
          parent_id: string;
          role: string;
        };
        Update: Partial<Database["public"]["Tables"]["positions"]["Row"]>;
        Relationships: [];
      };
      assignments: {
        Row: {
          id: string;
          position_id: string;
          candidate_id: string;
          status: AssignmentStatus;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["assignments"]["Row"]> & {
          position_id: string;
          candidate_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["assignments"]["Row"]>;
        Relationships: [];
      };
      oem_letters: {
        Row: {
          id: string;
          title: string;
          oem_vendor: string;
          /** Practice areas; shares vocabulary with candidates.resource_categories. */
          categories: string[];
          reference_number: string | null;
          issued_to: string | null;
          issue_date: string | null;
          expiry_date: string | null;
          notes: string | null;
          file_path: string | null;
          original_filename: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["oem_letters"]["Row"]> & {
          title: string;
          oem_vendor: string;
        };
        Update: Partial<Database["public"]["Tables"]["oem_letters"]["Row"]>;
        Relationships: [];
      };
      job_requirements: {
        Row: {
          id: string;
          title: string;
          client: string | null;
          required_role: string | null;
          required_skills: string[];
          required_certifications: string[];
          required_qualifications: string[];
          sectors: string[];
          min_experience_years: number | null;
          location: string | null;
          required_availability: string | null;
          manager_email: string | null;
          status: JobRequirementStatus;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["job_requirements"]["Row"]> & {
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["job_requirements"]["Row"]>;
        Relationships: [];
      };
      tenders: {
        Row: {
          id: string;
          title: string;
          /** Bid/reference number from the issuing authority. */
          reference_number: string | null;
          client: string | null;
          location: string | null;
          value: number | null;
          submission_deadline: string | null;
          contract_start_date: string | null;
          required_roles: string[];
          required_skills: string[];
          required_certifications: string[];
          sectors: string[];
          min_experience_years: number | null;
          status: TenderStatus;
          source_document_path: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["tenders"]["Row"]> & {
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["tenders"]["Row"]>;
        Relationships: [];
      };
      matches: {
        Row: {
          id: string;
          candidate_id: string;
          match_target_type: MatchTargetType;
          match_target_id: string;
          score: number;
          score_breakdown: Json;
          ai_deep_match_notes: string | null;
          alert_sent: boolean;
          alerted_score: number | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["matches"]["Row"]> & {
          candidate_id: string;
          match_target_type: MatchTargetType;
          match_target_id: string;
          score: number;
        };
        Update: Partial<Database["public"]["Tables"]["matches"]["Row"]>;
        Relationships: [];
      };
      match_alerts: {
        Row: {
          id: string;
          match_id: string;
          sent_to: string;
          sent_at: string;
          status: string;
        };
        Insert: Partial<Database["public"]["Tables"]["match_alerts"]["Row"]> & {
          match_id: string;
          sent_to: string;
          status: string;
        };
        Update: Partial<Database["public"]["Tables"]["match_alerts"]["Row"]>;
        Relationships: [];
      };
      placements: {
        Row: {
          id: string;
          candidate_id: string;
          source_type: PlacementSourceType;
          source_id: string;
          /** Which seat this filled; null for placements predating positions. */
          position_id: string | null;
          fee_value: number;
          start_date: string;
          /** Null means open ended, so the candidate stays committed. */
          end_date: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["placements"]["Row"]> & {
          candidate_id: string;
          source_type: PlacementSourceType;
          source_id: string;
          fee_value: number;
          start_date: string;
        };
        Update: Partial<Database["public"]["Tables"]["placements"]["Row"]>;
        Relationships: [];
      };
      activity: {
        Row: {
          id: string;
          entity_type: ActivityEntityType;
          entity_id: string;
          kind: ActivityKind;
          /** Events only: what happened. */
          action: string | null;
          /** Notes only: what the user wrote. */
          body: string | null;
          detail: Json;
          /** Null once the user who caused it has been removed. */
          actor_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["activity"]["Row"]> & {
          entity_type: ActivityEntityType;
          entity_id: string;
          kind: ActivityKind;
        };
        // No update policy exists; the trail is immutable once written.
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
