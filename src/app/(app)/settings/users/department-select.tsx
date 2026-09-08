"use client";

import { useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DepartmentOption } from "@/lib/departments";
import { updateUserDepartment } from "@/app/(app)/settings/users/actions";

/**
 * Which business unit somebody belongs to, which decides what they can see.
 *
 * The same optimistic shape as RoleSelect: set the value, fire the action, and
 * put it back if the server refuses. The select cannot hold null, so "none" is
 * a sentinel mapped back on the way out.
 */
export function DepartmentSelect({
  userId,
  departmentId,
  departments,
}: {
  userId: string;
  departmentId: string | null;
  departments: DepartmentOption[];
}) {
  const [value, setValue] = useState(departmentId ?? "none");
  const [isPending, startTransition] = useTransition();

  return (
    <Select
      value={value}
      disabled={isPending}
      onValueChange={(next) => {
        const chosen = next ?? "none";
        setValue(chosen);
        startTransition(async () => {
          try {
            await updateUserDepartment(userId, chosen === "none" ? null : chosen);
          } catch {
            setValue(departmentId ?? "none");
          }
        });
      }}
    >
      <SelectTrigger size="sm" className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {/* Correct for an admin, who works across all four. For anybody else it
            means they see nothing, which is the right way for an unassigned
            account to fail. */}
        <SelectItem value="none">No department</SelectItem>
        {departments.map((d) => (
          <SelectItem key={d.id} value={d.id}>
            {d.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
