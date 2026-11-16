-- Candidate files live in SharePoint; the database keeps a link to them.
--
-- Until now every CV and certificate was copied into the private cvs bucket,
-- including the whole SharePoint archive ("Resourcing - Candidate Database").
-- That kept two copies of every file and ran into the storage plan's limit.
-- The library is already the company's filing system, so a record now points
-- at the SharePoint item instead: a drive id and an item id, the two values
-- Microsoft Graph needs to stream the file. Item ids survive renames and moves
-- inside the library, where a path would not.
--
-- A row has either a Supabase object path (older rows, until they are moved)
-- or a drive item, never neither. The app streams the file through its own
-- authenticated route either way, so no SharePoint link reaches the browser.
--
-- Deleting a candidate or document in the app removes the link only. The
-- library is the archive of record; the app never deletes a SharePoint file.
--
-- Self-contained and idempotent: safe to re-run.

alter table public.candidates add column if not exists cv_drive_id text;
alter table public.candidates add column if not exists cv_drive_item_id text;

alter table public.candidate_attachments add column if not exists drive_id text;
alter table public.candidate_attachments add column if not exists drive_item_id text;
alter table public.candidate_attachments alter column file_path drop not null;

alter table public.candidates drop constraint if exists candidates_cv_drive_pair;
alter table public.candidates add constraint candidates_cv_drive_pair
  check ((cv_drive_id is null) = (cv_drive_item_id is null));

alter table public.candidate_attachments drop constraint if exists candidate_attachments_has_file;
alter table public.candidate_attachments add constraint candidate_attachments_has_file
  check (
    (drive_id is null) = (drive_item_id is null)
    and (file_path is not null or drive_item_id is not null)
  );
