-- An audit trail, and how long people actually use the system.
--
-- The activity table cannot do this job, and the reason is worth stating
-- plainly: deleteTender, deleteCandidate and the rest all call purgeActivity,
-- which removes an entity's whole timeline when the entity goes. So the one
-- question an audit trail exists to answer, "who deleted this and when", is
-- the exact question activity destroys the evidence for. That purge is right
-- for a timeline shown on a record, and fatal for an audit log.
--
-- Hence a separate table with different rules:
--
--   Append only     No update policy and NO DELETE POLICY AT ALL, not even for
--                   admins. A trail somebody can quietly edit is not a trail.
--   Self contained  actor_email and entity_label are copied in at write time,
--                   so a deleted tender still reads as its title and a removed
--                   user still reads as their address. A log full of dangling
--                   uuids answers nothing a year later.
--   Never scoped    by department. It records what happened across the whole
--                   business and is readable only by admins.
--
-- Sessions are separate again, because they answer a different question and
-- churn far more: one row per sign-in, kept fresh by a heartbeat from the
-- browser. Duration is last_seen_at minus started_at, which measures time with
-- the app open rather than time spent working in it. That distinction is real
-- and the screen says so rather than implying a precision it does not have.
--
-- Self-contained and idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- The trail
-- ---------------------------------------------------------------------------

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),

  -- Nullable and set null on delete: removing a user must not remove the
  -- record of what they did, which is the whole point.
  actor_id uuid references public.profiles (id) on delete set null,
  -- Copied at write time so the row still names somebody after that happens.
  actor_email text,
  actor_name text,

  -- created, updated, deleted, imported, signed_in, signed_out, role_changed,
  -- department_changed, placed, assigned, unassigned, extended, matched.
  -- Free text rather than a check constraint: a new action should not need a
  -- migration, and an unrecognised one is still readable.
  action text not null,

  -- What it happened to. entity_id has no foreign key, deliberately: the row it
  -- points at is usually gone by the time anybody reads this.
  entity_type text not null,
  entity_id uuid,
  -- The name it had when it happened. A deleted tender reads as its title
  -- rather than as a uuid nothing resolves.
  entity_label text,

  -- Anything else worth keeping: which fields changed, the file a row came
  -- from, the department it was filed under.
  detail jsonb not null default '{}',

  created_at timestamptz not null default now()
);

-- Read patterns: newest first overall, per actor, and per record.
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index if not exists audit_log_action_idx on public.audit_log (action);

alter table public.audit_log enable row level security;

-- Admins read it. Nobody else has any business reading who did what across
-- four departments.
drop policy if exists "audit_log_select" on public.audit_log;
create policy "audit_log_select" on public.audit_log
  for select to authenticated using ((select public.is_admin()));

-- Anybody signed in can write, because everybody's actions are recorded.
drop policy if exists "audit_log_insert" on public.audit_log;
create policy "audit_log_insert" on public.audit_log
  for insert to authenticated with check (true);

-- No update policy and no delete policy. Both omissions are the feature.
-- A trail that can be rewritten or tidied is not evidence of anything.
drop policy if exists "audit_log_update" on public.audit_log;
drop policy if exists "audit_log_delete" on public.audit_log;

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  -- Moved forward by the heartbeat. A session with no beat for a few minutes
  -- is over, and this is the moment it ended.
  last_seen_at timestamptz not null default now(),
  -- Set only on a deliberate sign-out. Most sessions just stop beating, which
  -- is why the screen reads last_seen_at rather than trusting this.
  ended_at timestamptz,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists user_sessions_user_idx
  on public.user_sessions (user_id, started_at desc);
create index if not exists user_sessions_started_idx
  on public.user_sessions (started_at desc);

alter table public.user_sessions enable row level security;

-- An admin sees everybody's; anybody else sees only their own, which is what
-- makes the heartbeat's update possible without handing out the whole table.
drop policy if exists "user_sessions_select" on public.user_sessions;
create policy "user_sessions_select" on public.user_sessions
  for select to authenticated
  using ((select public.is_admin()) or user_id = (select auth.uid()));

drop policy if exists "user_sessions_insert" on public.user_sessions;
create policy "user_sessions_insert" on public.user_sessions
  for insert to authenticated with check (user_id = (select auth.uid()));

-- Only your own, and only ever to move it forward.
drop policy if exists "user_sessions_update" on public.user_sessions;
create policy "user_sessions_update" on public.user_sessions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Deliberately no delete policy. Sessions are part of the record.
drop policy if exists "user_sessions_delete" on public.user_sessions;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------

-- Verify 1. Expect two rows.
select table_name as item, 'created' as type
from information_schema.tables
where table_schema = 'public' and table_name in ('audit_log', 'user_sessions')
order by table_name;

-- Verify 2. audit_log must have SELECT and INSERT and nothing else.
-- user_sessions must have SELECT, INSERT and UPDATE and nothing else.
-- An UPDATE or DELETE row on audit_log means the trail is editable.
select tablename || ' / ' || policyname as item, cmd as type
from pg_policies
where schemaname = 'public' and tablename in ('audit_log', 'user_sessions')
order by tablename, cmd;
