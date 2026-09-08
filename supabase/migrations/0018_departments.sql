-- Departments: four business units, their own tenders, their own managers.
--
-- TiPP Focus is split into Tipp Consulting, Tipp Resourcing, Tipp Human Capital
-- and Tipp Construction. Each runs its own bids under its own manager, and the
-- system had no concept of any of it: every policy in this schema was
-- using (true), so a recruiter in one department could read, edit and re-price
-- every bid in the other three.
--
-- What is scoped and what is not, decided deliberately:
--
--   Scoped     tenders, job_requirements, and everything hanging off them:
--              positions, assignments, matches, match_alerts, placements, and
--              the activity timelines of the two parents.
--   Shared     candidates, oem_letters, reference_letters. The pool is company
--              wide because seat coverage answers "can TiPP Focus staff this
--              bid", not "can this department". The letters are compliance
--              assets the company earned, and hiding one from a department that
--              needs it to pass loses a bid for no reason.
--
-- RUN THIS ONLY ALONGSIDE THE APP CODE THAT SETS department_id. tenders and
-- job_requirements become NOT NULL with no default, deliberately: a default
-- would file bids into a department nobody chose, which is the silent failure
-- this whole change exists to prevent. Until the matching app code ships,
-- creating a tender will fail loudly.
--
-- Self-contained and idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- The departments
-- ---------------------------------------------------------------------------

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  -- Renameable, and shown everywhere.
  name text not null,
  -- Immutable handle. Seeds, imports and any future migration key off this, so
  -- renaming a department on screen never breaks a reference to it.
  slug text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists departments_slug_key on public.departments (slug);
-- Case and whitespace insensitive, so "Tipp Consulting" and "tipp  consulting"
-- cannot both exist and split a department's bids between them.
create unique index if not exists departments_name_key
  on public.departments (lower(btrim(name)));

-- on conflict (slug) is what makes a re-run safe and, just as importantly,
-- stops a re-run resurrecting the original name after somebody has renamed one.
insert into public.departments (slug, name, sort_order) values
  ('consulting', 'Tipp Consulting', 1),
  ('resourcing', 'Tipp Resourcing', 2),
  ('human-capital', 'Tipp Human Capital', 3),
  ('construction', 'Tipp Construction', 4)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- The columns
-- ---------------------------------------------------------------------------

-- Nullable on purpose. An admin works across all four and needs none, and
-- is_admin() short-circuits every predicate below. A non-admin with no
-- department sees nothing, which is the right way for this to fail.
alter table public.profiles
  add column if not exists department_id uuid references public.departments (id) on delete restrict;

-- restrict, not set null: a department with live bids must not be deletable,
-- and a tender with no department would be invisible to every manager and
-- reachable only by an admin who thought to look for it.
alter table public.tenders
  add column if not exists department_id uuid references public.departments (id) on delete restrict;

alter table public.job_requirements
  add column if not exists department_id uuid references public.departments (id) on delete restrict;

-- Backfill from the creator where one is known, then floor anything left, then
-- constrain. All three are no-ops on an empty table, which is why this is being
-- done now: after the register is imported, every null here is a bid somebody
-- has to guess the owner of, and every wrong guess hides it from its own team.
update public.tenders t set department_id = p.department_id
from public.profiles p
where t.department_id is null and t.created_by = p.id and p.department_id is not null;

update public.job_requirements r set department_id = p.department_id
from public.profiles p
where r.department_id is null and r.created_by = p.id and p.department_id is not null;

update public.tenders
set department_id = (select id from public.departments order by sort_order limit 1)
where department_id is null;

update public.job_requirements
set department_id = (select id from public.departments order by sort_order limit 1)
where department_id is null;

alter table public.tenders alter column department_id set not null;
alter table public.job_requirements alter column department_id set not null;

comment on column public.tenders.department_id is
  'The business unit that owns this bid. Decides who can see it.';

