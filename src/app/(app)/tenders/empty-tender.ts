import type { TenderFormFields } from "@/app/(app)/tenders/actions";

/**
 * A blank tender, as the create form starts.
 *
 * Deliberately in a module of its own with no "use client" directive, so a
 * server component can read it. A constant exported from a client module
 * reaches the server as a reference, not a value: React lets you pass that
 * name straight through to a client component but not dot into it, and
 * spreading it yields an empty object in silence. The create page spreads
 * this to set a default department, and when it lived in tender-fields.tsx
 * every field vanished, so the positions editor was handed undefined and the
 * whole page threw.
 */
export const EMPTY_TENDER: TenderFormFields = {
  title: "",
  department_id: null,
  positions: [],
  reference_number: null,
  client: null,
  location: null,
  summary: null,
  submission_deadline: null,
  contract_start_date: null,
  contract_end_date: null,
  reference_letters_required: null,
  reference_letters_note: null,
  reference_letters_within_years: null,
  reference_letters_min_value: null,
  required_roles: [],
  required_skills: [],
  required_certifications: [],
  sectors: [],
  min_experience_years: null,
  status: "draft",
};
