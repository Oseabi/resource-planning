-- ============================================================================
-- Resource Planning — full database setup
-- Paste this whole file into the Supabase dashboard SQL Editor and click "Run".
-- It creates all tables, indexes, triggers, and Row Level Security policies.
-- Safe to re-run: the reset block below drops any previous objects first.
-- (This only drops THIS app's tables — it does not touch Supabase auth data.)
-- ============================================================================

-- --- Clean slate (safe to re-run) --------------------------------------------
drop table if exists public.assignments cascade;
drop table if exists public.positions cascade;
drop table if exists public.match_alerts cascade;
drop table if exists public.matches cascade;
drop table if exists public.placements cascade;
drop table if exists public.candidates cascade;
drop table if exists public.job_requirements cascade;
drop table if exists public.tenders cascade;
drop table if exists public.oem_letters cascade;
drop table if exists public.profiles cascade;
drop function if exists public.is_admin() cascade;
drop function if exists public.set_updated_at() cascade;
drop function if exists public.prevent_role_self_escalation() cascade;
drop function if exists public.handle_placement_created() cascade;
drop function if exists public.candidates_set_search_text() cascade;

create extension if not exists "pgcrypto";
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null default 'user' check (role in ('admin', 'user')),
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  phone text,
  "current_role" text,
  additional_roles text[] not null default '{}',
  years_experience numeric,
  professional_summary text,
  skills text[] not null default '{}',
  technical_skills text[] not null default '{}',
  certifications text[] not null default '{}',
  qualifications text[] not null default '{}',
  sectors text[] not null default '{}',
  languages text[] not null default '{}',
  resource_categories text[] not null default '{}',
  linkedin_url text,
  portfolio_url text,
  work_experience jsonb not null default '[]',
  education jsonb not null default '[]',
  availability text not null default 'available' check (availability in ('available', 'notice_period', 'unavailable')),
  status text not null default 'active' check (status in ('active', 'inactive', 'placed')),
  location text,
  cv_file_path text,
  cv_original_filename text,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Populated by the candidates_set_search_text trigger (defined below). A plain
  -- column rather than GENERATED because some Postgres versions reject
  -- array_to_string() in a generated expression as "not immutable".
  search_text text
);

