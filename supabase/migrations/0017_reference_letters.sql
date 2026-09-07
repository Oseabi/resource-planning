-- Reference letters, and how many a tender demands.
--
-- Public tenders almost always ask for contactable references: letters from
-- past clients confirming work of a similar kind, size and recency was actually
-- delivered. A bid short of them is disqualified on compliance before anybody
-- looks at the team, which makes this as much a reason to lose as an unstaffed
-- seat, and the system could not say either how many a tender wanted or how
-- many were on file.
--
-- Deliberately separate from oem_letters. They look alike and are not: an OEM
-- letter is a manufacturer authorising you to resell, it expires, and it is
-- about a vendor relationship. A reference letter is a past client vouching for
-- delivered work, it does not expire, and what matters is who, what, when and
-- how big. Folding them together would mean a table where half the columns are
-- always null and an expiry badge that lies about half its rows.
--
-- Self-contained and idempotent: safe to re-run.

alter table public.tenders
  add column if not exists reference_letters_required int;

comment on column public.tenders.reference_letters_required is
  'How many client reference letters this tender asks for. Null means not yet read off the RFQ.';

-- Asking for a negative number of letters is a data-entry mistake. NOT VALID,
-- matching 0013 and 0016: binds new and updated rows without a table scan, and
-- without one odd historic row aborting the file, which the SQL Editor runs as
-- a single batch.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tenders_reference_letters_required_positive'
  ) then
    alter table public.tenders
      add constraint tenders_reference_letters_required_positive
      check (reference_letters_required is null or reference_letters_required >= 0) not valid;
  end if;
end $$;

create table if not exists public.reference_letters (
  id uuid primary key default gen_random_uuid(),
  -- Who signed it. The single most-asked question about a reference.
  client text not null,
  -- What the work was, as it should read on a bid schedule.
  project_title text not null,
  -- Practice areas, the shared vocabulary with candidates.resource_categories
  -- and oem_letters.categories, so one letter can answer for several.
  categories text[] not null default '{}',
  sectors text[] not null default '{}',
  -- Tenders qualify references by size and recency, so both have to be here to
  -- answer "three references for work over R5m in the last five years".
  contract_value numeric,
  work_started_on date,
  work_completed_on date,
  issue_date date,
  -- "Contactable" is usually the actual requirement, and a reference nobody can
  -- reach is worth nothing on a bid.
  contact_name text,
  contact_email text,
  contact_phone text,
  reference_number text,
  notes text,
  file_path text,
  original_filename text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Filtered by client, and range-scanned by recency and size when deciding which
-- letters answer a given tender.
create index if not exists reference_letters_client_idx on public.reference_letters (client);
create index if not exists reference_letters_completed_idx on public.reference_letters (work_completed_on);
create index if not exists reference_letters_categories_gin
  on public.reference_letters using gin (categories);

drop trigger if exists reference_letters_set_updated_at on public.reference_letters;
create trigger reference_letters_set_updated_at
  before update on public.reference_letters
  for each row execute function public.set_updated_at();

-- Same posture as candidates, tenders and oem_letters in 0002: shared CRUD for
-- any authenticated user, delete restricted to admins.
alter table public.reference_letters enable row level security;

drop policy if exists "reference_letters_select" on public.reference_letters;
create policy "reference_letters_select" on public.reference_letters
  for select to authenticated using (true);

drop policy if exists "reference_letters_insert" on public.reference_letters;
create policy "reference_letters_insert" on public.reference_letters
  for insert to authenticated with check (true);

drop policy if exists "reference_letters_update" on public.reference_letters;
create policy "reference_letters_update" on public.reference_letters
  for update to authenticated using (true) with check (true);

drop policy if exists "reference_letters_delete" on public.reference_letters;
create policy "reference_letters_delete" on public.reference_letters
  for delete to authenticated using (public.is_admin());

-- Verify 1. Expect one row: reference_letters_required | integer
select column_name as item, data_type as type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'tenders'
  and column_name = 'reference_letters_required';

-- Verify 2. Expect four rows, one per command.
select policyname as item, cmd as type
from pg_policies
where schemaname = 'public' and tablename = 'reference_letters'
order by policyname;
