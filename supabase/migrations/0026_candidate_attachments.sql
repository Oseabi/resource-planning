-- Documents on a person's file.
--
-- A candidate has exactly one file today, their CV, on
-- candidates.cv_file_path. A person's file in real life is a folder: a scanned
-- TOGAF certificate, a degree, an ID copy, a signed contract. One column
-- cannot hold a folder, and the system had nowhere to put the second document.
--
-- Typed, not a flat list. Six kinds, because that is how somebody looks for
-- one ("where is his ID copy"), and because the profile groups under those
-- headings rather than printing eight filenames in upload order.
--
-- No expiry date, deliberately. The one thing in this system that really
-- lapses is a manufacturer's authorisation to resell, which has its own table
-- (oem_letters), its own index on expiry_date and its own badge. A certificate
-- scan on a person's file is evidence of what they hold, not a permission that
-- runs out. An expiry column here would invite a cross-candidate "expiring
-- documents" view that would be wrong about every ID copy in it.
--
-- Rejected: a new storage bucket. The private cvs bucket is already shared by
-- tender documents under a tenders/ prefix, the way reference letters share
-- the oem-letters bucket under references/. Attachments live under
-- attachments/. A fourth bucket would be a fourth entry to keep in step in the
-- hand-run storage_setup.sql for no gain, and sharing buys something concrete:
-- deleting a candidate clears the CV and every attachment in one call, because
-- they are in the same bucket. Its four allowed types (pdf, docx, png, jpeg)
-- cover a scan, a photographed certificate and a drafted contract; widening it
-- to take .doc would quietly widen what a CV upload accepts too. So there is
-- no storage statement in this file at all.
--
-- Rejected: any link to candidates.certificates. That JSONB array is what the
-- CV prints; this table is a filing cabinet. Postgres cannot put a foreign key
-- into a JSONB element, and tying the two would mean editing a CV could orphan
-- a document. The form offers those names as suggestions and copies the text.
--
-- Rejected: admin-only delete. Whoever attaches the wrong scan should be able
-- to take it down without finding an admin, the way the author of a note can
-- in 0014.
--
-- Self-contained and idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

create table if not exists public.candidate_attachments (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  kind text not null check (
    kind in ('certificate', 'qualification', 'id_document', 'contract', 'reference', 'other')
  ),
  title text not null,
  -- An attachment is the file. Unlike oem_letters and reference_letters, where
  -- the metadata earns its keep alone (a reference's client and contact answer
  -- a tender question before anybody opens the PDF), a row here without a
  -- document would mean nothing, so both file columns are not null.
  file_path text not null,
  original_filename text not null,
  -- Matches 0011: removing a user keeps the document, attributed to nobody.
  -- Also what the delete policy reads, so the uploader can take down their own.
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every read is the same read: the documents on this one person's file,
-- grouped by kind, in the order they arrived. One index covers the filter and
-- the ordering together.
create index if not exists candidate_attachments_candidate_idx
  on public.candidate_attachments (candidate_id, kind, created_at);

comment on column public.candidate_attachments.candidate_id is
  'The person this document belongs to. Cascades, so the rows go when the candidate does; the stored files are removed by the delete action.';

comment on column public.candidate_attachments.kind is
  'What the document is, and the heading the profile files it under. Mirrors CandidateAttachmentKind in database.types.ts.';

comment on column public.candidate_attachments.title is
  'What it is called on screen, for example "TOGAF 9 Foundation". Copied from the record''s certificates where one matches, never linked to it.';

comment on column public.candidate_attachments.file_path is
  'Object path in the shared private cvs bucket, under attachments/.';

comment on column public.candidate_attachments.original_filename is
  'The uploaded file''s own name, sanitised. Shown under the title so the document is recognisable.';

comment on column public.candidate_attachments.created_by is
  'Who attached it. Null once that account goes; while it is set, they may remove their own document without an admin.';

-- Keep updated_at fresh (reuses the shared trigger function from 0001).
drop trigger if exists candidate_attachments_set_updated_at on public.candidate_attachments;
create trigger candidate_attachments_set_updated_at
  before update on public.candidate_attachments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.candidate_attachments enable row level security;

-- The same posture as candidates itself in 0002 for the first three: the pool
-- is shared, and a document on a person's file is not a department secret.
drop policy if exists "candidate_attachments_select" on public.candidate_attachments;
create policy "candidate_attachments_select" on public.candidate_attachments
  for select to authenticated using (true);

drop policy if exists "candidate_attachments_insert" on public.candidate_attachments;
create policy "candidate_attachments_insert" on public.candidate_attachments
  for insert to authenticated with check (true);

-- Nothing in the app updates a row today. The policy and updated_at follow the
-- house pattern so renaming a document later needs no migration.
drop policy if exists "candidate_attachments_update" on public.candidate_attachments;
create policy "candidate_attachments_update" on public.candidate_attachments
  for update to authenticated using (true) with check (true);

-- The one departure from the house pattern, and the reason is above. Wrapped
-- in selects so the planner evaluates each once per statement rather than once
-- per row, the way 0018 does.
drop policy if exists "candidate_attachments_delete" on public.candidate_attachments;
create policy "candidate_attachments_delete" on public.candidate_attachments
  for delete to authenticated
  using ((select public.is_admin()) or created_by = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- Aliased as item / type / detail throughout. Never "check", which is a
-- reserved word and aborts the batch.

-- 1. Nine columns. candidate_id, kind, title, file_path and original_filename
--    read NO.
select column_name as item, is_nullable as type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'candidate_attachments'
order by ordinal_position;

-- 2. Four policies, one per command.
select policyname as item, cmd as type
from pg_policies
where schemaname = 'public' and tablename = 'candidate_attachments'
order by policyname;

-- 3. One row: the six kinds the app knows.
select conname as item, pg_get_constraintdef(oid) as detail
from pg_constraint
where conname = 'candidate_attachments_kind_check';

-- 4. One row: the trigger is in place.
select tgname as item, tgenabled::text as detail
from pg_trigger
where tgname = 'candidate_attachments_set_updated_at';

-- 5. Two rows: the candidate link reads c (cascade, so documents go with the
--    person) and the profile link reads n (set null, so the record survives
--    the uploader's account).
select conname as item, confdeltype::text as detail
from pg_constraint
where conrelid = 'public.candidate_attachments'::regclass
  and contype = 'f'
order by conname;
