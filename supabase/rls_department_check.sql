-- Does the department scoping actually hold? Read-only, rolls back.
--
-- This is the only honest test of the 0018 policies. A plain count in the SQL
-- Editor proves nothing: it runs as postgres, which bypasses RLS entirely, so
-- everything looks visible whether the policies work or not. This impersonates
-- one real user and reports what that user can see.
--
-- Everything below runs inside a transaction that rolls back, so it cannot
-- change anything.
--
--
-- BEFORE YOU RUN IT
--
--   1. On Settings, Users: invite an account, set it to Manager of
--      Tipp Consulting. It cannot be an admin, because is_admin() short
--      circuits every policy and an admin would see everything by design.
--   2. Put that address on the CHANGE ME line in each block below.
--
-- The two SCOPING TEST tenders are already in place, one in Tipp Consulting
-- and one in Tipp Construction.
--
--
-- THE DEPARTMENTS ON THIS DATABASE
--
--   Tipp Consulting        3ebe4afa-24ca-48aa-8e34-6919a1156db8
--   Tipp Resourcing        a4ab584d-a17e-490d-8d02-e2dcd415135e
--   Tipp Human Capital     f75f0645-91d1-4e57-a122-c98bfa4bfa11
--   Tipp Construction      389acec6-1b6a-4752-b487-0801cd76c833

-- ===========================================================================
-- 1. WHAT CAN THEY SEE
--
-- Expect: 1 tender, not 2. The three lines marked SHARED must match the
-- company totals, because the candidate pool and the letters are shared by
-- design. A zero on those means the shared pool has been scoped by mistake,
-- which would break seat coverage with nothing on screen saying so.
-- ===========================================================================

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', p.id, 'role', 'authenticated')::text,
  true
)
from public.profiles p
where p.email = 'CHANGE ME@tippfocus.co.za';

set local role authenticated;

select 'acting as' as item,
       coalesce((select p.email from public.profiles p where p.id = auth.uid()), 'nobody') as type
union all select 'is_admin (must be false)', (select public.is_admin())::text
union all select 'is_manager (must be true)', (select public.is_manager())::text
union all select 'department', coalesce(
  (select d.name from public.departments d where d.id = public.current_department_id()), 'none');

select 'tenders (expect 1)' as item, count(*)::text as type from public.tenders
union all select 'job_requirements', count(*)::text from public.job_requirements
union all select 'positions', count(*)::text from public.positions
union all select 'assignments', count(*)::text from public.assignments
union all select 'matches', count(*)::text from public.matches
union all select 'placements', count(*)::text from public.placements
union all select 'SHARED candidates', count(*)::text from public.candidates
union all select 'SHARED oem_letters', count(*)::text from public.oem_letters
union all select 'SHARED reference_letters', count(*)::text from public.reference_letters
union all select 'SHARED commitments', count(*)::text from public.candidate_commitments()
order by item;

-- Which one they can see. Expect the Consulting bid and only that.
select title as item, 'visible' as type from public.tenders order by title;

rollback;


-- ===========================================================================
-- 2. FILING A BID INTO SOMEBODY ELSE'S DEPARTMENT
--
-- Expect: ERROR, new row violates row-level security policy for table "tenders"
-- ===========================================================================

begin;
select set_config('request.jwt.claims',
  json_build_object('sub', p.id, 'role', 'authenticated')::text, true)
  from public.profiles p where p.email = 'CHANGE ME@tippfocus.co.za';
set local role authenticated;

insert into public.tenders (title, department_id)
values ('leak test', '389acec6-1b6a-4752-b487-0801cd76c833');

rollback;


-- ===========================================================================
-- 3. MOVING YOURSELF INTO ANOTHER DEPARTMENT
--
-- Expect: ERROR, Only admins can change a profile role or department
--
-- profiles_update_self lets anybody write their own row, so without the
-- trigger 0018 extended, this is how a manager would walk into another
-- department's bids.
-- ===========================================================================

begin;
select set_config('request.jwt.claims',
  json_build_object('sub', p.id, 'role', 'authenticated')::text, true)
  from public.profiles p where p.email = 'CHANGE ME@tippfocus.co.za';
set local role authenticated;

update public.profiles
set department_id = '389acec6-1b6a-4752-b487-0801cd76c833'
where id = auth.uid();

rollback;


-- ===========================================================================
-- 4. DELETING ANOTHER DEPARTMENT'S TENDER
--
-- Expect: ZERO ROWS and NO ERROR. That silence is exactly why every delete
-- action in the app counts the rows it affected rather than trusting the
-- absence of an error.
-- ===========================================================================

begin;
select set_config('request.jwt.claims',
  json_build_object('sub', p.id, 'role', 'authenticated')::text, true)
  from public.profiles p where p.email = 'CHANGE ME@tippfocus.co.za';
set local role authenticated;

delete from public.tenders
where id = 'a040d0eb-04aa-462a-b625-ce7c6cd7865e'
returning id, title;

rollback;


-- ===========================================================================
-- 5. THE AUDIT TRAIL IS APPEND ONLY
--
-- Both must affect ZERO ROWS. audit_log has no update policy and no delete
-- policy, for anybody, which is what makes it evidence rather than notes.
-- ===========================================================================

begin;
select set_config('request.jwt.claims',
  json_build_object('sub', p.id, 'role', 'authenticated')::text, true)
  from public.profiles p where p.email = 'CHANGE ME@tippfocus.co.za';
set local role authenticated;

update public.audit_log set action = 'tampered' returning id;
delete from public.audit_log returning id;

rollback;


-- ===========================================================================
-- WHEN YOU ARE DONE
--
-- Remove the two fixtures:
--
--   delete from public.tenders where title like 'SCOPING TEST%';
-- ===========================================================================
