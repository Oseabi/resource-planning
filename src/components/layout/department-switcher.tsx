"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DepartmentDot } from "@/components/departments/department-chip";
import { setDepartmentLens } from "@/app/(app)/department-lens-actions";
import type { DepartmentBrand } from "@/lib/departments";

const ALL = "all";

/**
 * The department an admin looks through, in the top bar.
 *
 * Choosing one recolours the app in that department's accent and opens the
 * lists on it, so an admin sees what its recruiters see; "All departments"
 * is the group view they start in. The same optimistic shape as the other
 * selects: set, save, put back if the server refuses.
 */
export function DepartmentSwitcher({
  departments,
  lensSlug,
}: {
  departments: DepartmentBrand[];
  lensSlug: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(lensSlug ?? ALL);
  const [isPending, startTransition] = useTransition();

  return (
    <Select
      value={value}
      disabled={isPending}
      onValueChange={(next) => {
        const chosen = next ?? ALL;
        setValue(chosen);
        startTransition(async () => {
          try {
            await setDepartmentLens(chosen === ALL ? null : chosen);
            router.refresh();
          } catch {
            setValue(lensSlug ?? ALL);
          }
        });
      }}
    >
      <SelectTrigger size="sm" className="hidden w-48 md:flex" aria-label="Department to look through">
        <SelectValue>
          {(v) => {
            const chosen = departments.find((d) => d.slug === String(v));
            return (
              <span className="inline-flex items-center gap-2">
                <DepartmentDot colour={chosen?.colour ?? null} />
                {chosen?.name ?? "All departments"}
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All departments</SelectItem>
        {departments.map((d) => (
          <SelectItem key={d.slug} value={d.slug}>
            <span className="inline-flex items-center gap-2">
              <DepartmentDot colour={d.colour} />
              {d.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
