-- ============================================================================
-- Migrations 0013 and 0014, bundled so they can go in one paste.
--
-- Paste this whole file into the Supabase dashboard SQL Editor and click "Run".
--
-- RUN THIS BEFORE USING THE NEW CODE. Both features query columns and a table
-- that do not exist yet. Until this has run, the dashboard Bench block reads
-- 0 available / 0 on notice / 0 placed, because the candidates query fails on
-- the unknown column and comes back empty. That is not a bug in the page, it is
-- the schema being behind the code.
--
-- 0013  availability over time
--         placements.end_date        when a commitment finishes
--         candidates.available_from  manual override for when someone is free
--
-- 0014  notes and activity trail
--         public.activity            one timeline of notes and recorded events
--
-- Self-contained and idempotent: safe to re-run, and safe if one has already
-- been applied on its own.
-- ============================================================================


-- ############################################################################
-- 0013_availability_dates.sql
-- ############################################################################

-- placements records when someone starts and never when they finish, so the
-- system can describe today and nothing beyond it. "Who is free in November"
-- has no answer, and nobody ever comes off a placement without a manual
-- unassign.
--
-- Two nullable columns, no backfill. Existing rows keep meaning what they
-- already meant: a null end_date is open ended, so every current placement
-- reads as an indefinite commitment. That is the safe default. Better to show
-- someone as busy than to free them up on a guess.

alter table public.placements
  add column if not exists end_date date;

alter table public.candidates
  add column if not exists available_from date;

-- An end date before the start date is always a data-entry mistake. NOT VALID
-- so it applies to new and updated rows without a full table scan, and without
-- failing if a historic row is odd.
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


-- ############################################################################
-- 0014_activity.sql
-- ############################################################################

-- Nothing in the app records history. There is no way to answer "why was this
-- person swapped off the bid in September" three months later.
--
-- One table rather than two: a hand-written note and a recorded event want the
-- same timeline, ordering and query.

create table if not exists public.activity (
  id uuid primary key default gen_random_uuid(),
  -- Polymorphic, matching parent_type / match_target_type / source_type
  -- elsewhere. No FK is possible against four tables, so deletes are hand-rolled
  -- in app code exactly as they are for those.
  entity_type text not null check (
    entity_type in ('candidate', 'tender', 'job_requirement', 'oem_letter')
  ),
  entity_id uuid not null,
  kind text not null check (kind in ('note', 'event')),
  -- Events only: 'assigned', 'unassigned', 'placed', 'team_confirmed', ...
  action text,
  -- Notes only: what the user typed.
  body text,
  -- Structured detail for events, so the timeline can render a sentence without
  -- joining back to rows that may since have been deleted.
  detail jsonb not null default '{}',
  -- Matches 0011: removing a user keeps their history, attributed to nobody.
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),

  -- A note with no text and an event with no action are both meaningless.
  constraint activity_has_content check (
    (kind = 'note' and body is not null and length(btrim(body)) > 0)
    or (kind = 'event' and action is not null)
  )
);

-- Every read is "the timeline for this record, newest first", so one index
-- covers the filter and the sort together.
create index if not exists activity_entity_idx
  on public.activity (entity_type, entity_id, created_at desc);

alter table public.activity enable row level security;

drop policy if exists "activity_select" on public.activity;
create policy "activity_select" on public.activity
  for select to authenticated using (true);

drop policy if exists "activity_insert" on public.activity;
create policy "activity_insert" on public.activity
  for insert to authenticated with check (true);

-- A trail you can quietly rewrite is not a trail. No update policy at all, so
-- entries are immutable once written.

-- Delete your own note, or anything as an admin. Events are not deletable by
-- their author, because nobody authors them; the system records them.
drop policy if exists "activity_delete" on public.activity;
create policy "activity_delete" on public.activity
  for delete to authenticated
  using (public.is_admin() or (kind = 'note' and actor_id = auth.uid()));


-- ############################################################################
-- Verify. Expect three rows for 0013, then activity_table = 1 for 0014.
-- ############################################################################

select 'placements.end_date' as object,
       count(*) as present
from information_schema.columns
where table_schema = 'public' and table_name = 'placements' and column_name = 'end_date'
union all
select 'candidates.available_from',
       count(*)
from information_schema.columns
where table_schema = 'public' and table_name = 'candidates' and column_name = 'available_from'
union all
select 'activity table',
       count(*)
from information_schema.tables
where table_schema = 'public' and table_name = 'activity'
union all
select 'activity policies',
       count(*)
from pg_policies
where schemaname = 'public' and tablename = 'activity';
