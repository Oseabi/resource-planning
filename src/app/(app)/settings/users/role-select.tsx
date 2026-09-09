"use client";

import { useState, useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProfileRole } from "@/lib/supabase/database.types";
import { updateUserRole } from "@/app/(app)/settings/users/actions";

export function RoleSelect({
  userId,
  role,
  disabled,
}: {
  userId: string;
  role: ProfileRole;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(role);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-1">
    <Select
      value={value}
      disabled={disabled || isPending}
      onValueChange={(next) => {
        // Base UI can hand back null, and casting that to a role sent null to a
        // column with a check constraint, which failed in a catch nobody saw.
        if (!next) return;
        const nextRole = next as ProfileRole;
        setError(null);
        setValue(nextRole);
        startTransition(async () => {
          try {
            await updateUserRole(userId, nextRole);
          } catch (e) {
            // Said out loud. Reverting in silence left somebody clicking the
            // same dropdown over and over with nothing to go on.
            setError(e instanceof Error ? e.message : "Could not change the role.");
            setValue(role);
          }
        });
      }}
    >
      <SelectTrigger size="sm" className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="user">User</SelectItem>
        {/* A manager runs one department: they can delete within it without
            being made a global admin, which would hand them all four. */}
        <SelectItem value="manager">Manager</SelectItem>
        <SelectItem value="admin">Admin</SelectItem>
      </SelectContent>
    </Select>
    {error && <p className="text-label-sm text-destructive">{error}</p>}
    </div>
  );
}
