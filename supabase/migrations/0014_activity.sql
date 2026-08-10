-- Notes and activity trail.
--
-- Nothing in the app records history. There is no way to answer "why was this
-- person swapped off the bid in September" three months later, and no way for
-- one person to leave context for the next.
--
-- One table rather than two. A hand-written note and a recorded event want the
-- same timeline, the same ordering and the same query, so splitting them would
-- mean merging them back together on every read.
--
-- Self-contained and idempotent: safe to re-run.

create table if not exists public.activity (
  id uuid primary key default gen_random_uuid(),
  -- Polymorphic, matching parent_type / match_target_type / source_type
  -- elsewhere. No FK is possible against four different tables, so deletes are
  -- hand-rolled in app code exactly as they are for those.
  entity_type text not null check (
    entity_type in ('candidate', 'tender', 'job_requirement', 'oem_letter')
  ),
  entity_id uuid not null,
  kind text not null check (kind in ('note', 'event')),
  -- Events only: 'assigned', 'unassigned', 'placed', 'status_changed', ...
  action text,
  -- Notes only: what the user typed.
  body text,
  -- Structured detail for events, e.g. the role and the candidate name, so the
  -- timeline can render a sentence without joining back to rows that may since
  -- have been deleted.
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

-- Every read is "the timeline for this one record, newest first", so the index
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

-- Delete your own note, or anything if you are an admin. Events are not
-- deletable by their author because nobody "authors" them in a meaningful
-- sense; they are recorded by the system as a side effect.
drop policy if exists "activity_delete" on public.activity;
create policy "activity_delete" on public.activity
  for delete to authenticated
  using (public.is_admin() or (kind = 'note' and actor_id = auth.uid()));
