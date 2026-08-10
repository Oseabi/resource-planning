"use client";

import { Plus, Trash2, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { TagInput } from "@/components/ui/tag-input";
import { ComboboxInput } from "@/components/ui/combobox-input";
import { EMPTY_POSITION, seatCount, type PositionInput } from "@/lib/positions";

/**
 * The roles a requirement or tender needs staffed, one line each.
 *
 * Shared by both modules so a 30-resource bid is captured the same way
 * everywhere. Follows the repeater contract used by the candidate experience and
 * education editors: `{ value, onChange, highlight? }` with update/remove/add.
 */
export function PositionsEditor({
  value,
  onChange,
  sectors = [],
  highlight,
}: {
  value: PositionInput[];
  onChange: (next: PositionInput[]) => void;
  /** Parent sectors, so each line's suggestion chips stay industry-relevant. */
  sectors?: string[];
  highlight?: boolean;
}) {
  function update(i: number, patch: Partial<PositionInput>) {
    onChange(value.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...value, { ...EMPTY_POSITION }]);
  }

  const totalSeats = value.reduce((sum, p) => sum + seatCount(p), 0);

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="text-body-sm text-muted-foreground">
          No roles added yet. Add one line per role you need — set how many of each.
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-body-sm text-muted-foreground">
          <Users className="size-3.5" />
          {value.length} role{value.length === 1 ? "" : "s"} · {totalSeats} seat
          {totalSeats === 1 ? "" : "s"} total
        </p>
      )}

      {value.map((position, i) => {
        // Per-line context so a BA line suggests BA skills, not the PM line's.
        const ctx = { primaryRole: position.role, sectors };
        return (
          <div
            key={i}
            className={
              "rounded-md border p-3 " +
              (highlight ? "border-primary/40 bg-primary/5" : "border-border bg-background")
            }
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_110px_140px]">
              <div className="space-y-1">
                <Label className="text-label-sm">Role</Label>
                <ComboboxInput
                  value={position.role}
                  onChange={(v) => update(i, { role: v ?? "" })}
                  field="roles"
                  context={{ sectors }}
                  showQuickAdd={false}
                  placeholder="e.g. Business Analyst"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-label-sm">How many</Label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={position.quantity ?? 1}
                  onChange={(e) =>
                    update(i, { quantity: e.target.value === "" ? 1 : Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label className="text-label-sm">Min. years exp.</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={position.min_experience_years ?? ""}
                  onChange={(e) =>
                    update(i, {
                      min_experience_years: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  placeholder="e.g. 5"
                />
              </div>
            </div>

            <div className="mt-3 space-y-3">
              <div className="space-y-1">
                <Label className="text-label-sm">Required skills</Label>
                <TagInput
                  value={position.required_skills}
                  onChange={(v) => update(i, { required_skills: v })}
                  field="technical_skills"
                  context={ctx}
                  placeholder="Skills for this role..."
                />
              </div>
              <div className="space-y-1">
                <Label className="text-label-sm">Required certifications</Label>
                <TagInput
                  value={position.required_certifications}
                  onChange={(v) => update(i, { required_certifications: v })}
                  field="certifications"
                  context={ctx}
                  placeholder="Certifications for this role..."
                />
              </div>
            </div>

            <div className="mt-2 flex justify-end">
              <Button variant="ghost" size="sm" type="button" onClick={() => remove(i)}>
                <Trash2 className="size-4" />
                Remove
              </Button>
            </div>
          </div>
        );
      })}

      <Button variant="outline" size="sm" type="button" onClick={add}>
        <Plus className="size-4" />
        Add role
      </Button>
    </div>
  );
}
