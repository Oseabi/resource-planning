"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DepartmentDot } from "@/components/departments/department-chip";
import { departmentTheme, isHexColour } from "@/lib/department-theme";
import type { DepartmentBrand } from "@/lib/departments";
import { updateDepartment } from "@/app/(app)/settings/users/actions";

/**
 * Each department's name and colour, one row each, saved one at a time.
 *
 * The colour is the accent from the corporate site, as printed; the swatch
 * beside it shows the shade buttons and links will actually wear, which is
 * darker where the accent is too light to read on white. Said here so a
 * change on this screen does not come as a surprise on the next.
 */
export function DepartmentsCard({ departments }: { departments: DepartmentBrand[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-card">
      <h2 className="text-label-sm uppercase tracking-wide text-muted-foreground">Departments</h2>
      <p className="mt-1 text-body-sm text-muted-foreground">
        Each department&apos;s accent, as on the corporate site. Its people see the app in it, and
        the CVs they generate carry it. Text and dark-mode shades are worked out from it, so a light
        colour prints darker where words sit on it.
      </p>
      <ul className="mt-4 divide-y divide-border">
        {departments.map((d) => (
          <DepartmentRow key={d.id} department={d} />
        ))}
      </ul>
    </div>
  );
}

function DepartmentRow({ department }: { department: DepartmentBrand }) {
  const [name, setName] = useState(department.name);
  const [colour, setColour] = useState(department.colour ?? "#01789D");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const valid = isHexColour(colour);
  const dirty = name !== department.name || colour.toUpperCase() !== (department.colour ?? "").toUpperCase();
  const preview = valid ? departmentTheme(colour).light : null;

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await updateDepartment(department.id, { name, colour });
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      }
    });
  }

  return (
    <li className="flex flex-wrap items-end gap-3 py-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <Label htmlFor={`dept-name-${department.id}`}>Name</Label>
        <Input id={`dept-name-${department.id}`} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`dept-colour-${department.id}`}>Colour</Label>
        <div className="flex items-center gap-2">
          {/* The picker and the hex are the same value two ways: pick with one, paste into the other. */}
          <input
            type="color"
            aria-label={`${department.name} colour picker`}
            value={valid ? colour : "#01789D"}
            onChange={(e) => setColour(e.target.value.toUpperCase())}
            className="size-9 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
          />
          <Input
            id={`dept-colour-${department.id}`}
            value={colour}
            onChange={(e) => setColour(e.target.value)}
            className="w-28 font-mono"
            aria-invalid={!valid}
          />
        </div>
      </div>
      {/* What buttons and links will wear, which is darker than a light accent. */}
      <div className="space-y-1.5">
        <span className="block text-label-sm text-muted-foreground">On screen</span>
        <span
          className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-label-md font-medium"
          style={preview ? { backgroundColor: preview.primary, color: preview["primary-foreground"] } : undefined}
        >
          <DepartmentDot colour={valid ? colour : null} className="ring-1 ring-white/70" />
          {name || department.name}
        </span>
      </div>
      <div className="flex h-9 items-center gap-3">
        <Button size="sm" onClick={save} disabled={isPending || !dirty || !valid || !name.trim()}>
          {isPending ? "Saving..." : "Save"}
        </Button>
        {saved && !dirty && <span className="text-body-sm text-muted-foreground">Saved.</span>}
      </div>
      {error && <p className="basis-full text-body-sm text-destructive">{error}</p>}
      {!valid && <p className="basis-full text-body-sm text-destructive">Six hex digits, like #DC9204.</p>}
    </li>
  );
}
