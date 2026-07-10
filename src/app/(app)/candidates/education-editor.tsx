"use client";

import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { Education } from "@/lib/supabase/database.types";

const EMPTY: Education = { qualification: "", field: null, institution: null, year: null };

export function EducationEditor({
  value,
  onChange,
  highlight,
}: {
  value: Education[];
  onChange: (next: Education[]) => void;
  highlight?: boolean;
}) {
  function update(i: number, patch: Partial<Education>) {
    onChange(value.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...value, { ...EMPTY }]);
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-body-sm text-muted-foreground">No education added yet.</p>
      )}
      {value.map((entry, i) => (
        <div
          key={i}
          className={
            "rounded-md border p-3 " +
            (highlight ? "border-primary/40 bg-primary/5" : "border-border bg-background")
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-label-sm">Qualification</Label>
              <Input
                value={entry.qualification}
                onChange={(e) => update(i, { qualification: e.target.value })}
                placeholder="e.g. BCom Information Systems"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-label-sm">Institution</Label>
              <Input
                value={entry.institution ?? ""}
                onChange={(e) => update(i, { institution: e.target.value || null })}
                placeholder="e.g. University of Johannesburg"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-label-sm">Field</Label>
              <Input
                value={entry.field ?? ""}
                onChange={(e) => update(i, { field: e.target.value || null })}
                placeholder="e.g. Information Systems"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-label-sm">Year</Label>
              <Input
                value={entry.year ?? ""}
                onChange={(e) => update(i, { year: e.target.value || null })}
                placeholder="e.g. 2021"
              />
            </div>
          </div>
          <div className="mt-2 flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)}>
              <Trash2 className="size-4" />
              Remove
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="size-4" />
        Add education
      </Button>
    </div>
  );
}
