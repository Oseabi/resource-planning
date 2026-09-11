"use client";

import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { Certificate } from "@/lib/supabase/database.types";

const EMPTY: Certificate = { name: "", institution: null, year: null };

/**
 * CERTIFICATES AND COURSES as the template prints them, with institution and
 * year. The flat certifications list matching scores on is derived from this
 * on save, so nothing here has to be typed twice.
 */
export function CertificatesEditor({
  value,
  onChange,
  highlight,
}: {
  value: Certificate[];
  onChange: (next: Certificate[]) => void;
  highlight?: boolean;
}) {
  function update(i: number, patch: Partial<Certificate>) {
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
        <p className="text-body-sm text-muted-foreground">No certificates or courses added yet.</p>
      )}
      {value.map((entry, i) => (
        <div
          key={i}
          className={
            "rounded-md border p-3 " +
            (highlight ? "border-primary/40 bg-primary/5" : "border-border bg-background")
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_2fr_1fr]">
            <div className="space-y-1">
              <Label className="text-label-sm">Certificate or course</Label>
              <Input
                value={entry.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="e.g. TOGAF 9.2 Certified"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-label-sm">Institution</Label>
              <Input
                value={entry.institution ?? ""}
                onChange={(e) => update(i, { institution: e.target.value || null })}
                placeholder="e.g. The Open Group"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-label-sm">Year</Label>
              <Input
                value={entry.year ?? ""}
                onChange={(e) => update(i, { year: e.target.value || null })}
                placeholder="e.g. 2022"
              />
            </div>
          </div>
          <div className="mt-2 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => remove(i)}>
              <Trash2 className="size-4" />
              Remove
            </Button>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={add}>
        <Plus className="size-4" />
        Add certificate
      </Button>
    </div>
  );
}
