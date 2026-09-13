-- A brief for the bid team, read off the tender document.
--
-- A tender document runs to fifty or two hundred pages and the bid team
-- needs one paragraph of it: what is being bought, for how long, how bids
-- are scored and what has to be attached for the people proposed. The AI
-- reads that off the document when a tender is uploaded, it is edited on
-- the form like every other field, and it is shown at the top of the tender.
--
-- The value column stays where it is. Nothing reads or writes it any more:
-- the documents rarely state a contract value and the team never entered
-- one. It is left in place rather than dropped so that this migration
-- destroys nothing; a later one can drop it once that is a decision.
--
-- Self-contained and idempotent: safe to re-run.

alter table public.tenders
  add column if not exists summary text;

comment on column public.tenders.summary is
  'A brief for the bid team: scope, contract period, how bids are evaluated and what must be submitted for the people proposed. Read off the document by the AI, edited on the form.';
