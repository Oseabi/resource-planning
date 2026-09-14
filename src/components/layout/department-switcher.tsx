"use client";

import { useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DepartmentDot } from "@/components/departments/department-chip";
import { setDepartmentLens } from "@/app/(app)/department-lens-actions";
import { departmentTheme, themeCss } from "@/lib/department-theme";
import type { DepartmentBrand } from "@/lib/departments";

/**
 * Repaint the app in the chosen department's colours now, from the colours
 * the switcher already holds, rather than after the server has re-rendered
 * the page. The server's render lands with the same stylesheet, so nothing
 * flickers back; it only catches up on the lists.
 */
function paint(department: DepartmentBrand | null) {
  const style = document.getElementById("department-theme");
  if (style) style.textContent = department?.colour ? themeCss(departmentTheme(department.colour)) : "";
  document.querySelector("[data-department]")?.setAttribute("data-department", department?.slug ?? "group");
}

const ALL = "all";

/**
 * The department an admin looks through, in the top bar.
 *
 * Choosing one recolours the app in that department's accent and opens the
 * lists on it, so an admin sees what its recruiters see; "All departments"
 * is the group view they start in. The colours change at once; the action
 * sets the cookie and brings the current page back re-rendered in the same
 * round trip, so there is no second fetch to wait for. Put back if the
 * server refuses.
 */
export function DepartmentSwitcher({
  departments,
  lensSlug,
}: {
  departments: DepartmentBrand[];
  lensSlug: string | null;
}) {
  const [value, setValue] = useState(lensSlug ?? ALL);
  const [isPending, startTransition] = useTransition();

  return (
    <Select
      value={value}
      disabled={isPending}
      onValueChange={(next) => {
        const chosen = next ?? ALL;
        setValue(chosen);
        paint(departments.find((d) => d.slug === chosen) ?? null);
        startTransition(async () => {
          try {
            await setDepartmentLens(chosen === ALL ? null : chosen);
          } catch {
            setValue(lensSlug ?? ALL);
            paint(departments.find((d) => d.slug === lensSlug) ?? null);
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
