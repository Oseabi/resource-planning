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
import { deleteRequirement } from "@/app/(app)/job-requirements/actions";

/**
 * Admin-only requirement removal. Deleting also removes the requirement's
 * placements, so the fee history is called out before the admin confirms.
 */
export function DeleteRequirementButton({
  requirementId,
  title,
  placementCount = 0,
}: {
  requirementId: string;
  title: string;
  placementCount?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteRequirement(requirementId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.push("/job-requirements");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Trash2 className="size-4" />
        Delete
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this job requirement?</DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">{title}</span> and its match results
              will be permanently removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {placementCount > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-body-sm text-destructive">
              <p className="font-medium">
                {placementCount} placement{placementCount === 1 ? "" : "s"} will also be deleted.
              </p>
              <p className="mt-1">
                Their fees drop out of revenue and time-to-fill reporting, and any candidate left
                without another placement returns to Active.
              </p>
            </div>
          )}

          {error && <p className="text-body-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirm} disabled={isPending}>
              {isPending ? "Deleting..." : "Delete requirement"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
