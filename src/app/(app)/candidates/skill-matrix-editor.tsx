"use client";

import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { SkillCategory, SkillEntry } from "@/lib/supabase/database.types";

const EMPTY_SKILL: SkillEntry = { name: "", years: null };

/**
 * The SKILLSET table as the template prints it: a category, the skills under
 * it, and the years beside each. The flat technical skills list matching
 * scores on is derived from this on save.
 *
 * Edited as one row per skill under a category heading, because that is how
 * it reads on the CV and because a years figure belongs to a skill, not to a
 * comma-separated list of them.
 */
export function SkillMatrixEditor({
  value,
  onChange,
  highlight,
}: {
  value: SkillCategory[];
  onChange: (next: SkillCategory[]) => void;
  highlight?: boolean;
}) {
  function updateCategory(i: number, patch: Partial<SkillCategory>) {
    onChange(value.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function updateSkill(i: number, j: number, patch: Partial<SkillEntry>) {
    updateCategory(i, {
      skills: value[i].skills.map((s, idx) => (idx === j ? { ...s, ...patch } : s)),
    });
  }
  function addCategory() {
    onChange([...value, { category: "", skills: [{ ...EMPTY_SKILL }] }]);
  }
  function removeCategory(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }
  function addSkill(i: number) {
    updateCategory(i, { skills: [...value[i].skills, { ...EMPTY_SKILL }] });
  }
  function removeSkill(i: number, j: number) {
    updateCategory(i, { skills: value[i].skills.filter((_, idx) => idx !== j) });
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-body-sm text-muted-foreground">
          No skills table yet. The template groups skills by category with years beside each.
        </p>
      )}
      {value.map((cat, i) => (
        <div
          key={i}
          className={
            "rounded-md border p-3 " +
            (highlight ? "border-primary/40 bg-primary/5" : "border-border bg-background")
          }
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1 space-y-1">
              <Label className="text-label-sm">Category</Label>
              <Input
                value={cat.category}
                onChange={(e) => updateCategory(i, { category: e.target.value })}
                placeholder="e.g. Programming Languages"
              />
            </div>
            <Button variant="ghost" size="sm" onClick={() => removeCategory(i)}>
              <Trash2 className="size-4" />
              Remove category
            </Button>
          </div>

          <div className="mt-3 space-y-2">
            {cat.skills.map((skill, j) => (
              <div key={j} className="grid grid-cols-1 gap-2 sm:grid-cols-[3fr_1fr_auto]">
                <Input
                  value={skill.name}
                  onChange={(e) => updateSkill(i, j, { name: e.target.value })}
                  placeholder="Skill"
                  aria-label="Skill"
                />
                <Input
                  value={skill.years ?? ""}
                  onChange={(e) => updateSkill(i, j, { years: e.target.value || null })}
                  placeholder="e.g. 10+ years"
                  aria-label="Years"
                />
                <Button variant="ghost" size="sm" onClick={() => removeSkill(i, j)} aria-label="Remove skill">
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => addSkill(i)}>
              <Plus className="size-4" />
              Add skill
            </Button>
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addCategory}>
        <Plus className="size-4" />
        Add category
      </Button>
    </div>
  );
}
