"use client";

import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { TagInput } from "@/components/ui/tag-input";
import type { ProjectGroup } from "@/lib/supabase/database.types";

/** The PROJECTS table: a company and the projects delivered there. */
export function ProjectsEditor({
  value,
  onChange,
  highlight,
}: {
  value: ProjectGroup[];
  onChange: (next: ProjectGroup[]) => void;
  highlight?: boolean;
}) {
  function update(i: number, patch: Partial<ProjectGroup>) {
    onChange(value.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...value, { company: "", projects: [] }]);
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-body-sm text-muted-foreground">No projects added yet.</p>
      )}
      {value.map((group, i) => (
        <div
          key={i}
          className={
            "rounded-md border p-3 " +
            (highlight ? "border-primary/40 bg-primary/5" : "border-border bg-background")
          }
        >
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-label-sm">Company</Label>
              <Input
                value={group.company}
                onChange={(e) => update(i, { company: e.target.value })}
                placeholder="e.g. Eskom"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-label-sm">Projects</Label>
              <TagInput
                value={group.projects}
                onChange={(projects) => update(i, { projects })}
                placeholder="Type a project name and press Enter"
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
        Add company
      </Button>
    </div>
  );
}
