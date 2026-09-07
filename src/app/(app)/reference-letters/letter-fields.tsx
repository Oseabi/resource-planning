"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TagInput } from "@/components/ui/tag-input";
import { CATEGORY_NAMES } from "@/lib/resource-categories";
import type { ReferenceLetterFormFields } from "@/app/(app)/reference-letters/actions";

export const EMPTY_REFERENCE_LETTER: ReferenceLetterFormFields = {
  client: "",
  project_title: "",
  categories: [],
  sectors: [],
  contract_value: null,
  work_started_on: null,
  work_completed_on: null,
  issue_date: null,
  contact_name: null,
  contact_email: null,
  contact_phone: null,
  reference_number: null,
  notes: null,
};

export function ReferenceLetterFields({
  value,
  onChange,
}: {
  value: ReferenceLetterFormFields;
  onChange: (next: ReferenceLetterFormFields) => void;
}) {
  function set<K extends keyof ReferenceLetterFormFields>(
    key: K,
    val: ReferenceLetterFormFields[K],
  ) {
    onChange({ ...value, [key]: val });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Client" htmlFor="rl-client" required>
          <Input
            id="rl-client"
            value={value.client}
            onChange={(e) => set("client", e.target.value)}
            placeholder="e.g. City of Cape Town"
          />
        </Field>
        <Field label="Project" htmlFor="rl-project" required>
          <Input
            id="rl-project"
            value={value.project_title}
            onChange={(e) => set("project_title", e.target.value)}
            placeholder="e.g. ERP support and maintenance"
          />
        </Field>
        {/* Tenders qualify references by size and recency, so both matter as
            much as who signed it. */}
        <Field label="Contract value" htmlFor="rl-value">
          <Input
            id="rl-value"
            type="number"
            min={0}
            step="0.01"
            value={value.contract_value ?? ""}
            onChange={(e) => set("contract_value", e.target.value === "" ? null : Number(e.target.value))}
            placeholder="e.g. 12500000"
          />
        </Field>
        <Field label="Reference number" htmlFor="rl-ref">
          <Input
            id="rl-ref"
            value={value.reference_number ?? ""}
            onChange={(e) => set("reference_number", e.target.value || null)}
          />
        </Field>
        <Field label="Work started" htmlFor="rl-started">
          <Input
            id="rl-started"
            type="date"
            value={value.work_started_on ?? ""}
            onChange={(e) => set("work_started_on", e.target.value || null)}
          />
        </Field>
        <Field label="Work completed" htmlFor="rl-completed">
          <Input
            id="rl-completed"
            type="date"
            min={value.work_started_on ?? undefined}
            value={value.work_completed_on ?? ""}
            onChange={(e) => set("work_completed_on", e.target.value || null)}
          />
        </Field>
        <Field label="Letter date" htmlFor="rl-issued">
          <Input
            id="rl-issued"
            type="date"
            value={value.issue_date ?? ""}
            onChange={(e) => set("issue_date", e.target.value || null)}
          />
        </Field>
      </div>

      <div>
        <h3 className="text-label-sm uppercase tracking-wide text-muted-foreground">Contact</h3>
        <p className="mt-1 text-body-sm text-muted-foreground">
          Most tenders ask for contactable references. A letter with no way to reach the signatory
          does not count toward the requirement.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Name" htmlFor="rl-contact-name">
            <Input
              id="rl-contact-name"
              value={value.contact_name ?? ""}
              onChange={(e) => set("contact_name", e.target.value || null)}
            />
          </Field>
          <Field label="Email" htmlFor="rl-contact-email">
            <Input
              id="rl-contact-email"
              type="email"
              value={value.contact_email ?? ""}
              onChange={(e) => set("contact_email", e.target.value || null)}
            />
          </Field>
          <Field label="Phone" htmlFor="rl-contact-phone">
            <Input
              id="rl-contact-phone"
              value={value.contact_phone ?? ""}
              onChange={(e) => set("contact_phone", e.target.value || null)}
            />
          </Field>
        </div>
      </div>

      <Field label="Practice areas">
        <TagInput
          value={value.categories}
          onChange={(v) => set("categories", v)}
          suggestions={CATEGORY_NAMES}
          placeholder="Add a practice area..."
        />
      </Field>

      <Field label="Sectors">
        <TagInput
          value={value.sectors}
          onChange={(v) => set("sectors", v)}
          field="sectors"
          placeholder="Add a sector..."
        />
      </Field>

      <Field label="Notes" htmlFor="rl-notes">
        <Textarea
          id="rl-notes"
          rows={3}
          value={value.notes ?? ""}
          onChange={(e) => set("notes", e.target.value || null)}
          placeholder="Anything a bid writer should know about using this reference."
        />
      </Field>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-label-md font-medium text-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      {children}
    </div>
  );
}
