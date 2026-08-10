-- Availability over time.
--
-- placements records when someone starts and never when they finish, so the
-- system can describe today and nothing beyond it. "Who is free in November"
-- has no answer, and nobody ever comes off a placement without a manual
-- unassign. That is a strange gap in a tool called Resource Planning.
--
-- Two nullable columns, no backfill. Existing rows keep meaning what they
-- already meant:
--   placements.end_date null    open ended, so the candidate is committed
--                               indefinitely. This is what every existing row
--                               becomes, which is the safe reading: better to
--                               show someone as busy than to free them up on a
--                               guess.
--   candidates.available_from   a manual override for cases no placement
--                               explains, e.g. parental leave, or a candidate
--                               who has told you they are free from a date.
--                               Null means available now.
--
-- Self-contained and idempotent: safe to re-run.

alter table public.placements
  add column if not exists end_date date;

alter table public.candidates
  add column if not exists available_from date;

-- An end date before the start date is always a data-entry mistake. Added as
-- NOT VALID so the constraint applies to new and updated rows without forcing a
-- full table scan, and without failing if any historic row is odd.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'placements_end_after_start'
  ) then
    alter table public.placements
      add constraint placements_end_after_start
      check (end_date is null or end_date >= start_date) not valid;
  end if;
end $$;

-- Both are range-scanned ("who comes free before X"), so btree is right.
create index if not exists placements_end_date_idx on public.placements (end_date);
create index if not exists candidates_available_from_idx on public.candidates (available_from);
