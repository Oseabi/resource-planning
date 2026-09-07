-- Integrity check. Read-only. Should always return zero rows.
--
-- Four tables point at their parent without a foreign key, because the parent
-- can be either a tender or a job requirement and Postgres cannot reference two
-- tables from one column: positions.parent_type/parent_id,
-- matches.match_target_type/match_target_id, placements.source_type/source_id,
-- and activity.entity_type/entity_id. Nothing cascades down any of those, so
-- every delete path has to sweep them by hand, and a missed sweep leaves rows
-- that no page can render and no query will trip over.
--
-- There is no way to unit-test a server action in this project, so this file is
-- the regression net for that class of bug. Run it after any delete, and after
-- a bulk import.
--
-- Safe to run against live data at any time. It only reads.

select 'position with no parent tender' as problem, p.id::text as id, p.role as detail
from public.positions p
where p.parent_type = 'tender'
  and not exists (select 1 from public.tenders t where t.id = p.parent_id)

union all
select 'position with no parent requirement', p.id::text, p.role
from public.positions p
where p.parent_type = 'job_requirement'
  and not exists (select 1 from public.job_requirements r where r.id = p.parent_id)

union all
select 'match against a deleted seat', m.id::text, m.match_target_id::text
from public.matches m
where m.match_target_type = 'position'
  and not exists (select 1 from public.positions p where p.id = m.match_target_id)

union all
select 'match against a deleted tender', m.id::text, m.match_target_id::text
from public.matches m
where m.match_target_type = 'tender'
  and not exists (select 1 from public.tenders t where t.id = m.match_target_id)

union all
select 'match against a deleted requirement', m.id::text, m.match_target_id::text
from public.matches m
where m.match_target_type = 'job_requirement'
  and not exists (select 1 from public.job_requirements r where r.id = m.match_target_id)

union all
select 'placement on a deleted tender', pl.id::text, pl.source_id::text
from public.placements pl
where pl.source_type = 'tender'
  and not exists (select 1 from public.tenders t where t.id = pl.source_id)

union all
select 'placement on a deleted requirement', pl.id::text, pl.source_id::text
from public.placements pl
where pl.source_type = 'job_requirement'
  and not exists (select 1 from public.job_requirements r where r.id = pl.source_id)

union all
select 'activity on a deleted record', a.id::text, a.entity_type || ' ' || a.entity_id::text
from public.activity a
where (a.entity_type = 'tender'
        and not exists (select 1 from public.tenders t where t.id = a.entity_id))
   or (a.entity_type = 'job_requirement'
        and not exists (select 1 from public.job_requirements r where r.id = a.entity_id))
   or (a.entity_type = 'candidate'
        and not exists (select 1 from public.candidates c where c.id = a.entity_id))
   or (a.entity_type = 'oem_letter'
        and not exists (select 1 from public.oem_letters o where o.id = a.entity_id))

-- The placement trigger sets status to 'placed' on insert and nothing reverses
-- it on delete, so a missed repair loop leaves somebody hidden from matching
-- with nothing on their record explaining why.
union all
select 'candidate flagged placed with no placement', c.id::text, c.full_name
from public.candidates c
where c.status = 'placed'
  and not exists (select 1 from public.placements pl where pl.candidate_id = c.id)

-- tenders_contract_end_after_start was added NOT VALID, so it binds new and
-- updated rows but never checked the rows that were already there.
union all
select 'contract ends before it starts', t.id::text, t.title
from public.tenders t
where t.contract_end_date is not null
  and t.contract_start_date is not null
  and t.contract_end_date < t.contract_start_date

-- reference_number carries an index, not a unique constraint, so duplicates are
-- possible. They matter because an importer matching on that key cannot tell
-- which row a spreadsheet line means.
-- Wrapped in a subquery rather than grouping inside the union branch, so the
-- aggregate cannot be read as applying to the whole chain.
union all
select 'duplicate reference number', d.ids, d.reference_number
from (
  select string_agg(t.id::text, ', ') as ids, t.reference_number as reference_number
  from public.tenders t
  where t.reference_number is not null and btrim(t.reference_number) <> ''
  group by t.reference_number
  having count(*) > 1
) d

order by problem;