create index if not exists tenders_department_idx on public.tenders (department_id);
create index if not exists job_requirements_department_idx
  on public.job_requirements (department_id);
create index if not exists profiles_department_idx on public.profiles (department_id);

-- ---------------------------------------------------------------------------
-- The manager role
-- ---------------------------------------------------------------------------

-- A third tier, so a department head can delete their own department's bids
-- without being made a global admin, which would hand them all four. The check
-- is mirrored by ProfileRole in src/lib/supabase/database.types.ts; change both
-- or they disagree and the form offers a value the database refuses.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'manager', 'user'));

-- ---------------------------------------------------------------------------
-- Helpers
--
-- All security definer, matching public.is_admin() in 0001. This is load
-- bearing rather than decorative: a policy expression runs with the querying
-- user's privileges, so a plain function reading profiles from inside a policy
-- on profiles re-enters that policy and recurses until the stack gives out.
-- Definer runs the body as the owner, whose RLS is bypassed, which cuts the
-- loop. The same reasoning applies to the parent lookups below, which read
-- tenders from inside the policies of tables that point at tenders.
--
-- Kept at the top level. A $$-quoted function body nested inside a
-- do $$ ... end $$ block terminates the outer block and corrupts the parse,
-- and the SQL Editor runs this file as a single batch.
--
-- Parameters are p_-prefixed so they cannot shadow a column name inside the
-- body, which in a SQL function is silent and returns the wrong rows.
-- ---------------------------------------------------------------------------

create or replace function public.current_department_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select department_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_manager()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'manager')
  );
$$;

