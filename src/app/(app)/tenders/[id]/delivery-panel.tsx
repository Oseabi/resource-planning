import { CalendarRange, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDate, durationLabel } from "@/lib/availability";
import {
  contractWindowLabel,
  placementsAlignedTo,
  type DeliveryState,
} from "@/lib/delivery";
import { DeliveryStateBadge } from "@/app/(app)/tenders/tender-badges";
import { EditPlacementDates } from "@/app/(app)/edit-placement-dates";
import { ExtendContractDialog } from "@/app/(app)/tenders/[id]/extend-contract-dialog";
import { AlignDatesButton } from "@/app/(app)/tenders/[id]/align-dates-button";

/**
 * A won bid seen as a running contract rather than as a result.
 *
 * The rest of the tender page is about assembling a team to bid with. Once the
 * bid is won the questions change to who is actually on this, until when, and
 * what happens when the client extends. That is a different enough subject to
 * deserve its own panel instead of more controls in the header.
 */
export async function DeliveryPanel({
  tenderId,
  state,
  contractStartDate,
  contractEndDate,
}: {
  tenderId: string;
  state: DeliveryState;
  contractStartDate: string | null;
  contractEndDate: string | null;
}) {
  const supabase = await createClient();

  // Filtered on source rather than position_id, matching extendTender: a
  // placement whose seat was deleted is still someone working on this contract.
  const { data: placements } = await supabase
    .from("placements")
    .select("id, candidate_id, start_date, end_date")
    .eq("source_type", "tender")
    .eq("source_id", tenderId)
    .order("start_date");

  const rows = placements ?? [];
  const candidateIds = [...new Set(rows.map((p) => p.candidate_id))];
  const { data: people } = candidateIds.length
    ? await supabase.from("candidates").select("id, full_name").in("id", candidateIds)
    : { data: [] };
  const nameById = new Map((people ?? []).map((c) => [c.id, c.full_name]));

  // The same rule the action applies, so the preview cannot disagree with what
  // actually happens.
  const { aligned, overridden } = placementsAlignedTo(rows, contractEndDate);
  const openEnded = rows.filter((p) => p.end_date === null);

  const effect =
    rows.length === 0
      ? "Nobody is placed on this contract yet, so only the tender's own dates will move."
      : contractEndDate === null
        ? "This contract has no end date recorded, so nobody moves with it. Give the team dates first, or set each placement individually."
        : `${aligned.length} placement${aligned.length === 1 ? "" : "s"} end on ${formatDate(contractEndDate)} and will move with the contract.` +
          (overridden.length > 0
            ? ` ${overridden.length} ${overridden.length === 1 ? "has its own end date and will not" : "have their own end dates and will not"}.`
            : "");

  return (
    <div className="rounded-lg border border-border bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-headline-sm font-semibold text-foreground">Delivery</h2>
          <DeliveryStateBadge state={state} />
          <span className="inline-flex items-center gap-1.5 text-body-sm text-muted-foreground">
            <CalendarRange className="size-3.5" />
            {contractWindowLabel(contractStartDate, contractEndDate)}
          </span>
        </div>
        <ExtendContractDialog
          tenderId={tenderId}
          currentEnd={contractEndDate ? formatDate(contractEndDate) : null}
          minDate={contractEndDate ?? contractStartDate ?? undefined}
          effect={effect}
        />
      </div>

      {openEnded.length > 0 && contractEndDate && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
          <p className="text-body-sm text-muted-foreground">
            {openEnded.length} {openEnded.length === 1 ? "person has" : "people have"} no end date,
            so they count as committed indefinitely and are missing from the bench forecast.
          </p>
          <AlignDatesButton tenderId={tenderId} endDate={formatDate(contractEndDate)} />
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-body-sm text-muted-foreground">
          Nobody is placed on this contract yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Users className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-[1_1_10rem] truncate font-medium text-foreground">
                {nameById.get(p.candidate_id) ?? "Removed candidate"}
              </span>
              <span className="text-body-sm text-muted-foreground">
                {p.end_date
                  ? `${formatDate(p.start_date)} to ${formatDate(p.end_date)}`
                  : `From ${formatDate(p.start_date)}, open ended`}
                {" · "}
                {durationLabel(p.start_date, p.end_date)}
              </span>
              <EditPlacementDates
                placementId={p.id}
                startDate={p.start_date}
                endDate={p.end_date}
                label={nameById.get(p.candidate_id) ?? "This placement"}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
