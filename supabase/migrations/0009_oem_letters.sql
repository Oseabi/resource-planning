-- OEM letters — manufacturer authorisation letters (Microsoft, SAP, Oracle, …)
-- attached to tender bids. Organised by OEM vendor and by practice-area category,
-- with issue/expiry dates so lapsed authorisations can be surfaced before a bid.
--
-- Self-contained and idempotent: safe to re-run.

create table if not exists public.oem_letters (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  oem_vendor text not null,
  -- Practice areas, shared vocabulary with candidates.resource_categories.
  categories text[] not null default '{}',
  reference_number text,
  issued_to text,
  issue_date date,
  expiry_date date,
  notes text,
  file_path text,
  original_filename text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists oem_letters_vendor_idx on public.oem_letters (oem_vendor);
create index if not exists oem_letters_expiry_idx on public.oem_letters (expiry_date);
create index if not exists oem_letters_categories_gin on public.oem_letters using gin (categories);

-- Keep updated_at fresh (reuses the shared trigger function from 0001).
drop trigger if exists oem_letters_set_updated_at on public.oem_letters;
create trigger oem_letters_set_updated_at
  before update on public.oem_letters
  for each row execute function public.set_updated_at();

-- Shared CRUD for authenticated users; delete restricted to admins (as elsewhere).
alter table public.oem_letters enable row level security;

drop policy if exists "oem_letters_select" on public.oem_letters;
create policy "oem_letters_select" on public.oem_letters
  for select to authenticated using (true);

drop policy if exists "oem_letters_insert" on public.oem_letters;
create policy "oem_letters_insert" on public.oem_letters
  for insert to authenticated with check (true);

drop policy if exists "oem_letters_update" on public.oem_letters;
create policy "oem_letters_update" on public.oem_letters
  for update to authenticated using (true) with check (true);

drop policy if exists "oem_letters_delete" on public.oem_letters;
create policy "oem_letters_delete" on public.oem_letters
  for delete to authenticated using (public.is_admin());

-- Private bucket; all access goes through service-role server actions.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'oem-letters',
  'oem-letters',
  false,
  10485760, -- 10 MB
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do nothing;