create table public.job_requirements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  client text,
  required_role text,
  required_skills text[] not null default '{}',
  required_certifications text[] not null default '{}',
  required_qualifications text[] not null default '{}',
  sectors text[] not null default '{}',
  min_experience_years numeric,
  location text,
  required_availability text,
  manager_email text,
  status text not null default 'open' check (status in ('open', 'closed', 'on_hold')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenders (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  -- Bid/reference number used by the issuing authority on all submissions.
  reference_number text,
  client text,
  location text,
  value numeric,
  submission_deadline date,
  contract_start_date date,
  required_roles text[] not null default '{}',
  required_skills text[] not null default '{}',
  required_certifications text[] not null default '{}',
  sectors text[] not null default '{}',
  min_experience_years numeric,
  status text not null default 'draft' check (status in ('draft', 'live', 'submitted', 'won', 'lost')),
  source_document_path text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.oem_letters (
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
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The roles a requirement or tender needs staffed. Each line carries its own
-- seat count, experience floor, skills and certifications, so a bid needing
-- three analysts at 3 years and a lead at 5 is expressed exactly.
create table public.positions (
  id uuid primary key default gen_random_uuid(),
  parent_type text not null check (parent_type in ('job_requirement', 'tender')),
  parent_id uuid not null,
  role text not null,
  quantity int not null default 1 check (quantity > 0),
  min_experience_years numeric,
  required_skills text[] not null default '{}',
  required_certifications text[] not null default '{}',
  required_availability text,
  sort_order int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seat allocation. Separate from placements: a tender team is PROPOSED while
-- the bid is open and must not inflate revenue or mark anyone unavailable.
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.positions (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  status text not null default 'proposed' check (status in ('proposed', 'placed')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (position_id, candidate_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  -- Matching runs per position; the parent types remain for legacy rows.
  match_target_type text not null check (match_target_type in ('job_requirement', 'tender', 'position')),
  match_target_id uuid not null,
  score numeric not null,
  score_breakdown jsonb not null default '{}',
  ai_deep_match_notes text,
  alert_sent boolean not null default false,
  alerted_score numeric,
  created_at timestamptz not null default now()
);

create table public.match_alerts (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  sent_to text not null,
  sent_at timestamptz not null default now(),
  status text not null
);

create table public.placements (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  source_type text not null check (source_type in ('job_requirement', 'tender')),
  source_id uuid not null,
  -- Which seat this filled; null for placements predating positions.
  position_id uuid references public.positions (id) on delete set null,
  fee_value numeric not null,
  start_date date not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index candidates_status_idx on public.candidates (status);
create index candidates_availability_idx on public.candidates (availability);
create index candidates_skills_gin on public.candidates using gin (skills);
create index candidates_certifications_gin on public.candidates using gin (certifications);
create index candidates_qualifications_gin on public.candidates using gin (qualifications);
create index candidates_sectors_gin on public.candidates using gin (sectors);
create index candidates_email_idx on public.candidates (email);
create index candidates_phone_idx on public.candidates (phone);
create index candidates_additional_roles_gin on public.candidates using gin (additional_roles);
create index candidates_technical_skills_gin on public.candidates using gin (technical_skills);
create index candidates_languages_gin on public.candidates using gin (languages);
create index candidates_resource_categories_gin on public.candidates using gin (resource_categories);
create index candidates_search_trgm on public.candidates using gin (search_text gin_trgm_ops);

create index job_requirements_status_idx on public.job_requirements (status);
create index job_requirements_skills_gin on public.job_requirements using gin (required_skills);
create index job_requirements_certifications_gin on public.job_requirements using gin (required_certifications);
create index job_requirements_sectors_gin on public.job_requirements using gin (sectors);

create index tenders_status_idx on public.tenders (status);
create index tenders_reference_number_idx on public.tenders (reference_number);
create index tenders_skills_gin on public.tenders using gin (required_skills);
create index tenders_roles_gin on public.tenders using gin (required_roles);
create index tenders_sectors_gin on public.tenders using gin (sectors);

create index oem_letters_vendor_idx on public.oem_letters (oem_vendor);
create index oem_letters_expiry_idx on public.oem_letters (expiry_date);
create index oem_letters_categories_gin on public.oem_letters using gin (categories);

create index positions_parent_idx on public.positions (parent_type, parent_id);
create index positions_role_idx on public.positions (role);
create index assignments_position_idx on public.assignments (position_id);
create index assignments_candidate_idx on public.assignments (candidate_id);
create index placements_position_idx on public.placements (position_id);

create index matches_candidate_idx on public.matches (candidate_id);
create index matches_target_idx on public.matches (match_target_type, match_target_id);
create unique index matches_target_candidate_uidx on public.matches (candidate_id, match_target_type, match_target_id);

create index match_alerts_match_idx on public.match_alerts (match_id);

create index placements_candidate_idx on public.placements (candidate_id);
create index placements_source_idx on public.placements (source_type, source_id);
create unique index placements_candidate_source_uidx on public.placements (candidate_id, source_type, source_id);

-- ---------------------------------------------------------------------------
-- Helper functions & triggers
-- ---------------------------------------------------------------------------
create function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger candidates_set_updated_at
  before update on public.candidates
  for each row execute function public.set_updated_at();

-- Maintain the candidate search_text column (used for trigram search).
create function public.candidates_set_search_text()
returns trigger
language plpgsql
as $$
begin
  new.search_text :=
    coalesce(new.full_name, '') || ' ' ||
    coalesce(new."current_role", '') || ' ' ||
    array_to_string(coalesce(new.additional_roles, '{}'), ' ') || ' ' ||
    coalesce(new.location, '') || ' ' ||
    coalesce(new.professional_summary, '') || ' ' ||
    array_to_string(coalesce(new.skills, '{}'), ' ') || ' ' ||
    array_to_string(coalesce(new.technical_skills, '{}'), ' ') || ' ' ||
    array_to_string(coalesce(new.certifications, '{}'), ' ') || ' ' ||
    array_to_string(coalesce(new.qualifications, '{}'), ' ') || ' ' ||
    array_to_string(coalesce(new.sectors, '{}'), ' ') || ' ' ||
    array_to_string(coalesce(new.languages, '{}'), ' ') || ' ' ||
    array_to_string(coalesce(new.resource_categories, '{}'), ' ');
  return new;
end;
$$;

create trigger candidates_search_text_trg
  before insert or update on public.candidates
  for each row execute function public.candidates_set_search_text();

create trigger job_requirements_set_updated_at
  before update on public.job_requirements
  for each row execute function public.set_updated_at();

create trigger tenders_set_updated_at
  before update on public.tenders
  for each row execute function public.set_updated_at();

create trigger positions_set_updated_at
  before update on public.positions
  for each row execute function public.set_updated_at();

create trigger oem_letters_set_updated_at
  before update on public.oem_letters
  for each row execute function public.set_updated_at();

create function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only admins can change a profile role';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_role_self_escalation
  before update on public.profiles
  for each row execute function public.prevent_role_self_escalation();

create function public.handle_placement_created()
returns trigger
language plpgsql
as $$
begin
  update public.candidates set status = 'placed' where id = new.candidate_id;
  return new;
end;
$$;

create trigger placements_mark_candidate_placed
  after insert on public.placements
  for each row execute function public.handle_placement_created();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.candidates enable row level security;
alter table public.job_requirements enable row level security;
alter table public.tenders enable row level security;
alter table public.matches enable row level security;
alter table public.match_alerts enable row level security;
alter table public.placements enable row level security;
alter table public.oem_letters enable row level security;
alter table public.positions enable row level security;
alter table public.assignments enable row level security;

-- profiles: all authenticated users can read; admins update any; users update own
-- (role changes are blocked by the prevent_role_self_escalation trigger).
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);
create policy "profiles_update_admin" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "profiles_update_self" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Business tables: shared CRUD for all authenticated users, delete = admin only.
create policy "candidates_select" on public.candidates for select to authenticated using (true);
create policy "candidates_insert" on public.candidates for insert to authenticated with check (true);
create policy "candidates_update" on public.candidates for update to authenticated using (true) with check (true);
create policy "candidates_delete" on public.candidates for delete to authenticated using (public.is_admin());

create policy "job_requirements_select" on public.job_requirements for select to authenticated using (true);
create policy "job_requirements_insert" on public.job_requirements for insert to authenticated with check (true);
create policy "job_requirements_update" on public.job_requirements for update to authenticated using (true) with check (true);
create policy "job_requirements_delete" on public.job_requirements for delete to authenticated using (public.is_admin());

create policy "tenders_select" on public.tenders for select to authenticated using (true);
create policy "tenders_insert" on public.tenders for insert to authenticated with check (true);
create policy "tenders_update" on public.tenders for update to authenticated using (true) with check (true);
create policy "tenders_delete" on public.tenders for delete to authenticated using (public.is_admin());

create policy "positions_select" on public.positions for select to authenticated using (true);
create policy "positions_insert" on public.positions for insert to authenticated with check (true);
create policy "positions_update" on public.positions for update to authenticated using (true) with check (true);
-- Positions are rewritten wholesale on every form save, so removing a line
-- must not require an admin.
create policy "positions_delete" on public.positions for delete to authenticated using (true);

create policy "assignments_select" on public.assignments for select to authenticated using (true);
create policy "assignments_insert" on public.assignments for insert to authenticated with check (true);
create policy "assignments_update" on public.assignments for update to authenticated using (true) with check (true);
-- Unassigning a seat is normal recruiter work, not an admin action.
create policy "assignments_delete" on public.assignments for delete to authenticated using (true);

create policy "oem_letters_select" on public.oem_letters for select to authenticated using (true);
create policy "oem_letters_insert" on public.oem_letters for insert to authenticated with check (true);
create policy "oem_letters_update" on public.oem_letters for update to authenticated using (true) with check (true);
create policy "oem_letters_delete" on public.oem_letters for delete to authenticated using (public.is_admin());

create policy "matches_select" on public.matches for select to authenticated using (true);
create policy "matches_insert" on public.matches for insert to authenticated with check (true);
create policy "matches_update" on public.matches for update to authenticated using (true) with check (true);
create policy "matches_delete" on public.matches for delete to authenticated using (public.is_admin());

create policy "match_alerts_select" on public.match_alerts for select to authenticated using (true);
create policy "match_alerts_insert" on public.match_alerts for insert to authenticated with check (true);
create policy "match_alerts_delete" on public.match_alerts for delete to authenticated using (public.is_admin());

create policy "placements_select" on public.placements for select to authenticated using (true);
create policy "placements_insert" on public.placements for insert to authenticated with check (true);
create policy "placements_update" on public.placements for update to authenticated using (true) with check (true);
create policy "placements_delete" on public.placements for delete to authenticated using (public.is_admin());

-- ============================================================================
-- Done. Next: create your first admin (Authentication → Users → Add user in
-- the dashboard), then run the snippet in supabase/bootstrap_admin.sql.
-- ============================================================================
