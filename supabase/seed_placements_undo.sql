-- ============================================================================
-- Undo supabase/seed_placements.sql.
-- Paste into the Supabase SQL Editor and Run.
--
-- Removes the four demo placements and puts the candidate statuses back the way
-- seed_demo.sql had them.
--
-- Self-contained and idempotent: safe to re-run, and safe if seed_placements
-- was never run.
-- ============================================================================

delete from public.placements
where candidate_id in (
  'deadbee1-0000-4000-8000-000000000009',  -- Zanele Mthembu
  'deadbee1-0000-4000-8000-000000000007',  -- Lerato Sibeko
  'deadbee1-0000-4000-8000-00000000000d',  -- Michelle van Wyk
  'deadbee1-0000-4000-8000-00000000000f'   -- Yusuf Ebrahim
);

-- Nothing reverses the 'placed' flag when a placement is deleted, so free
-- anyone left marked placed with no placement behind them.
update public.candidates c
set status = 'active'
where c.status = 'placed'
  and c.id::text like 'deadbee1-%'
  and not exists (select 1 from public.placements p where p.candidate_id = c.id);

-- seed_demo.sql ships Zanele as 'placed', so restore that specific state.
update public.candidates
set status = 'placed'
where id = 'deadbee1-0000-4000-8000-000000000009';

-- Verify: expect 0 demo placements.
select 'demo placements remaining' as item, count(*)::text as total
from public.placements
where candidate_id::text like 'deadbee1-%';
