/**
 * The form's fields as candidate table columns.
 *
 * In a module of its own, with no server directive, because two things write
 * candidates: the form's actions and the bulk importer that loads a folder of
 * CVs. A "use server" file can only export async functions, so while this
 * lived in the actions the importer could not reach it, and a second copy
 * would have drifted the first time a column was added.
 *
 * Pure, no I/O.
 */
import type { CandidateFormFields } from "@/app/(app)/candidates/actions";
import type { Database } from "@/lib/supabase/database.types";
import { parseLongDate } from "@/lib/dates";
import {
  deriveTechnicalSkills,
  deriveCertifications,
  deriveQualifications,
  cleanSkillMatrix,
  cleanCertificates,
} from "@/lib/cv-record";
import { knownDepartmentIds, type DepartmentOption } from "@/lib/departments";

type CandidateUpdate = Database["public"]["Tables"]["candidates"]["Update"];

/**
 * Map the form contract to candidate table columns (shared by insert + update).
 * The departments are the ones that exist, once each: the trigger in the
 * database would refuse anything else, and this says so before it gets there.
 */
export function toCandidateColumns(fields: CandidateFormFields, departments: DepartmentOption[]): CandidateUpdate & { full_name: string } {
  // The structured tables are what the template prints; the flat lists are
  // what matching scores. The lists are derived from the tables on every
  // save, as a union, so neither has to be typed twice.
  const matrix = cleanSkillMatrix(fields.skill_matrix ?? []);
  const certificates = cleanCertificates(fields.certificates ?? []);
  return {
    full_name: fields.full_name.trim(),
    email: fields.email,
    phone: fields.phone,
    current_role: fields.current_role,
    additional_roles: fields.additional_roles,
    years_experience: fields.years_experience,
    professional_summary: fields.professional_summary,
    availability: fields.availability,
    availability_note: fields.availability_note?.trim() || null,
    designated_group: fields.designated_group,
    available_from: fields.available_from,
    status: fields.status,
    location: fields.location,
    notes: fields.notes,
    skills: fields.skills,
    technical_skills: deriveTechnicalSkills(matrix, fields.technical_skills),
    certifications: deriveCertifications(certificates, fields.certifications),
    qualifications: deriveQualifications(fields.education ?? [], fields.qualifications),
    sectors: fields.sectors,
    languages: fields.languages,
    resource_categories: fields.resource_categories,
    department_ids: knownDepartmentIds(fields.department_ids, departments),
    linkedin_url: fields.linkedin_url,
    portfolio_url: fields.portfolio_url,
    work_experience: fields.work_experience,
    education: fields.education,
    date_of_birth: parseLongDate(fields.date_of_birth),
    cv_as_of: parseLongDate(fields.cv_as_of),
    skill_matrix: matrix,
    certificates,
    projects: (fields.projects ?? [])
      .map((p) => ({ company: p.company.trim(), projects: p.projects.map((n) => n.trim()).filter(Boolean) }))
      .filter((p) => p.company || p.projects.length),
    achievements: fields.achievements?.trim() || null,
  };
}
