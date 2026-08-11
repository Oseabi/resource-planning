-- ============================================================================
-- Diagnose and repair the row level security policies on public.assignments.
--
-- Paste this whole file into the Supabase dashboard SQL Editor and click "Run".
--
-- Why: removing someone from a seat silently does nothing. The server sends the
-- delete, Postgres reports no error, and zero rows are removed:
--
--   { positionId: "1c06fd21...", candidateId: "df0cdd97...",
--     removed: [], error: null }
--
-- while the same row is plainly visible to SELECT on the page. RLS is enabled on
-- the table, so when no DELETE policy grants the row, the delete matches nothing
-- and reports success. That is standard Postgres behaviour, not a failure it can
-- warn about, which is why this went unnoticed.
--
-- Migration 0012 does create an assignments_delete policy, so the most likely
-- cause is that the 0012 run stopped partway, after "alter table ... enable row
-- level security" but before the policies at the end. The result is a table with
-- RLS on and no policies, which denies everything silently.
--
-- Self-contained and idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Before. Note which of select/insert/update/delete are listed.
-- A missing "delete" row here confirms the diagnosis above.
-- ---------------------------------------------------------------------------
select 'before' as stage, cmd, policyname
from pg_policies
where schemaname = 'public' and tablename = 'assignments'
order by cmd;

-- ---------------------------------------------------------------------------
-- Repair. Identical to the block at the end of migration 0012, restated here so
-- this file stands alone and so re-running 0012 in full is not required.
--
-- Assignments carry no ownership of their own: who may touch one is decided by
-- the bid or requirement it hangs off, and every signed-in user can already see
-- and edit those. So these stay open to any authenticated user, matching
-- positions. Deleting the parent record is the admin-only action, and that is
-- guarded on the parent tables.
-- ---------------------------------------------------------------------------
alter table public.assignments enable row level security;

drop policy if exists "assignments_select" on public.assignments;
create policy "assignments_select" on public.assignments
  for select to authenticated using (true);

drop policy if exists "assignments_insert" on public.assignments;
create policy "assignments_insert" on public.assignments
  for insert to authenticated with check (true);

drop policy if exists "assignments_update" on public.assignments;
create policy "assignments_update" on public.assignments
  for update to authenticated using (true) with check (true);

drop policy if exists "assignments_delete" on public.assignments;
create policy "assignments_delete" on public.assignments
  for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Positions are rewritten wholesale whenever a requirement or tender form is
-- saved, so removing a line must not need an admin. Restated for the same
-- reason: if 0012 stopped early, these are missing too, and the symptom is a
-- role you delete on the edit form quietly coming back.
-- ---------------------------------------------------------------------------
alter table public.positions enable row level security;

drop policy if exists "positions_select" on public.positions;
create policy "positions_select" on public.positions
  for select to authenticated using (true);

drop policy if exists "positions_insert" on public.positions;
create policy "positions_insert" on public.positions
  for insert to authenticated with check (true);

drop policy if exists "positions_update" on public.positions;
create policy "positions_update" on public.positions
  for update to authenticated using (true) with check (true);

drop policy if exists "positions_delete" on public.positions;
create policy "positions_delete" on public.positions
  for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- After. Both tables should now list exactly four rows each:
-- DELETE, INSERT, SELECT, UPDATE.
-- ---------------------------------------------------------------------------
select 'after' as stage, tablename, cmd, policyname
from pg_policies
where schemaname = 'public' and tablename in ('assignments', 'positions')
order by tablename, cmd;
