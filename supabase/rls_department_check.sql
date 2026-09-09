-- Does the department scoping actually hold? Read-only, rolls back.
--
-- This is the only honest test of the 0018 policies. A plain count in the SQL
-- Editor proves nothing: it runs as postgres, which bypasses RLS entirely, so
-- everything looks visible whether the policies work or not. This impersonates
-- one real user and reports what that user can see.
--
-- Run it once per department manager and once for an admin. Everything is
-- inside a transaction that rolls back, so it cannot change anything.
--
-- CHANGE THE EMAIL ON LINE 22 before each run.

begin;

-- Become that user for the rest of the transaction. set_config with is_local
-- true means it lasts until the rollback and no further.
select set_config(
  'request.jwt.claims',
  json_build_object('sub', p.id, 'role', 'authenticated')::text,
  true
)
from public.profiles p
where p.email = 'CHANGE-ME@tippfocus.co.za';

set local role authenticated;

-- Who am I, and where do I sit. If department is null and role is not admin,
-- every scoped count below should be zero, which is the correct way for an
-- unassigned account to fail.
select 'acting as' as item, coalesce(current_setting('request.jwt.claims', true), 'nobody') as type
union all
select 'is_admin', (select public.is_admin())::text
union all
select 'is_manager', (select public.is_manager())::text
union all
select 'department', coalesce(
  (select d.name from public.departments d where d.id = public.current_department_id()),
  'none'
);

-- The first seven must show this department's rows only.
-- The last three must equal the company totals: they are shared by decision,
-- and a zero here means the shared pool has been scoped by mistake, which
-- would break seat coverage without anything on screen saying so.
select 'tenders' as item, count(*)::text as type from public.tenders
union all select 'job_requirements', count(*)::text from public.job_requirements
union all select 'positions', count(*)::text from public.positions
union all select 'assignments', count(*)::text from public.assignments
union all select 'matches', count(*)::text from public.matches
union all select 'placements', count(*)::text from public.placements
union all select 'activity on tenders', count(*)::text
  from public.activity where entity_type = 'tender'
union all select 'SHARED candidates', count(*)::text from public.candidates
union all select 'SHARED oem_letters', count(*)::text from public.oem_letters
union all select 'SHARED reference_letters', count(*)::text from public.reference_letters
union all select 'SHARED commitments', count(*)::text from public.candidate_commitments()
order by item;

rollback;

-- ---------------------------------------------------------------------------
-- Three negative tests. Run each on its own, as the manager, with a department
-- id and tender id that belong to a DIFFERENT department. Each must fail in the
-- way named. Uncomment one at a time.
-- ---------------------------------------------------------------------------

-- 1. Filing a bid into somebody else's department.
--    Expect: new row violates row-level security policy for table "tenders"
--
-- begin;
-- select set_config('request.jwt.claims',
--   json_build_object('sub', p.id, 'role', 'authenticated')::text, true)
--   from public.profiles p where p.email = 'CHANGE-ME@tippfocus.co.za';
-- set local role authenticated;
-- insert into public.tenders (title, department_id)
--   values ('leak test', 'OTHER-DEPARTMENT-UUID');
-- rollback;

-- 2. Moving yourself into another department.
--    Expect: Only admins can change a profile role or department
--
-- begin;
-- select set_config('request.jwt.claims',
--   json_build_object('sub', p.id, 'role', 'authenticated')::text, true)
--   from public.profiles p where p.email = 'CHANGE-ME@tippfocus.co.za';
-- set local role authenticated;
-- update public.profiles set department_id = 'OTHER-DEPARTMENT-UUID' where id = auth.uid();
-- rollback;

-- 3. Deleting another department's tender.
--    Expect ZERO rows returned and NO error. That silence is exactly why the
--    delete actions in the app count rows rather than trusting the error.
--
-- begin;
-- select set_config('request.jwt.claims',
--   json_build_object('sub', p.id, 'role', 'authenticated')::text, true)
--   from public.profiles p where p.email = 'CHANGE-ME@tippfocus.co.za';
-- set local role authenticated;
-- delete from public.tenders where id = 'OTHER-DEPARTMENT-TENDER-UUID' returning id;
-- rollback;
