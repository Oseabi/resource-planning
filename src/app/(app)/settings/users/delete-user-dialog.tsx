"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { deleteUser } from "@/app/(app)/settings/users/actions";

/**
 * Admin-only account removal. Disabled for the signed-in admin's own row; the
 * server also refuses self-deletion and removal of the last remaining admin.
 */
export function DeleteUserDialog({
  userId,
  fullName,
  email,
  disabled,
}: {
  userId: string;
  fullName: string;
  email: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteUser(userId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={`Delete ${fullName}`}
      >
        <Trash2 className="size-4" />
        Delete
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this user?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{fullName}</span> ({email}) will lose
              access immediately and their account cannot be restored. Records they created —
              candidates, requirements, tenders, OEM letters and placements — are kept, but will
              no longer show them as the author.
            </DialogDescription>
          </DialogHeader>

          {error && <p className="text-body-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirm} disabled={isPending}>
              {isPending ? "Deleting..." : "Delete user"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
