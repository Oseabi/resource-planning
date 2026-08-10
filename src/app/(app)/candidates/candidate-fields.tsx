"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagInput } from "@/components/ui/tag-input";
import { ComboboxInput } from "@/components/ui/combobox-input";
import { ExperienceEditor } from "@/app/(app)/candidates/experience-editor";
import { EducationEditor } from "@/app/(app)/candidates/education-editor";
import type { CandidateFormFields } from "@/app/(app)/candidates/actions";
import type { CandidateAvailability, CandidateStatus } from "@/lib/supabase/database.types";
import { CATEGORY_NAMES, deriveCategories } from "@/lib/resource-categories";

const AVAILABILITY_LABELS: Record<string, string> = {
  available: "Available",
  notice_period: "On notice period",
  unavailable: "Unavailable",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  placed: "Placed",
};

/** Which fields the extraction engine pre-filled, so we can highlight them. */
export type ExtractedFlags = Partial<Record<keyof CandidateFormFields, boolean>>;

export function CandidateFields({
  value,
  onChange,
  extracted = {},
}: {
  value: CandidateFormFields;
  onChange: (next: CandidateFormFields) => void;
  extracted?: ExtractedFlags;
}) {
  function set<K extends keyof CandidateFormFields>(key: K, val: CandidateFormFields[K]) {
    onChange({ ...value, [key]: val });
  }

  const ctx = { primaryRole: value.current_role, sectors: value.sectors };

  // Categories auto-detected from the skills/roles already entered, offered as
  // quick-add chips (the stored value stays explicit).
  const suggestedCategories = deriveCategories({
    skills: value.skills,
    technical_skills: value.technical_skills,
    current_role: value.current_role,
    additional_roles: value.additional_roles,
  });

  return (
    <div className="space-y-6">
      {/* Personal information */}
      <Section title="Personal information">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="cf-name" required highlight={extracted.full_name}>
            <Input id="cf-name" value={value.full_name} onChange={(e) => set("full_name", e.target.value)} required />
          </Field>
          <Field label="Email" htmlFor="cf-email" highlight={extracted.email}>
            <Input id="cf-email" type="email" value={value.email ?? ""} onChange={(e) => set("email", e.target.value || null)} />
          </Field>
          <Field label="Phone" htmlFor="cf-phone" highlight={extracted.phone}>
            <Input id="cf-phone" value={value.phone ?? ""} onChange={(e) => set("phone", e.target.value || null)} />
          </Field>
          <Field label="Location" htmlFor="cf-location" highlight={extracted.location}>
            <Input id="cf-location" value={value.location ?? ""} onChange={(e) => set("location", e.target.value || null)} />
          </Field>
          <Field label="LinkedIn" htmlFor="cf-linkedin" highlight={extracted.linkedin_url}>
            <Input id="cf-linkedin" value={value.linkedin_url ?? ""} onChange={(e) => set("linkedin_url", e.target.value || null)} placeholder="linkedin.com/in/..." />
          </Field>
          <Field label="Portfolio / GitHub" htmlFor="cf-portfolio" highlight={extracted.portfolio_url}>
            <Input id="cf-portfolio" value={value.portfolio_url ?? ""} onChange={(e) => set("portfolio_url", e.target.value || null)} placeholder="github.com/..." />
          </Field>
        </div>
      </Section>

      {/* Professional details */}
      <Section title="Professional details">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Primary role" htmlFor="cf-role" highlight={extracted.current_role}>
            <ComboboxInput
              id="cf-role"
              value={value.current_role}
              onChange={(v) => set("current_role", v)}
              field="roles"
              context={{ sectors: value.sectors }}
              placeholder="e.g. ERP Consultant"
              highlight={extracted.current_role}
            />
          </Field>
          <Field label="Years of experience" htmlFor="cf-years" highlight={extracted.years_experience}>
            <Input id="cf-years" type="number" min={0} step={0.5} value={value.years_experience ?? ""} onChange={(e) => set("years_experience", e.target.value === "" ? null : Number(e.target.value))} />
          </Field>
          <Field label="Availability" htmlFor="cf-availability">
            <Select value={value.availability} onValueChange={(v) => set("availability", v as CandidateAvailability)}>
              <SelectTrigger id="cf-availability" className="w-full">
                <SelectValue>{(v) => AVAILABILITY_LABELS[String(v)] ?? "Available"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="notice_period">On notice period</SelectItem>
                <SelectItem value="unavailable">Unavailable</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status" htmlFor="cf-status">
            <Select value={value.status} onValueChange={(v) => set("status", v as CandidateStatus)}>
              <SelectTrigger id="cf-status" className="w-full">
                <SelectValue>{(v) => STATUS_LABELS[String(v)] ?? "Active"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="placed">Placed</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {/* Only needed when no placement explains the gap, e.g. parental leave
              or a candidate who has told you a date directly. */}
          <Field label="Available from" htmlFor="cf-available-from">
            <Input
              id="cf-available-from"
              type="date"
              value={value.available_from ?? ""}
              onChange={(e) => set("available_from", e.target.value || null)}
            />
            <p className="mt-1 text-body-sm text-muted-foreground">
              Leave blank unless they are unavailable for a reason no placement records.
            </p>
          </Field>
        </div>
        <Field label="Additional roles" highlight={extracted.additional_roles}>
          <TagInput value={value.additional_roles} onChange={(v) => set("additional_roles", v)} field="roles" context={ctx} placeholder="Add another role this person can fill..." highlight={extracted.additional_roles} />
        </Field>
        <Field label="Resource categories" highlight={extracted.resource_categories}>
          <TagInput
            value={value.resource_categories}
            onChange={(v) => set("resource_categories", v)}
            suggestions={CATEGORY_NAMES}
            quickAdd={suggestedCategories}
            placeholder="e.g. ERP, EA, Data & BI..."
            highlight={extracted.resource_categories}
          />
          <p className="mt-1 text-body-sm text-muted-foreground">
            High-level practice areas for filtering (e.g. &ldquo;show me ERP resources&rdquo;). Chips below
            are auto-detected from this person&apos;s skills &amp; roles.
          </p>
        </Field>
        <Field label="Professional summary" htmlFor="cf-summary" highlight={extracted.professional_summary}>
          <Textarea id="cf-summary" rows={4} value={value.professional_summary ?? ""} onChange={(e) => set("professional_summary", e.target.value || null)} placeholder="A short professional summary..." />
        </Field>
      </Section>

      {/* Skills, certifications & qualifications */}
      <Section title="Skills, certifications & qualifications">
        <Field label="Technical skills" highlight={extracted.technical_skills}>
          <TagInput value={value.technical_skills} onChange={(v) => set("technical_skills", v)} field="technical_skills" context={ctx} placeholder="Languages, frameworks, tools..." highlight={extracted.technical_skills} />
        </Field>
        <Field label="Professional skills" highlight={extracted.skills}>
          <TagInput value={value.skills} onChange={(v) => set("skills", v)} field="skills" context={ctx} placeholder="Domain & soft skills..." highlight={extracted.skills} />
        </Field>
        <Field label="Certifications" highlight={extracted.certifications}>
          <TagInput value={value.certifications} onChange={(v) => set("certifications", v)} field="certifications" context={ctx} placeholder="Add a certification..." highlight={extracted.certifications} />
        </Field>
        <Field label="Qualifications" highlight={extracted.qualifications}>
          <TagInput value={value.qualifications} onChange={(v) => set("qualifications", v)} field="qualifications" context={ctx} placeholder="Add a qualification..." highlight={extracted.qualifications} />
        </Field>
        <Field label="Sectors" highlight={extracted.sectors}>
          <TagInput value={value.sectors} onChange={(v) => set("sectors", v)} field="sectors" context={ctx} placeholder="Add a sector..." highlight={extracted.sectors} />
        </Field>
        <Field label="Languages" highlight={extracted.languages}>
          <TagInput value={value.languages} onChange={(v) => set("languages", v)} field="languages" context={ctx} placeholder="Add a language..." highlight={extracted.languages} />
        </Field>
      </Section>

      {/* Work experience */}
      <Section title="Work experience">
        <ExperienceEditor value={value.work_experience} onChange={(v) => set("work_experience", v)} highlight={extracted.work_experience} />
      </Section>

      {/* Education */}
      <Section title="Education">
        <EducationEditor value={value.education} onChange={(v) => set("education", v)} highlight={extracted.education} />
      </Section>

      {/* Notes */}
      <Section title="Notes">
        <Textarea rows={3} value={value.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} placeholder="Internal notes about this candidate..." />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="text-label-sm uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  required,
  highlight,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="text-destructive"> *</span>}
        </Label>
        {highlight && (
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-label-sm text-primary">auto-filled</span>
        )}
      </div>
      {children}
    </div>
  );
}

export const EMPTY_CANDIDATE: CandidateFormFields = {
  full_name: "",
  email: null,
  phone: null,
  current_role: null,
  additional_roles: [],
  years_experience: null,
  professional_summary: null,
  availability: "available",
  available_from: null,
  status: "active",
  location: null,
  notes: null,
  skills: [],
  technical_skills: [],
  certifications: [],
  qualifications: [],
  sectors: [],
  languages: [],
  resource_categories: [],
  linkedin_url: null,
  portfolio_url: null,
  work_experience: [],
  education: [],
};
