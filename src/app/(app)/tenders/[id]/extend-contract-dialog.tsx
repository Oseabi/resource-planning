"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { extendTender } from "@/app/(app)/tenders/actions";

/**
 * Move a running contract's end date out.
 *
 * The date starts blank rather than prefilled with the current end. A prefilled
 * date invites a confirm that changes nothing, and the whole point of the
 * dialog is to state the new date deliberately.
 */
export function ExtendContractDialog({
  tenderId,
  currentEnd,
  minDate,
  /** What will happen to the team, computed on the server from the same rule the action uses. */
  effect,
}: {
  tenderId: string;
  currentEnd: string | null;
  minDate: string | undefined;
  effect: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newEnd, setNewEnd] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await extendTender(tenderId, newEnd, note || undefined);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setNewEnd("");
      setNote("");
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CalendarPlus className="size-4" />
        Extend contract
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Extend the contract</DialogTitle>
            <DialogDescription>
              {currentEnd
                ? `This contract currently ends ${currentEnd}.`
                : "This contract has no end date recorded yet."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="extend-end">New end date</Label>
              <Input
                id="extend-end"
                type="date"
                min={minDate}
                value={newEnd}
                onChange={(e) => setNewEnd(e.target.value)}
              />
            </div>
            {/* Said before the button is pressed, not after. Computed with the
                same rule the action applies, so it cannot disagree with it. */}
            <p className="text-body-sm text-muted-foreground">{effect}</p>
            <div className="space-y-1.5">
              <Label htmlFor="extend-note">Note (optional)</Label>
              <Textarea
                id="extend-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Client exercised the 12 month option"
              />
            </div>
          </div>

          {error && <p className="text-body-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={isPending || !newEnd}>
              {isPending ? "Extending..." : "Extend contract"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
