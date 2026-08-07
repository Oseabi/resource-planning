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
 * Admin-only requirement removal. The action refuses when placements exist, so
 * the error surfaces here rather than silently orphaning revenue records.
 */
export function DeleteRequirementButton({
  requirementId,
  title,
}: {
  requirementId: string;
  title: string;
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
