-- The CV's own words for availability, and the setting the cover page needs.
--
-- The issued template prints AVAILABILITY as the candidate put it: "1 Calendar
-- Month", "1 Month Notice", "Immediately". The record kept only a three-way
-- status, so the generated CV printed "On notice" over an actual notice
-- period. The words are kept beside the status now.
--
-- The cover page of every issued CV carries the account manager's name,
-- email and office number. Those belong to one setting, never to a
-- candidate record, and an admin changes them in one place when the person
-- changes.
--
-- Self-contained and idempotent: safe to re-run.

alter table public.candidates
  add column if not exists availability_note text;

comment on column public.candidates.availability_note is
  'The CV''s own words for availability ("1 Calendar Month"). Printed on the generated CV when present; availability stays the status matching uses.';

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.app_settings is
  'One row per setting, keyed by name. account_manager: {name, email, phone} printed on the CV cover page.';

alter table public.app_settings enable row level security;

-- Anybody signed in reads them: the CV route runs as the person generating.
drop policy if exists "app_settings_select" on public.app_settings;
create policy "app_settings_select" on public.app_settings
  for select to authenticated using (true);

-- Admins write them.
drop policy if exists "app_settings_insert" on public.app_settings;
create policy "app_settings_insert" on public.app_settings
  for insert to authenticated with check ((select public.is_admin()));

drop policy if exists "app_settings_update" on public.app_settings;
create policy "app_settings_update" on public.app_settings
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- No delete policy. A setting is changed, not removed.
drop policy if exists "app_settings_delete" on public.app_settings;

-- The account manager as the cover page prints her today. Left alone if the
-- row already exists, so a later change on the settings card survives a
-- re-run.
insert into public.app_settings (key, value)
values ('account_manager', '{"name": "Samantha Africa", "email": "samantha@tippfocus.co.za", "phone": "011 805 3447"}'::jsonb)
on conflict (key) do nothing;

-- Verify.
select key, value ->> 'name' as name, updated_at from public.app_settings;
select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'candidates' and column_name = 'availability_note';
