"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trophy } from "lucide-react";
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
import { confirmTenderTeam } from "@/app/(app)/assignment-actions";

/**
 * A won bid's team is no longer speculative. Until it is confirmed the proposed
 * members are still counted as available and contribute nothing to revenue, so
 * this prompts for the commercial terms and converts them into placements.
 */
export function ConfirmTeamBanner({
  tenderId,
  proposedCount,
  contractStartDate,
  contractEndDate,
}: {
  tenderId: string;
  proposedCount: number;
  contractStartDate: string | null;
  contractEndDate: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fee, setFee] = useState("");
  // Seeded from the contract, which is the window the team is being placed for.
  // Initial value only: the dialog mounts with the page, and router.refresh()
  // after a save remounts it with whatever the tender now says.
  const [startDate, setStartDate] = useState(contractStartDate ?? "");
  const [endDate, setEndDate] = useState(contractEndDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (proposedCount === 0) return null;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await confirmTenderTeam(
        tenderId,
        Number(fee || 0),
        startDate,
        endDate || null,
      );
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/10 p-4">
        <div className="flex items-start gap-2">
          <Trophy className="mt-0.5 size-4 shrink-0 text-success" />
          <div>
            <p className="text-body-md font-medium text-foreground">
              This bid is won. Confirm the team.
            </p>
            <p className="text-body-sm text-muted-foreground">
              {proposedCount} proposed member{proposedCount === 1 ? " is" : "s are"} still marked
              available and {proposedCount === 1 ? "counts" : "count"} for nothing in revenue.
              Confirming records their placements.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Confirm team
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm the winning team</DialogTitle>
            <DialogDescription>
              Places all {proposedCount} proposed member{proposedCount === 1 ? "" : "s"} on this
              tender. They move out of the available pool and their fees enter revenue reporting.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="confirm-fee">Fee per placement</Label>
              <Input
                id="confirm-fee"
                type="number"
                min={0}
                step="0.01"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                placeholder="e.g. 85000"
              />
              <p className="text-body-sm text-muted-foreground">
                Applied to each member; adjust individual placements afterwards if they differ.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="confirm-start">Start date</Label>
                <Input
                  id="confirm-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-end">End date</Label>
                <Input
                  id="confirm-end"
                  type="date"
                  min={startDate || undefined}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
            <p className="text-body-sm text-muted-foreground">
              {contractStartDate
                ? "Taken from this tender's contract dates. Adjust an individual placement afterwards if someone's dates differ."
                : "Leave the end date blank for an open-ended placement, though anyone open ended stops counting toward future availability."}
            </p>
            {!contractStartDate && (
              <p className="text-body-sm text-muted-foreground">
                This tender has no contract dates set.{" "}
                <Link href={`/tenders/${tenderId}/edit`} className="underline">
                  Set them on the tender
                </Link>{" "}
                so the whole team gets the same window.
              </p>
            )}
          </div>

          {error && <p className="text-body-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={isPending || !startDate}>
              {isPending ? "Confirming..." : "Confirm team"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
