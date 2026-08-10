-- Multi-role positions.
--
-- A job requirement modelled exactly one role, and a tender held a flat list of
-- role NAMES sharing one skill set, one cert list and one experience figure. A
-- tender asking for 3 business analysts at 3 years and a lead at 5 could not be
-- expressed, and there was no notion of a seat or of how much of a team was
-- covered.
--
-- Each requirement/tender now owns N positions, each with its own role,
-- quantity, experience floor, skills and certifications. Candidates are matched
-- per position and assigned to individual seats.
--
-- Self-contained and idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- positions
-- ---------------------------------------------------------------------------
create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  -- Polymorphic parent, matching the existing matches/placements convention.
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

create index if not exists positions_parent_idx on public.positions (parent_type, parent_id);
create index if not exists positions_role_idx on public.positions (role);

drop trigger if exists positions_set_updated_at on public.positions;
create trigger positions_set_updated_at
  before update on public.positions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- assignments, seat allocation
--
-- Deliberately separate from placements: a tender team is PROPOSED while the
-- bid is open, and must not inflate revenue or mark anyone unavailable. Only a
-- won tender (or a job requirement, which is a real vacancy) creates a
-- placement.
-- ---------------------------------------------------------------------------
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.positions (id) on delete cascade,
  candidate_id uuid not null references public.candidates (id) on delete cascade,
  status text not null default 'proposed' check (status in ('proposed', 'placed')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (position_id, candidate_id)
);

create index if not exists assignments_position_idx on public.assignments (position_id);
create index if not exists assignments_candidate_idx on public.assignments (candidate_id);

-- ---------------------------------------------------------------------------
-- matches: allow a position as a match target
--
-- match_target_id becomes the position id. The existing unique index
-- matches_target_candidate_uidx (candidate_id, match_target_type,
-- match_target_id) already keys this correctly, so the upsert conflict target
-- in the app needs no change.
-- ---------------------------------------------------------------------------
alter table public.matches
  drop constraint if exists matches_match_target_type_check;
alter table public.matches
  add constraint matches_match_target_type_check
    check (match_target_type in ('job_requirement', 'tender', 'position'));

-- ---------------------------------------------------------------------------
-- placements: record which seat was filled
-- ---------------------------------------------------------------------------
alter table public.placements
  add column if not exists position_id uuid references public.positions (id) on delete set null;

create index if not exists placements_position_idx on public.placements (position_id);

-- ---------------------------------------------------------------------------
-- Backfill, every existing requirement and tender must keep working
-- ---------------------------------------------------------------------------

-- One position per job requirement, from its single role.
insert into public.positions (
  parent_type, parent_id, role, quantity, min_experience_years,
  required_skills, required_certifications, required_availability, sort_order
)
select
  'job_requirement',
  r.id,
  coalesce(nullif(btrim(r.required_role), ''), 'Unspecified role'),
  1,
  r.min_experience_years,
  r.required_skills,
  r.required_certifications,
  r.required_availability,
  0
from public.job_requirements r
where not exists (
  select 1 from public.positions p
  where p.parent_type = 'job_requirement' and p.parent_id = r.id
);

-- One position per named role on a tender; the tender-level skills, certs and
-- experience floor seed every line, to be refined per position afterwards.
insert into public.positions (
  parent_type, parent_id, role, quantity, min_experience_years,
  required_skills, required_certifications, sort_order
)
select
  'tender',
  t.id,
  r.role,
  1,
  t.min_experience_years,
  t.required_skills,
  t.required_certifications,
  (r.ord - 1)::int
from public.tenders t
cross join lateral unnest(t.required_roles) with ordinality as r(role, ord)
where not exists (
  select 1 from public.positions p
  where p.parent_type = 'tender' and p.parent_id = t.id
);

-- A tender that named no roles still carries requirements; give it one line so
-- nothing is silently lost.
insert into public.positions (
  parent_type, parent_id, role, quantity, min_experience_years,
  required_skills, required_certifications, sort_order
)
select
  'tender',
  t.id,
  'Unspecified role',
  1,
  t.min_experience_years,
  t.required_skills,
  t.required_certifications,
  0
from public.tenders t
where coalesce(array_length(t.required_roles, 1), 0) = 0
  and not exists (
    select 1 from public.positions p
    where p.parent_type = 'tender' and p.parent_id = t.id
  );

-- Point existing placements at their parent's first position, so historical
-- fills show against a seat rather than appearing unassigned.
update public.placements pl
set position_id = p.id
from public.positions p
where pl.position_id is null
  and p.parent_type = pl.source_type
  and p.parent_id = pl.source_id
  and p.sort_order = 0;

-- Mirror those placements into assignments so fill counts include history.
insert into public.assignments (position_id, candidate_id, status, created_by, created_at)
select pl.position_id, pl.candidate_id, 'placed', pl.created_by, pl.created_at
from public.placements pl
where pl.position_id is not null
on conflict (position_id, candidate_id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS, shared CRUD for authenticated users, delete restricted to admins
-- ---------------------------------------------------------------------------
alter table public.positions enable row level security;
alter table public.assignments enable row level security;

drop policy if exists "positions_select" on public.positions;
create policy "positions_select" on public.positions
  for select to authenticated using (true);
drop policy if exists "positions_insert" on public.positions;
create policy "positions_insert" on public.positions
  for insert to authenticated with check (true);
drop policy if exists "positions_update" on public.positions;
create policy "positions_update" on public.positions
  for update to authenticated using (true) with check (true);
-- Positions are rewritten wholesale when a requirement/tender form is saved, so
-- deleting a line must not require an admin.
drop policy if exists "positions_delete" on public.positions;
create policy "positions_delete" on public.positions
  for delete to authenticated using (true);

drop policy if exists "assignments_select" on public.assignments;
create policy "assignments_select" on public.assignments
  for select to authenticated using (true);
drop policy if exists "assignments_insert" on public.assignments;
create policy "assignments_insert" on public.assignments
  for insert to authenticated with check (true);
drop policy if exists "assignments_update" on public.assignments;
create policy "assignments_update" on public.assignments
  for update to authenticated using (true) with check (true);
-- Unassigning a seat is normal recruiter work, not an admin action.
drop policy if exists "assignments_delete" on public.assignments;
create policy "assignments_delete" on public.assignments
  for delete to authenticated using (true);
