-- ============================================================================
-- Remove everything supabase/seed_demo.sql created.
-- Paste this whole file into the Supabase dashboard SQL Editor and click "Run".
--
-- Demo rows are identified purely by their UUID prefix, so nothing real is at
-- risk: candidates 'deadbee1-…', tenders 'deadbee2-…', positions 'deadbee3-…',
-- OEM letters 'deadbee4-…'.
-- Anything you created yourself has an ordinary random UUID and is untouched.
--
-- This also covers supabase/seed_oem_letters.sql. It does not undo
-- supabase/seed_candidate_details.sql, which only fills columns on the
-- 'deadbee1-…' candidates removed below.
--
-- Order matters. matches.match_target_id and placements.source_id have no
-- foreign keys (both are polymorphic), so those rows must be deleted explicitly
-- before their targets, nothing cascades them.
--
-- Self-contained and idempotent: safe to re-run, and safe to run before ever
-- seeding.
-- ============================================================================

-- Matches scored against demo positions (match_target_type = 'position').
delete from public.matches
where match_target_id::text like 'deadbee3-%';

-- Matches scored against the demo tenders themselves, if any legacy rows exist.
delete from public.matches
where match_target_id::text like 'deadbee2-%';

-- Any match row naming a demo candidate, whatever it was scored against.
delete from public.matches
where candidate_id::text like 'deadbee1-%';

-- Placements referencing a demo tender or a demo candidate. Deleting these
-- leaves real candidates flagged 'placed' with no placement, so the status is
-- repaired below.
delete from public.placements
where source_id::text like 'deadbee2-%'
   or candidate_id::text like 'deadbee1-%'
   or position_id::text like 'deadbee3-%';

-- Assignments cascade from positions, but demo candidates may also hold seats on
-- your real tenders, remove those too.
delete from public.assignments
where candidate_id::text like 'deadbee1-%'
   or position_id::text like 'deadbee3-%';

-- Positions, then their parents.
delete from public.positions
where id::text like 'deadbee3-%'
   or parent_id::text like 'deadbee2-%';

delete from public.tenders
where id::text like 'deadbee2-%';

delete from public.candidates
where id::text like 'deadbee1-%';

-- Demo OEM letters. Nothing references these, so ordering does not matter.
delete from public.oem_letters
where id::text like 'deadbee4-%';

-- Nothing reverses the placed flag when a placement is deleted (the trigger has
-- no counterpart), so free any real candidate left marked placed with no
-- placement behind it.
update public.candidates c
set status = 'active'
where c.status = 'placed'
  and not exists (
    select 1 from public.placements p where p.candidate_id = c.id
  );
