"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { updatePlacementDates } from "@/app/(app)/assignment-actions";

/**
 * Correct one person's dates on a project they are placed on.
 *
 * Rendered only where a placement actually exists. A proposed seat on a bid
 * that has not been won has no dates yet, and offering to edit them would
 * suggest the commitment is more real than it is.
 */
export function EditPlacementDates({
  placementId,
  startDate,
  endDate,
  label,
}: {
  placementId: string;
  startDate: string | null;
  endDate: string | null;
  /** What the dates belong to, so the dialog can name it. */
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(startDate ?? "");
  const [end, setEnd] = useState(endDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await updatePlacementDates(placementId, start, end || null);
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
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Edit dates for ${label}`}
      >
        <CalendarCog className="size-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit dates</DialogTitle>
            <DialogDescription>
              {label}. Changing these affects when this person shows as free, so the bench forecast
              and every availability check move with them.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="placement-start">Start date</Label>
              <Input
                id="placement-start"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="placement-end">End date</Label>
              <Input
                id="placement-end"
                type="date"
                min={start || undefined}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
          <p className="text-body-sm text-muted-foreground">
            An end date that differs from the contract marks this placement as set on purpose, so
            extending the contract later will leave it where it is.
          </p>

          {error && <p className="text-body-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={isPending || !start}>
              {isPending ? "Saving..." : "Save dates"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
