"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { TagInput } from "@/components/ui/tag-input";
import { ComboboxInput } from "@/components/ui/combobox-input";
import { PositionsEditor } from "@/app/(app)/positions-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createRequirement,
  updateRequirement,
  type RequirementFormFields,
} from "@/app/(app)/job-requirements/actions";

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  on_hold: "On hold",
  closed: "Closed",
};

const AVAILABILITY_LABELS: Record<string, string> = {
  any: "Any",
  available: "Available",
  notice_period: "On notice period",
  unavailable: "Unavailable",
};

export const EMPTY_REQUIREMENT: RequirementFormFields = {
  title: "",
  positions: [],
  client: null,
  required_role: null,
  required_skills: [],
  required_certifications: [],
  required_qualifications: [],
  sectors: [],
  min_experience_years: null,
  location: null,
  required_availability: null,
  manager_email: null,
  status: "open",
};

export function RequirementForm({
  mode,
  requirementId,
  initial,
}: {
  mode: "create" | "edit";
  requirementId?: string;
  initial: RequirementFormFields;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<RequirementFormFields>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function set<K extends keyof RequirementFormFields>(key: K, val: RequirementFormFields[K]) {
    setFields((f) => ({ ...f, [key]: val }));
  }

  const ctx = { primaryRole: fields.required_role, sectors: fields.sectors };

  function submit() {
    setError(null);
    if (!fields.title.trim()) {
      setError("Title is required.");
      return;
    }
    startTransition(async () => {
      const result =
        mode === "create"
          ? await createRequirement(fields)
          : await updateRequirement(requirementId!, fields);
      if (result.error) setError(result.error);
      else {
        router.push(`/job-requirements/${result.id}`);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card shadow-card p-5">
        <h3 className="mb-4 text-label-sm uppercase tracking-wide text-muted-foreground">Details</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="rq-title" required>
            <Input id="rq-title" value={fields.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Senior ERP Consultant" required />
          </Field>
          <Field label="Client" htmlFor="rq-client">
            <Input id="rq-client" value={fields.client ?? ""} onChange={(e) => set("client", e.target.value || null)} />
          </Field>
          <Field label="Required role" htmlFor="rq-role">
            <ComboboxInput id="rq-role" value={fields.required_role} onChange={(v) => set("required_role", v)} field="roles" context={{ sectors: fields.sectors }} placeholder="e.g. ERP Consultant" />
          </Field>
          <Field label="Min. years experience" htmlFor="rq-years">
            <Input id="rq-years" type="number" min={0} step={0.5} value={fields.min_experience_years ?? ""} onChange={(e) => set("min_experience_years", e.target.value === "" ? null : Number(e.target.value))} />
          </Field>
          <Field label="Location" htmlFor="rq-location">
            <Input id="rq-location" value={fields.location ?? ""} onChange={(e) => set("location", e.target.value || null)} />
          </Field>
          <Field label="Manager email (for alerts)" htmlFor="rq-manager">
            <Input id="rq-manager" type="email" value={fields.manager_email ?? ""} onChange={(e) => set("manager_email", e.target.value || null)} placeholder="manager@client.com" />
          </Field>
          <Field label="Required availability" htmlFor="rq-availability">
            <Select value={fields.required_availability ?? "any"} onValueChange={(v) => set("required_availability", v === "any" ? null : v)}>
              <SelectTrigger id="rq-availability" className="w-full">
                <SelectValue>{(v) => AVAILABILITY_LABELS[String(v)] ?? "Any"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="available">Available</SelectItem>
                <SelectItem value="notice_period">On notice period</SelectItem>
                <SelectItem value="unavailable">Unavailable</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status" htmlFor="rq-status">
            <Select value={fields.status} onValueChange={(v) => set("status", v as RequirementFormFields["status"])}>
              <SelectTrigger id="rq-status" className="w-full">
                <SelectValue>{(v) => STATUS_LABELS[String(v)] ?? "Open"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="on_hold">On hold</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card shadow-card p-5 space-y-4">
        <h3 className="text-label-sm uppercase tracking-wide text-muted-foreground">Roles required</h3>
        <p className="text-body-sm text-muted-foreground">
          One line per role. Set how many of each and the bar they must clear, each seat is
          matched on its own skills and experience.
        </p>
        <PositionsEditor
          value={fields.positions}
          onChange={(v) => set("positions", v)}
          sectors={fields.sectors}
        />
      </div>

      <div className="rounded-lg border border-border bg-card shadow-card p-5 space-y-4">
        <h3 className="text-label-sm uppercase tracking-wide text-muted-foreground">
          Classification
        </h3>
        <Field label="Required qualifications">
          <TagInput value={fields.required_qualifications} onChange={(v) => set("required_qualifications", v)} field="qualifications" context={ctx} placeholder="Add a qualification..." />
        </Field>
        <Field label="Sectors">
          <TagInput value={fields.sectors} onChange={(v) => set("sectors", v)} field="sectors" context={ctx} placeholder="Add a sector..." />
        </Field>
      </div>

      {error && <p className="text-body-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" render={<Link href={mode === "edit" && requirementId ? `/job-requirements/${requirementId}` : "/job-requirements"} />} nativeButton={false}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={isPending}>
          {isPending ? "Saving..." : mode === "create" ? "Create requirement" : "Save changes"}
        </Button>
      </div>
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
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}
