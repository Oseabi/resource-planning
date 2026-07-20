"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagInput } from "@/components/ui/tag-input";
import type { TenderFormFields } from "@/app/(app)/tenders/actions";
import type { TenderStatus } from "@/lib/supabase/database.types";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  live: "Live",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
};

/** Which fields the RFQ parser pre-filled, for auto-filled highlights. */
export type TenderExtractedFlags = Partial<Record<keyof TenderFormFields, boolean>>;

export const EMPTY_TENDER: TenderFormFields = {
  title: "",
  client: null,
  location: null,
  value: null,
  submission_deadline: null,
  contract_start_date: null,
  required_roles: [],
  required_skills: [],
  required_certifications: [],
  sectors: [],
  min_experience_years: null,
  status: "draft",
};

export function TenderFields({
  value,
  onChange,
  extracted = {},
}: {
  value: TenderFormFields;
  onChange: (next: TenderFormFields) => void;
  extracted?: TenderExtractedFlags;
}) {
  function set<K extends keyof TenderFormFields>(key: K, val: TenderFormFields[K]) {
    onChange({ ...value, [key]: val });
  }

  const ctx = { sectors: value.sectors };

  return (
    <div className="space-y-6">
      <Section title="Tender details">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="tf-title" required highlight={extracted.title}>
            <Input id="tf-title" value={value.title} onChange={(e) => set("title", e.target.value)} required />
          </Field>
          <Field label="Client" htmlFor="tf-client" highlight={extracted.client}>
            <Input id="tf-client" value={value.client ?? ""} onChange={(e) => set("client", e.target.value || null)} />
          </Field>
          <Field label="Location" htmlFor="tf-location" highlight={extracted.location}>
            <Input id="tf-location" value={value.location ?? ""} onChange={(e) => set("location", e.target.value || null)} />
          </Field>
          <Field label="Value" htmlFor="tf-value" highlight={extracted.value}>
            <Input id="tf-value" type="number" min={0} step="0.01" value={value.value ?? ""} onChange={(e) => set("value", e.target.value === "" ? null : Number(e.target.value))} placeholder="e.g. 12500000" />
          </Field>
          <Field label="Submission deadline" htmlFor="tf-deadline" highlight={extracted.submission_deadline}>
            <Input id="tf-deadline" type="date" value={value.submission_deadline ?? ""} onChange={(e) => set("submission_deadline", e.target.value || null)} />
          </Field>
          <Field label="Contract start date" htmlFor="tf-start" highlight={extracted.contract_start_date}>
            <Input id="tf-start" type="date" value={value.contract_start_date ?? ""} onChange={(e) => set("contract_start_date", e.target.value || null)} />
          </Field>
          <Field label="Status" htmlFor="tf-status">
            <Select value={value.status} onValueChange={(v) => set("status", v as TenderStatus)}>
              <SelectTrigger id="tf-status" className="w-full">
                <SelectValue>{(v) => STATUS_LABELS[String(v)] ?? "Draft"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="live">Live</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="won">Won</SelectItem>
                <SelectItem value="lost">Lost</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="Team requirements">
        <Field label="Min. years experience" htmlFor="tf-minexp" highlight={extracted.min_experience_years}>
          <Input
            id="tf-minexp"
            type="number"
            min={0}
            step={0.5}
            className="sm:max-w-xs"
            value={value.min_experience_years ?? ""}
            onChange={(e) => set("min_experience_years", e.target.value === "" ? null : Number(e.target.value))}
            placeholder="e.g. 5"
          />
        </Field>
        <Field label="Required roles" highlight={extracted.required_roles}>
          <TagInput value={value.required_roles} onChange={(v) => set("required_roles", v)} field="roles" context={ctx} placeholder="Roles this tender needs..." highlight={extracted.required_roles} />
        </Field>
        <Field label="Required skills" highlight={extracted.required_skills}>
          <TagInput value={value.required_skills} onChange={(v) => set("required_skills", v)} field="technical_skills" context={ctx} placeholder="Add a required skill..." highlight={extracted.required_skills} />
        </Field>
        <Field label="Required certifications" highlight={extracted.required_certifications}>
          <TagInput value={value.required_certifications} onChange={(v) => set("required_certifications", v)} field="certifications" context={ctx} placeholder="Add a certification..." highlight={extracted.required_certifications} />
        </Field>
        <Field label="Sectors" highlight={extracted.sectors}>
          <TagInput value={value.sectors} onChange={(v) => set("sectors", v)} field="sectors" context={ctx} placeholder="Add a sector..." highlight={extracted.sectors} />
        </Field>
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
