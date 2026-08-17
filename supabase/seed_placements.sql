-- ============================================================================
-- Demo dataset, part 3: two won bids with real teams and real durations.
-- Paste into the Supabase SQL Editor and Run.
--
-- Run supabase/seed_demo.sql first.
--
-- Fixes an inconsistency in the seed. seed_demo.sql marks one candidate
-- status = 'placed' but creates no assignment and no placement anywhere, so her
-- profile shows a "Placed" badge above an empty Placements panel. The badge and
-- the record disagree, and the record is the one telling the truth.
--
-- Two bids are marked won and staffed, because that is the only state in which
-- a tender seat legitimately carries dates. While a bid is live its seats are
-- proposals and correctly show no duration, so a live bid cannot demonstrate
-- the feature. The two chosen already own the right roles between them:
--
--   City of Cape Town, internal audit co-sourcing   Auditor, Financial Controller
--   Eskom Holdings, programme management office     Project Manager, Business Analyst
--
-- Each person is spread across a different phase, so the panel shows all of the
-- states it distinguishes rather than four copies of one:
--
--   Zanele Mthembu    Business Analyst      Feb to Jun 2026     finished, 5 months
--   Lerato Sibeko     Project Manager       Jun 2026 to Mar 2027 current, 10 months
--   Michelle van Wyk  Financial Controller  from Aug 2026        current, open ended
--   Yusuf Ebrahim     Auditor               Oct 2026 to Jan 2027 upcoming, 4 months
--
-- Both an assignment and a placement are written for each, which is exactly
-- what the app does when a won bid's team is confirmed. Writing only the
-- placement would leave the seat looking empty on the bid.
--
-- Self-contained and idempotent: safe to re-run.
-- Reversible: supabase/seed_placements_undo.sql removes exactly these rows.
-- ============================================================================

-- Placements have no natural key to conflict on, so re-running is made safe by
-- clearing this specific set first rather than by ON CONFLICT.
delete from public.placements
where candidate_id in (
  'deadbee1-0000-4000-8000-000000000009',  -- Zanele Mthembu
  'deadbee1-0000-4000-8000-000000000007',  -- Lerato Sibeko
  'deadbee1-0000-4000-8000-00000000000d',  -- Michelle van Wyk
  'deadbee1-0000-4000-8000-00000000000f'   -- Yusuf Ebrahim
);


-- ---------------------------------------------------------------------------
-- 1. The seats. Assignment first, so the bid shows the seat as filled.
-- ---------------------------------------------------------------------------
insert into public.assignments (position_id, candidate_id, status) values
  ('deadbee3-0000-4000-8000-000000000a04', 'deadbee1-0000-4000-8000-000000000009', 'placed'),
  ('deadbee3-0000-4000-8000-000000000a02', 'deadbee1-0000-4000-8000-000000000007', 'placed'),
  ('deadbee3-0000-4000-8000-000000000702', 'deadbee1-0000-4000-8000-00000000000d', 'placed'),
  ('deadbee3-0000-4000-8000-000000000701', 'deadbee1-0000-4000-8000-00000000000f', 'placed')
on conflict (position_id, candidate_id) do update set status = 'placed';


-- ---------------------------------------------------------------------------
-- 2. The commercial record. position_id is what lets the profile name the role,
--    so it must be set; without it the panel can only say the role is unknown.
-- ---------------------------------------------------------------------------
insert into public.placements
  (candidate_id, source_type, source_id, position_id, fee_value, start_date, end_date) values
  ('deadbee1-0000-4000-8000-000000000009', 'tender', 'deadbee2-0000-4000-8000-00000000000a',
   'deadbee3-0000-4000-8000-000000000a04',  92000, '2026-02-02', '2026-06-30'),
  ('deadbee1-0000-4000-8000-000000000007', 'tender', 'deadbee2-0000-4000-8000-00000000000a',
   'deadbee3-0000-4000-8000-000000000a02', 145000, '2026-06-01', '2027-03-31'),
  ('deadbee1-0000-4000-8000-00000000000d', 'tender', 'deadbee2-0000-4000-8000-000000000007',
   'deadbee3-0000-4000-8000-000000000702', 168000, '2026-08-01', null),
  ('deadbee1-0000-4000-8000-00000000000f', 'tender', 'deadbee2-0000-4000-8000-000000000007',
   'deadbee3-0000-4000-8000-000000000701', 118000, '2026-10-01', '2027-01-31');


-- ---------------------------------------------------------------------------
-- 3. Mark both bids won, so the seats above are consistent with the rule that a
--    tender seat is a proposal until the bid lands.
-- ---------------------------------------------------------------------------
update public.tenders
set status = 'won'
where id in (
  'deadbee2-0000-4000-8000-000000000007',
  'deadbee2-0000-4000-8000-00000000000a'
);


-- ---------------------------------------------------------------------------
-- 4. The placement trigger flags a candidate 'placed'. Zanele's stint finished
--    in June, so leaving her flagged would hold her out of the available pool
--    for work she is free to do.
-- ---------------------------------------------------------------------------
update public.candidates
set status = 'active'
where id = 'deadbee1-0000-4000-8000-000000000009';


-- ---------------------------------------------------------------------------
-- Verify. Expect four rows: one finished, two current, one upcoming, each with
-- a named role and project.
-- ---------------------------------------------------------------------------
select
  c.full_name,
  p.role,
  t.title as project,
  pl.start_date,
  pl.end_date,
  case
    when pl.start_date > current_date then 'upcoming'
    when pl.end_date is not null and pl.end_date < current_date then 'finished'
    else 'current'
  end as phase,
  c.status as candidate_status
from public.placements pl
join public.candidates c on c.id = pl.candidate_id
join public.positions p on p.id = pl.position_id
join public.tenders t on t.id = pl.source_id
where pl.candidate_id::text like 'deadbee1-%'
order by pl.start_date;
