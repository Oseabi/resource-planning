"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { alignPlacementsToContract } from "@/app/(app)/tenders/actions";

/**
 * Give the open-ended placements on this contract the tender's end date.
 *
 * Every team confirmed before the contract window existed was written without
 * one, and those people read as committed forever. This is the repair, offered
 * where the problem is visible rather than as a migration that would have run
 * before there was an end date to apply.
 */
export function AlignDatesButton({
  tenderId,
  endDate,
}: {
  tenderId: string;
  /** Already formatted for display. */
  endDate: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function apply() {
    setError(null);
    startTransition(async () => {
      const result = await alignPlacementsToContract(tenderId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-body-sm text-destructive">{error}</span>}
      <Button size="sm" variant="outline" onClick={apply} disabled={isPending}>
        {isPending ? "Applying..." : `Apply ${endDate}`}
      </Button>
    </div>
  );
}
