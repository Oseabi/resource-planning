export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** Mirrors the profiles_role_check constraint. Change both or they disagree. */
export type ProfileRole = "admin" | "manager" | "user";
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
      audit_log: {
        Row: {
          id: string;
          /** Null once the person has been removed; the record of what they did stays. */
          actor_id: string | null;
          /** Copied at write time, so the row still names somebody after that. */
          actor_email: string | null;
          actor_name: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          /** The name it had when it happened, so a deleted record still reads. */
          entity_label: string | null;
          detail: Json;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["audit_log"]["Row"]> & {
          action: string;
          entity_type: string;
        };
        /** Append only. No update or delete policy exists, deliberately. */
        Update: never;
        Relationships: [];
      };
      user_sessions: {
        Row: {
          id: string;
          user_id: string;
          started_at: string;
          /** Moved forward by the heartbeat; the moment a session really ended. */
          last_seen_at: string;
          /** Set only on a deliberate sign-out. Most sessions just stop beating. */
          ended_at: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["user_sessions"]["Row"]> & {
          user_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_sessions"]["Insert"]>;
        Relationships: [];
      };
      departments: {
        Row: {
          id: string;
          /** Renameable, and shown everywhere. */
          name: string;
          /** Immutable handle. Imports key off this, so a rename breaks nothing. */
          slug: string;
          sort_order: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["departments"]["Row"]> & {
          name: string;
          slug: string;
        };
        Update: Partial<Database["public"]["Tables"]["departments"]["Insert"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          role: ProfileRole;
          /** The business unit this person belongs to. Null for admins, who see all four. */
          department_id: string | null;
          must_change_password: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          email: string;
          role?: ProfileRole;
          department_id?: string | null;
          must_change_password?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        // Declared so getCurrentProfile can embed departments(name) in the
        // query it already makes, rather than paying a second round-trip on
        // every request just to put a department on the sidebar.
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
        ];
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
          /** Employment equity group, as it should read on a submitted CV. */
          designated_group: string | null;
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
      reference_letters: {
        Row: {
          id: string;
          /** Who signed it. */
          client: string;
          project_title: string;
          /** Practice areas; shares vocabulary with candidates.resource_categories. */
          categories: string[];
          sectors: string[];
          /** Tenders qualify references by size and recency, so both are held. */
          contract_value: number | null;
          work_started_on: string | null;
          work_completed_on: string | null;
          issue_date: string | null;
          contact_name: string | null;
          contact_email: string | null;
          contact_phone: string | null;
          reference_number: string | null;
          notes: string | null;
          file_path: string | null;
          original_filename: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["reference_letters"]["Row"]> & {
          client: string;
          project_title: string;
        };
        Update: Partial<Database["public"]["Tables"]["reference_letters"]["Row"]>;
        Relationships: [];
      };
      job_requirements: {
        Row: {
          id: string;
          title: string;
          /** The business unit that owns this vacancy. Decides who can see it. */
          department_id: string;
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
          /** The business unit that owns this bid. Decides who can see it. */
          department_id: string;
          /** Bid/reference number from the issuing authority. */
          reference_number: string | null;
          client: string | null;
          location: string | null;
          value: number | null;
          submission_deadline: string | null;
          contract_start_date: string | null;
          /** When the awarded contract finishes. Null means open ended. */
          contract_end_date: string | null;
          /** Client reference letters this tender asks for. Null means not yet read off the RFQ. */
          reference_letters_required: number | null;
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
    Functions: {
      /**
       * Every candidate's commitment dates, company wide, regardless of which
       * department owns the placement.
       *
       * placements is department scoped because it names a project and a
       * client. "Is this person free on the start date" has to be answerable
       * across the whole business, or seat coverage reports somebody already
       * contracted to another department as available and invites a double
       * booking. This returns the three columns that answer it and nothing
       * else.
       */
      candidate_commitments: {
        Args: Record<string, never>;
        Returns: { candidate_id: string; start_date: string; end_date: string | null }[];
      };
    };
  };
}
