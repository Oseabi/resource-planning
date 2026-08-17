-- ============================================================================
-- Demo dataset, part 3: real placements with real durations.
-- Paste into the Supabase SQL Editor and Run.
--
-- Run supabase/seed_demo.sql first.
--
-- Fixes an inconsistency in the seed. seed_demo.sql marks one candidate
-- status = 'placed' but creates no assignment and no placement anywhere, so her
-- profile shows a "Placed" badge above an empty Placements panel. The badge and
-- the record disagree, and the record is the one telling the truth.
--
-- This gives four people genuine placements on the seeded job requirement, so
-- "where is this person and for how long" has a real answer. They are spread
-- across the three states the panel distinguishes, because a demo that only
-- ever shows one of them does not show the feature:
--
--   Zanele Mthembu    finished    Feb to Jun 2026, 5 months
--   Lerato Sibeko     current     Jun 2026 to Mar 2027, 10 months
--   Michelle van Wyk  current     Aug 2026, open ended
--   Yusuf Ebrahim     upcoming    Oct 2026 to Jan 2027, 4 months
--
-- Placements attach to a job requirement rather than a tender on purpose: a
-- tender seat is a proposal and correctly carries no dates until the bid is
-- won, so it cannot demonstrate duration.
--
-- Self-contained and idempotent: safe to re-run.
-- Reversible: supabase/seed_placements_undo.sql removes exactly these rows.
-- ============================================================================

-- The placements table has no natural key to conflict on, so re-running is made
-- safe by clearing this specific set first rather than by ON CONFLICT.
delete from public.placements
where candidate_id in (
  'deadbee1-0000-4000-8000-000000000009',  -- Zanele Mthembu
  'deadbee1-0000-4000-8000-000000000007',  -- Lerato Sibeko
  'deadbee1-0000-4000-8000-00000000000d',  -- Michelle van Wyk
  'deadbee1-0000-4000-8000-00000000000f'   -- Yusuf Ebrahim
);

-- Attach to whichever job requirement exists, so this works against your data
-- rather than assuming a fixed id. Nothing happens if you have none.
with target as (
  select id, title from public.job_requirements order by created_at limit 1
)
insert into public.placements
  (candidate_id, source_type, source_id, fee_value, start_date, end_date)
select c.candidate_id, 'job_requirement', target.id, c.fee, c.starts, c.ends
from target
cross join (values
  -- Finished: shows the Completed badge and a closed duration.
  ('deadbee1-0000-4000-8000-000000000009'::uuid,  92000, date '2026-02-02', date '2026-06-30'),
  -- Current, with an end in sight. This is the common case.
  ('deadbee1-0000-4000-8000-000000000007'::uuid, 145000, date '2026-06-01', date '2027-03-31'),
  -- Current and open ended, which is why the panel needs that wording at all.
  ('deadbee1-0000-4000-8000-00000000000d'::uuid, 168000, date '2026-08-01', null),
  -- Upcoming: starts later this year, so it is committed but not yet running.
  ('deadbee1-0000-4000-8000-00000000000f'::uuid, 118000, date '2026-10-01', date '2027-01-31')
) as c(candidate_id, fee, starts, ends)
where exists (select 1 from target);

-- The placement trigger flags a candidate 'placed'. Zanele's stint has already
-- finished, so leaving her flagged would keep her out of the available pool for
-- work she is free to do.
update public.candidates
set status = 'active'
where id = 'deadbee1-0000-4000-8000-000000000009';

-- ---------------------------------------------------------------------------
-- Verify. Expect four rows, one per phase, with the durations noted above.
-- ---------------------------------------------------------------------------
select
  c.full_name,
  p.start_date,
  p.end_date,
  case
    when p.start_date > current_date then 'upcoming'
    when p.end_date is not null and p.end_date < current_date then 'finished'
    else 'current'
  end as phase,
  c.status as candidate_status
from public.placements p
join public.candidates c on c.id = p.candidate_id
where p.candidate_id::text like 'deadbee1-%'
order by p.start_date;
