"use client";

import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WorkExperience } from "@/lib/supabase/database.types";

const EMPTY: WorkExperience = {
  title: "",
  company: "",
  location: null,
  employment_type: null,
  start_date: null,
  end_date: null,
  is_current: false,
  description: null,
  achievements: null,
};

const EMPLOYMENT_TYPES = [
  "Full-time",
  "Part-time",
  "Contract",
  "Freelance",
  "Internship",
  "Temporary",
] as const;

export function ExperienceEditor({
  value,
  onChange,
  highlight,
}: {
  value: WorkExperience[];
  onChange: (next: WorkExperience[]) => void;
  highlight?: boolean;
}) {
  function update(i: number, patch: Partial<WorkExperience>) {
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
        <p className="text-body-sm text-muted-foreground">No work experience added yet.</p>
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
              <Label className="text-label-sm">Job title</Label>
              <Input
                value={entry.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder="e.g. ERP Consultant"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-label-sm">Company</Label>
              <Input
                value={entry.company}
                onChange={(e) => update(i, { company: e.target.value })}
                placeholder="e.g. Tipp Focus Holdings"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-label-sm">Location</Label>
              <Input
                value={entry.location ?? ""}
                onChange={(e) => update(i, { location: e.target.value || null })}
                placeholder="e.g. Johannesburg"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-label-sm">Employment type</Label>
              <Select
                value={entry.employment_type ?? ""}
                onValueChange={(v) => update(i, { employment_type: v || null })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select type">
                    {(v) => (v ? String(v) : "Select type")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-label-sm">Start</Label>
              <Input
                value={entry.start_date ?? ""}
                onChange={(e) => update(i, { start_date: e.target.value || null })}
                placeholder="e.g. 2022"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-label-sm">End</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={entry.end_date ?? ""}
                  onChange={(e) => update(i, { end_date: e.target.value || null })}
                  placeholder="e.g. 2024"
                  disabled={entry.is_current}
                />
                <label className="flex shrink-0 items-center gap-1 text-label-md text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={!!entry.is_current}
                    onChange={(e) =>
                      update(i, { is_current: e.target.checked, end_date: e.target.checked ? null : entry.end_date })
                    }
                  />
                  Current
                </label>
              </div>
            </div>
          </div>
          <div className="mt-3 space-y-1">
            <Label className="text-label-sm">Description</Label>
            <Textarea
              rows={2}
              value={entry.description ?? ""}
              onChange={(e) => update(i, { description: e.target.value || null })}
              placeholder="Key responsibilities in this role..."
            />
          </div>
          <div className="mt-3 space-y-1">
            <Label className="text-label-sm">Key achievements</Label>
            <Textarea
              rows={2}
              value={entry.achievements ?? ""}
              onChange={(e) => update(i, { achievements: e.target.value || null })}
              placeholder="Notable results, e.g. Delivered D365 rollout 2 weeks early..."
            />
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
        Add experience
      </Button>
    </div>
  );
}
