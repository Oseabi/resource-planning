-- Empty every business table, so real records can be loaded into a clean system.
--
-- seed_demo_cleanup.sql removes the seeded rows by their deadbee id prefix and
-- deliberately leaves everything else alone. That is right for undoing a demo,
-- but it cannot reach the handful of QA rows created by hand during
-- development, which carry ordinary random ids and are indistinguishable from
-- real records by their id.
--
-- So this file wipes the business tables outright, and guards itself instead.
--
-- It NEVER touches profiles, auth.users, or storage buckets. You will still be
-- able to log in afterwards, and any uploaded file stays in its bucket. If a
-- record being deleted here has a file, delete the object in the Storage
-- browser as well, because SQL cannot reach it.
--
-- Run supabase/orphan_check.sql afterwards. It should return zero rows.

-- The guard. Every real record arrives through an upload: a candidate through a
-- CV, a tender through an RFQ, a letter through its PDF. Not one demo or QA row
-- has a file attached, so a file path anywhere is the clearest available signal
-- that this database holds work somebody would miss.
--
-- Raising here aborts the whole file, which is exactly what the SQL Editor's
-- single-batch behaviour gives us for free.
do $$
declare
  attached int;
  people int;
begin
  select (select count(*) from public.candidates where cv_file_path is not null)
       + (select count(*) from public.tenders where source_document_path is not null)
       + (select count(*) from public.oem_letters where file_path is not null)
    into attached;

  if attached > 0 then
    raise exception
      'Refusing to wipe: % record(s) carry an uploaded file, so this database holds real work. Delete this guard only if you are certain.', attached;
  end if;

  select count(*) into people from public.candidates;
  if people > 40 then
    raise exception
      'Refusing to wipe: % candidates is more than this file was written for. Check what is in here first.', people;
  end if;
end $$;

-- Children before parents. Most of these would cascade, but the order documents
-- the dependency graph for whoever reads this next, and the four polymorphic
-- links (positions.parent_id, matches.match_target_id, placements.source_id,
-- activity.entity_id) carry no foreign key and cascade from nothing.
delete from public.match_alerts;
delete from public.matches;
delete from public.placements;
delete from public.assignments;
delete from public.positions;
delete from public.tenders;
delete from public.job_requirements;
delete from public.candidates;
delete from public.oem_letters;
delete from public.activity;

-- No verification query here on purpose. The SQL Editor runs this file as one
-- batch, so a count at the bottom would report the state after the deletes and
-- prove nothing. Run the inventory query separately.
