"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TagInput } from "@/components/ui/tag-input";
import { ComboboxInput } from "@/components/ui/combobox-input";
import { CATEGORY_NAMES } from "@/lib/resource-categories";
import { OEM_VENDORS } from "@/lib/oem-letters";
import type { OemLetterFormFields } from "@/app/(app)/oem-letters/actions";

export const EMPTY_LETTER: OemLetterFormFields = {
  title: "",
  oem_vendor: "",
  categories: [],
  reference_number: null,
  issued_to: null,
  issue_date: null,
  expiry_date: null,
  notes: null,
};

export function LetterFields({
  value,
  onChange,
}: {
  value: OemLetterFormFields;
  onChange: (next: OemLetterFormFields) => void;
}) {
  function set<K extends keyof OemLetterFormFields>(key: K, val: OemLetterFormFields[K]) {
    onChange({ ...value, [key]: val });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Letter title" htmlFor="lf-title" required>
          <Input
            id="lf-title"
            value={value.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="e.g. Microsoft Partner Authorisation 2026"
            required
          />
        </Field>
        <Field label="OEM / vendor" htmlFor="lf-vendor" required>
          <ComboboxInput
            id="lf-vendor"
            value={value.oem_vendor}
            onChange={(v) => set("oem_vendor", v ?? "")}
            suggestions={OEM_VENDORS}
            placeholder="e.g. Microsoft"
          />
        </Field>
        <Field label="Reference number" htmlFor="lf-ref">
          <Input
            id="lf-ref"
            value={value.reference_number ?? ""}
            onChange={(e) => set("reference_number", e.target.value || null)}
            placeholder="Letter / authorisation reference"
          />
        </Field>
        <Field label="Issued to" htmlFor="lf-issued-to">
          <Input
            id="lf-issued-to"
            value={value.issued_to ?? ""}
            onChange={(e) => set("issued_to", e.target.value || null)}
            placeholder="e.g. TiPP Focus Holdings (Pty) Ltd"
          />
        </Field>
        <Field label="Issue date" htmlFor="lf-issued">
          <Input
            id="lf-issued"
            type="date"
            value={value.issue_date ?? ""}
            onChange={(e) => set("issue_date", e.target.value || null)}
          />
        </Field>
        <Field label="Expiry date" htmlFor="lf-expiry">
          <Input
            id="lf-expiry"
            type="date"
            value={value.expiry_date ?? ""}
            onChange={(e) => set("expiry_date", e.target.value || null)}
          />
        </Field>
      </div>

      <Field label="Practice areas">
        <TagInput
          value={value.categories}
          onChange={(v) => set("categories", v)}
          suggestions={CATEGORY_NAMES}
          quickAdd={CATEGORY_NAMES.slice(0, 8)}
          placeholder="e.g. EA, ERP, Cloud & DevOps..."
        />
        <p className="mt-1 text-body-sm text-muted-foreground">
          Filed under each area you pick, so &ldquo;EA OEM letters&rdquo; is one click away.
        </p>
      </Field>

      <Field label="Notes" htmlFor="lf-notes">
        <Textarea
          id="lf-notes"
          rows={3}
          value={value.notes ?? ""}
          onChange={(e) => set("notes", e.target.value || null)}
          placeholder="Scope of the authorisation, conditions, renewal contact..."
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
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children}
    </div>
  );
}