-- Resolves a polymorphic parent to its department. Returns null for a dangling
-- parent, so an orphaned row is invisible rather than visible to everybody.
create or replace function public.parent_department_id(p_type text, p_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select case p_type
    when 'tender' then (select t.department_id from public.tenders t where t.id = p_id)
    when 'job_requirement' then (select r.department_id from public.job_requirements r where r.id = p_id)
  end;
$$;

create or replace function public.position_department_id(p_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select public.parent_department_id(p.parent_type, p.parent_id)
  from public.positions p
  where p.id = p_id;
$$;

-- Deliberately unscoped, and the narrowest thing that can be.
--
-- The candidate pool is shared, so "is this person free on the contract start
-- date" has to be answerable across the whole business. Placements themselves
-- are scoped, because they name a project and a client. This returns three
-- columns and nothing else: who, from when, until when. Without it, the seat
-- coverage panel would report a candidate already contracted to another
-- department as free, and invite a double booking in the one feature the
-- shared pool exists to protect.
create or replace function public.candidate_commitments()
returns table (candidate_id uuid, start_date date, end_date date)
language sql
security definer
set search_path = public
stable
as $$
  select pl.candidate_id, pl.start_date, pl.end_date from public.placements pl;
$$;

grant execute on function public.candidate_commitments() to authenticated;

-- ---------------------------------------------------------------------------
-- Self-escalation
--
-- profiles_update_self in 0002 lets any signed-in user update any column of
-- their own row. role was guarded by this trigger; department_id now decides
-- what a person can see, which makes it exactly as much of a privilege grant,
-- and without this a manager could move themselves into another department and
-- walk into its bids.
--
-- The auth.uid() is not null exemption matters too. A service-role JWT carries
-- no sub claim, so auth.uid() is null and is_admin() reads false, and without
-- the exemption the admin client cannot write either column at all. That path
-- is already trusted with everything; this check only ever existed to close the
-- signed-in self-update route, which always carries a uid.
--
-- Replaced in place, so the existing trigger binding from 0001 still holds.
-- ---------------------------------------------------------------------------

create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role
      or new.department_id is distinct from old.department_id)
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'Only admins can change a profile role or department';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Policies
--
-- The zero-argument helpers are wrapped in (select ...) so the planner hoists
-- them into an InitPlan and evaluates them once per statement rather than once
-- per row. On matches, which is read whole-table by analytics, that is the
-- difference between an index scan and a scan with a function call per row.
-- ---------------------------------------------------------------------------

alter table public.departments enable row level security;

drop policy if exists "departments_select" on public.departments;
create policy "departments_select" on public.departments
  for select to authenticated using (true);

drop policy if exists "departments_insert" on public.departments;
create policy "departments_insert" on public.departments
  for insert to authenticated with check ((select public.is_admin()));

drop policy if exists "departments_update" on public.departments;
create policy "departments_update" on public.departments
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "departments_delete" on public.departments;
create policy "departments_delete" on public.departments
  for delete to authenticated using ((select public.is_admin()));

-- tenders. with check is what enforces the rule in the database rather than in
-- the form: a manager cannot file a bid under another department whatever the
-- client posts. using gates the old row and with check the new one, and both
-- are needed on update, or a manager could move one of their own tenders out
-- of their department and lose sight of it.
drop policy if exists "tenders_select" on public.tenders;
create policy "tenders_select" on public.tenders
  for select to authenticated
  using ((select public.is_admin()) or department_id = (select public.current_department_id()));

drop policy if exists "tenders_insert" on public.tenders;
create policy "tenders_insert" on public.tenders
  for insert to authenticated
  with check ((select public.is_admin()) or department_id = (select public.current_department_id()));

drop policy if exists "tenders_update" on public.tenders;
create policy "tenders_update" on public.tenders
  for update to authenticated
  using ((select public.is_admin()) or department_id = (select public.current_department_id()))
  with check ((select public.is_admin()) or department_id = (select public.current_department_id()));

-- A manager deletes within their own department. Anybody else needs an admin,
-- which is the whole reason the manager tier exists: the alternative was making
-- a department head a global admin, handing them all four.
drop policy if exists "tenders_delete" on public.tenders;
create policy "tenders_delete" on public.tenders
  for delete to authenticated
  using ((select public.is_admin())
         or ((select public.is_manager())
             and department_id = (select public.current_department_id())));

-- job_requirements, identically.
drop policy if exists "job_requirements_select" on public.job_requirements;
create policy "job_requirements_select" on public.job_requirements
  for select to authenticated
  using ((select public.is_admin()) or department_id = (select public.current_department_id()));

drop policy if exists "job_requirements_insert" on public.job_requirements;
create policy "job_requirements_insert" on public.job_requirements
  for insert to authenticated
  with check ((select public.is_admin()) or department_id = (select public.current_department_id()));

drop policy if exists "job_requirements_update" on public.job_requirements;
create policy "job_requirements_update" on public.job_requirements
  for update to authenticated
  using ((select public.is_admin()) or department_id = (select public.current_department_id()))
  with check ((select public.is_admin()) or department_id = (select public.current_department_id()));

drop policy if exists "job_requirements_delete" on public.job_requirements;
create policy "job_requirements_delete" on public.job_requirements
  for delete to authenticated
  using ((select public.is_admin())
         or ((select public.is_manager())
             and department_id = (select public.current_department_id())));

-- positions. Scoped through the polymorphic parent. DELETE stays open to any
-- authenticated user within the department, as 0012 made it deliberately:
-- replacePositions rewrites the whole set on every form save, so deleting a
-- seat is ordinary work rather than an admin action.
drop policy if exists "positions_select" on public.positions;
create policy "positions_select" on public.positions
  for select to authenticated
  using ((select public.is_admin())
         or public.parent_department_id(parent_type, parent_id)
            = (select public.current_department_id()));

drop policy if exists "positions_insert" on public.positions;
create policy "positions_insert" on public.positions
  for insert to authenticated
  with check ((select public.is_admin())
              or public.parent_department_id(parent_type, parent_id)
                 = (select public.current_department_id()));

drop policy if exists "positions_update" on public.positions;
create policy "positions_update" on public.positions
  for update to authenticated
  using ((select public.is_admin())
         or public.parent_department_id(parent_type, parent_id)
            = (select public.current_department_id()))
  with check ((select public.is_admin())
              or public.parent_department_id(parent_type, parent_id)
                 = (select public.current_department_id()));

drop policy if exists "positions_delete" on public.positions;
create policy "positions_delete" on public.positions
  for delete to authenticated
  using ((select public.is_admin())
         or public.parent_department_id(parent_type, parent_id)
            = (select public.current_department_id()));

-- assignments. One hop through position_id, which is a real foreign key.
-- Delete stays non-admin, as 0012 set it: unassigning a seat is recruiter work.
drop policy if exists "assignments_select" on public.assignments;
create policy "assignments_select" on public.assignments
  for select to authenticated
  using ((select public.is_admin())
         or public.position_department_id(position_id) = (select public.current_department_id()));

drop policy if exists "assignments_insert" on public.assignments;
create policy "assignments_insert" on public.assignments
  for insert to authenticated
  with check ((select public.is_admin())
              or public.position_department_id(position_id) = (select public.current_department_id()));

drop policy if exists "assignments_update" on public.assignments;
create policy "assignments_update" on public.assignments
  for update to authenticated
  using ((select public.is_admin())
         or public.position_department_id(position_id) = (select public.current_department_id()))
  with check ((select public.is_admin())
              or public.position_department_id(position_id) = (select public.current_department_id()));

drop policy if exists "assignments_delete" on public.assignments;
create policy "assignments_delete" on public.assignments
  for delete to authenticated
  using ((select public.is_admin())
         or public.position_department_id(position_id) = (select public.current_department_id()));

-- placements. Scoped, because a placement names a project and a client. The
-- dates alone stay company wide through candidate_commitments() above.
drop policy if exists "placements_select" on public.placements;
create policy "placements_select" on public.placements
  for select to authenticated
  using ((select public.is_admin())
         or public.parent_department_id(source_type, source_id)
            = (select public.current_department_id()));

drop policy if exists "placements_insert" on public.placements;
create policy "placements_insert" on public.placements
  for insert to authenticated
  with check ((select public.is_admin())
              or public.parent_department_id(source_type, source_id)
                 = (select public.current_department_id()));

drop policy if exists "placements_update" on public.placements;
create policy "placements_update" on public.placements
  for update to authenticated
  using ((select public.is_admin())
         or public.parent_department_id(source_type, source_id)
            = (select public.current_department_id()))
  with check ((select public.is_admin())
              or public.parent_department_id(source_type, source_id)
                 = (select public.current_department_id()));

drop policy if exists "placements_delete" on public.placements;
create policy "placements_delete" on public.placements
  for delete to authenticated using ((select public.is_admin()));

-- matches. Three target types. Only 'position' has been written since 0012,
-- but the older branches still have to resolve, or a legacy row becomes
-- invisible and therefore undeletable.
drop policy if exists "matches_select" on public.matches;
create policy "matches_select" on public.matches
  for select to authenticated
  using (
    (select public.is_admin())
    or (case
          when match_target_type = 'position' then public.position_department_id(match_target_id)
          else public.parent_department_id(match_target_type, match_target_id)
        end) = (select public.current_department_id())
  );

drop policy if exists "matches_insert" on public.matches;
create policy "matches_insert" on public.matches
  for insert to authenticated
  with check (
    (select public.is_admin())
    or (case
          when match_target_type = 'position' then public.position_department_id(match_target_id)
          else public.parent_department_id(match_target_type, match_target_id)
        end) = (select public.current_department_id())
  );

-- Matching upserts, so update has to carry the same predicate as insert.
drop policy if exists "matches_update" on public.matches;
create policy "matches_update" on public.matches
  for update to authenticated
  using (
    (select public.is_admin())
    or (case
          when match_target_type = 'position' then public.position_department_id(match_target_id)
          else public.parent_department_id(match_target_type, match_target_id)
        end) = (select public.current_department_id())
  )
  with check (
    (select public.is_admin())
    or (case
          when match_target_type = 'position' then public.position_department_id(match_target_id)
          else public.parent_department_id(match_target_type, match_target_id)
        end) = (select public.current_department_id())
  );

drop policy if exists "matches_delete" on public.matches;
create policy "matches_delete" on public.matches
  for delete to authenticated using ((select public.is_admin()));

-- match_alerts. Delegated through the match, which has a real foreign key here,
-- so nested RLS is the honest expression of "visible if its match is visible".
drop policy if exists "match_alerts_select" on public.match_alerts;
create policy "match_alerts_select" on public.match_alerts
  for select to authenticated
  using ((select public.is_admin())
         or exists (select 1 from public.matches m where m.id = match_alerts.match_id));

drop policy if exists "match_alerts_insert" on public.match_alerts;
create policy "match_alerts_insert" on public.match_alerts
  for insert to authenticated
  with check ((select public.is_admin())
              or exists (select 1 from public.matches m where m.id = match_alerts.match_id));

drop policy if exists "match_alerts_delete" on public.match_alerts;
create policy "match_alerts_delete" on public.match_alerts
  for delete to authenticated using ((select public.is_admin()));

-- activity. Candidate and OEM letter timelines stay shared, matching the tables
-- they describe. Still no update policy, so the trail stays immutable.
drop policy if exists "activity_select" on public.activity;
create policy "activity_select" on public.activity
  for select to authenticated
  using (
    (select public.is_admin())
    or entity_type in ('candidate', 'oem_letter')
    or public.parent_department_id(entity_type, entity_id) = (select public.current_department_id())
  );

drop policy if exists "activity_insert" on public.activity;
create policy "activity_insert" on public.activity
  for insert to authenticated
  with check (
    (select public.is_admin())
    or entity_type in ('candidate', 'oem_letter')
    or public.parent_department_id(entity_type, entity_id) = (select public.current_department_id())
  );

drop policy if exists "activity_delete" on public.activity;
create policy "activity_delete" on public.activity
  for delete to authenticated
  using (
    (select public.is_admin())
    or (kind = 'note' and actor_id = (select auth.uid())
        and (entity_type in ('candidate', 'oem_letter')
             or public.parent_department_id(entity_type, entity_id)
                = (select public.current_department_id())))
  );

-- ---------------------------------------------------------------------------
-- Verify
--
-- Aliased item and type, never check, which is reserved and aborts the batch
-- silently. Note that counting rows here proves nothing about the policies:
-- the SQL Editor runs as postgres, which bypasses RLS. Real proof is
-- supabase/rls_department_check.sql, which impersonates a user.
-- ---------------------------------------------------------------------------

-- Verify 1. Expect four rows, in order.
select slug as item, name as type from public.departments order by sort_order;

-- Verify 2. Expect two rows, both NO.
select table_name || '.' || column_name as item, is_nullable as type
from information_schema.columns
where table_schema = 'public'
  and column_name = 'department_id'
  and table_name in ('tenders', 'job_requirements')
order by table_name;

-- Verify 3. Expect five rows, every one true. A false here means the function
-- was created without security definer, and every policy that calls it will
-- either recurse or quietly return nothing.
select p.proname as item, p.prosecdef::text as type
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('current_department_id', 'is_manager', 'parent_department_id',
                    'position_department_id', 'candidate_commitments')
order by p.proname;

-- Verify 4. Expect 'admin', 'manager', 'user' in the role constraint.
select conname as item, pg_get_constraintdef(oid) as type
from pg_constraint where conname = 'profiles_role_check';

-- Verify 5. The full policy set, one row per command per table.
select tablename || ' / ' || policyname as item, cmd as type
from pg_policies
where schemaname = 'public'
  and tablename in ('departments', 'tenders', 'job_requirements', 'positions',
                    'assignments', 'matches', 'match_alerts', 'placements', 'activity')
order by tablename, policyname;
