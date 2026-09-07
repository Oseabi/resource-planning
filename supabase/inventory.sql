-- What is in this database, split into seeded demo rows and everything else.
-- Read-only. Run it before and after every step of a cleanup.
--
-- The seed files give their rows a fixed id prefix so they can be found again:
-- deadbee1 candidates, deadbee2 tenders, deadbee3 positions, deadbee4 OEM
-- letters. Nothing else uses those, so "other" is real work or QA leftovers.
--
-- assignments, placements, matches and activity carry no prefix. Their rows are
-- reachable only through the parents above, which is why the cleanup order
-- matters and why orphan_check.sql exists.
--
-- Columns are aliased item and total. Not "check", which is a reserved word:
-- using it as an alias aborts the entire file silently, because the SQL Editor
-- runs a file as a single batch.

select 'candidates demo'         as item, count(*)::text as total from public.candidates      where id::text like 'deadbee1-%'
union all select 'candidates other',      count(*)::text from public.candidates       where id::text not like 'deadbee1-%'
union all select 'tenders demo',          count(*)::text from public.tenders          where id::text like 'deadbee2-%'
union all select 'tenders other',         count(*)::text from public.tenders          where id::text not like 'deadbee2-%'
union all select 'positions demo',        count(*)::text from public.positions        where id::text like 'deadbee3-%'
union all select 'positions other',       count(*)::text from public.positions        where id::text not like 'deadbee3-%'
union all select 'oem letters demo',      count(*)::text from public.oem_letters      where id::text like 'deadbee4-%'
union all select 'oem letters other',     count(*)::text from public.oem_letters      where id::text not like 'deadbee4-%'
union all select 'job requirements',      count(*)::text from public.job_requirements
union all select 'assignments',           count(*)::text from public.assignments
union all select 'placements',            count(*)::text from public.placements
union all select 'matches',               count(*)::text from public.matches
union all select 'activity',              count(*)::text from public.activity
union all select 'profiles (never wiped)', count(*)::text from public.profiles
-- A file path means a real upload, and a SQL delete cannot reach the object.
-- These three must read 0 before reset_to_empty.sql will agree to run.
union all select 'candidates with a CV file', count(*)::text from public.candidates  where cv_file_path is not null
union all select 'tenders with a document',   count(*)::text from public.tenders     where source_document_path is not null
union all select 'oem letters with a file',   count(*)::text from public.oem_letters where file_path is not null
order by item;
