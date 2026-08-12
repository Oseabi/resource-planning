-- ============================================================================
-- Demo prep. Three cosmetic fixes so a walkthrough does not undersell the app.
-- Paste into the Supabase SQL Editor and Run.
--
-- None of this changes behaviour. It changes what the seeded data happens to
-- look like, because three things currently read as "nobody uses this":
--
--   1. Every bid shows 0 of N seats, so the fill bars are all empty.
--   2. "Bids closing in 14 days" reads 0, because every seeded deadline is
--      more than six weeks out. The most urgent-looking tile is blank.
--   3. "Test Candidate (positions QA)" appears in shortlists.
--
-- Self-contained and idempotent: safe to re-run.
-- Reversible: supabase/demo_prep_undo.sql puts all three back.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Staff some seats.
--
-- Data-driven rather than hand-picked: for the four bids below, take the
-- best-scoring candidate for each seat and propose them. Written this way so it
-- still does the right thing if matching is re-run and the rankings move.
--
-- status 'proposed', not 'placed', which is the real rule: a tender seat is a
-- proposal until the bid is won, so the candidate stays in the available pool.
-- No placement row is created, deliberately.
--
-- distinct on (position_id) takes one candidate per seat. Ordering by score
-- descending then candidate_id keeps the choice stable across runs rather than
-- depending on whatever order Postgres returns ties in.
-- ---------------------------------------------------------------------------
insert into public.assignments (position_id, candidate_id, status)
select distinct on (m.match_target_id)
  m.match_target_id,
  m.candidate_id,
  'proposed'
from public.matches m
join public.positions p on p.id = m.match_target_id
where m.match_target_type = 'position'
  and p.parent_type = 'tender'
  and p.parent_id in (
    'deadbee2-0000-4000-8000-000000000001',  -- national ERP platform
    'deadbee2-0000-4000-8000-000000000004',  -- cloud migration and DevOps
    'deadbee2-0000-4000-8000-000000000005',  -- N3 corridor bridge
    'deadbee2-0000-4000-8000-000000000002'   -- SAP S/4HANA finance migration
  )
  -- Only propose people who are actually a credible fit. A 40% match sitting in
  -- a seat during a demo invites exactly the wrong question.
  and m.score >= 70
order by m.match_target_id, m.score desc, m.candidate_id
on conflict (position_id, candidate_id) do nothing;


-- ---------------------------------------------------------------------------
-- 2. Bring two deadlines close.
--
-- The risk tile counts bids inside 14 days and turns red when any is inside 7,
-- so one of each shows both states. Dates are relative to when you run this, so
-- this keeps working tomorrow.
-- ---------------------------------------------------------------------------
update public.tenders
set submission_deadline = current_date + 5
where id = 'deadbee2-0000-4000-8000-000000000006';  -- Growthpoint fit-out

update public.tenders
set submission_deadline = current_date + 12
where id = 'deadbee2-0000-4000-8000-000000000003';  -- Gauteng EA practice


-- ---------------------------------------------------------------------------
-- 3. Rename the QA row.
--
-- Renamed rather than deleted: it holds a placement that drives the December
-- step in the bench forecast, and it is your record, not mine, so removing it
-- is your call. The name and role are made consistent with the ERP Consultant
-- seat it sits on.
-- ---------------------------------------------------------------------------
update public.candidates
set full_name = 'Nadia Josephs',
    email = coalesce(nullif(email, ''), 'nadia.josephs@example.co.za')
where full_name like 'Test Candidate%';


-- ---------------------------------------------------------------------------
-- Verify.
-- ---------------------------------------------------------------------------
select 'seats now filled' as check, count(*)::text as value
from public.assignments a
join public.positions p on p.id = a.position_id
where p.parent_type = 'tender'
union all
select 'bids closing within 14 days',
       count(*)::text
from public.tenders
where status in ('draft', 'live')
  and submission_deadline between current_date and current_date + 14
union all
select 'rows still named Test Candidate',
       count(*)::text
from public.candidates
where full_name like 'Test Candidate%';
