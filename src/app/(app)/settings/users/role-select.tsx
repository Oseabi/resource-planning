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
  const [isPending, startTransition] = useTransition();

  return (
    <Select
      value={value}
      disabled={disabled || isPending}
      onValueChange={(next) => {
        const nextRole = next as ProfileRole;
        setValue(nextRole);
        startTransition(async () => {
          try {
            await updateUserRole(userId, nextRole);
          } catch {
            setValue(role);
          }
        });
      }}
    >
      <SelectTrigger size="sm" className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="user">User</SelectItem>
        <SelectItem value="admin">Admin</SelectItem>
      </SelectContent>
    </Select>
  );
}
