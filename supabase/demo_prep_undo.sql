-- ============================================================================
-- Undo supabase/demo_prep.sql.
-- Paste into the Supabase SQL Editor and Run.
--
-- Puts the three demo-prep changes back: unstaffs the seats it proposed,
-- restores the two deadlines, and restores the QA candidate's name.
--
-- Self-contained and idempotent: safe to re-run, and safe if demo_prep.sql was
-- never run.
-- ============================================================================

-- 1. Remove proposed seats on the four demo bids.
--
-- Only 'proposed' rows are touched. Anything you placed for real during the
-- demo is a different status and stays, along with its placement.
delete from public.assignments a
using public.positions p
where p.id = a.position_id
  and a.status = 'proposed'
  and p.parent_type = 'tender'
  and p.parent_id in (
    'deadbee2-0000-4000-8000-000000000001',
    'deadbee2-0000-4000-8000-000000000004',
    'deadbee2-0000-4000-8000-000000000005',
    'deadbee2-0000-4000-8000-000000000002'
  );

-- 2. Restore the two deadlines to their seeded values.
update public.tenders
set submission_deadline = '2026-09-12'
where id = 'deadbee2-0000-4000-8000-000000000006';

update public.tenders
set submission_deadline = '2026-09-18'
where id = 'deadbee2-0000-4000-8000-000000000003';

-- 3. Restore the QA candidate's name.
update public.candidates
set full_name = 'Test Candidate (positions QA)'
where full_name = 'Nadia Josephs';

-- Verify: expect 0 proposed seats on those four bids, and the name back.
select 'proposed seats on the four demo bids' as check, count(*)::text as value
from public.assignments a
join public.positions p on p.id = a.position_id
where a.status = 'proposed'
  and p.parent_type = 'tender'
  and p.parent_id in (
    'deadbee2-0000-4000-8000-000000000001',
    'deadbee2-0000-4000-8000-000000000004',
    'deadbee2-0000-4000-8000-000000000005',
    'deadbee2-0000-4000-8000-000000000002'
  )
union all
select 'rows named Test Candidate', count(*)::text
from public.candidates
where full_name like 'Test Candidate%';
