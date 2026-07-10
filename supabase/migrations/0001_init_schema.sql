create extension if not exists "pgcrypto";

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
  years_experience numeric,
  skills text[] not null default '{}',
  certifications text[] not null default '{}',
  qualifications text[] not null default '{}',
  sectors text[] not null default '{}',
  availability text not null default 'available' check (availability in ('available', 'notice_period', 'unavailable')),
  status text not null default 'active' check (status in ('active', 'inactive', 'placed')),
  location text,
  cv_file_path text,
  cv_original_filename text,
  notes text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenders (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  client text,
  location text,
  value numeric,
  submission_deadline date,
  contract_start_date date,
  required_roles text[] not null default '{}',
  required_skills text[] not null default '{}',
  required_certifications text[] not null default '{}',
  sectors text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'live', 'submitted', 'won', 'lost')),
  source_document_path text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  match_target_type text not null check (match_target_type in ('job_requirement', 'tender')),
  match_target_id uuid not null,
  score numeric not null,
  score_breakdown jsonb not null default '{}',
  ai_deep_match_notes text,
  alert_sent boolean not null default false,
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
  fee_value numeric not null,
  start_date date not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index candidates_status_idx on public.candidates (status);
create index candidates_availability_idx on public.candidates (availability);
create index candidates_skills_gin on public.candidates using gin (skills);
create index candidates_certifications_gin on public.candidates using gin (certifications);
create index candidates_qualifications_gin on public.candidates using gin (qualifications);
create index candidates_sectors_gin on public.candidates using gin (sectors);
create index candidates_email_idx on public.candidates (email);
create index candidates_phone_idx on public.candidates (phone);

create index job_requirements_status_idx on public.job_requirements (status);
create index job_requirements_skills_gin on public.job_requirements using gin (required_skills);
create index job_requirements_certifications_gin on public.job_requirements using gin (required_certifications);
create index job_requirements_sectors_gin on public.job_requirements using gin (sectors);

create index tenders_status_idx on public.tenders (status);
create index tenders_skills_gin on public.tenders using gin (required_skills);
create index tenders_roles_gin on public.tenders using gin (required_roles);
create index tenders_sectors_gin on public.tenders using gin (sectors);

create index matches_candidate_idx on public.matches (candidate_id);
create index matches_target_idx on public.matches (match_target_type, match_target_id);

create index match_alerts_match_idx on public.match_alerts (match_id);

create index placements_candidate_idx on public.placements (candidate_id);
create index placements_source_idx on public.placements (source_type, source_id);

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

create trigger job_requirements_set_updated_at
  before update on public.job_requirements
  for each row execute function public.set_updated_at();

create trigger tenders_set_updated_at
  before update on public.tenders
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
