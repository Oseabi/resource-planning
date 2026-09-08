-- Undo the department scoping from 0018, policies only.
--
-- Restores the permissive policies from 0002, 0012 and 0014, putting every
-- table back to "any authenticated user reads and writes, admins delete".
--
-- It deliberately does NOT touch columns, the departments table, or the helper
-- functions. Those are additive and cost nothing sitting unused, and dropping
-- them would throw away the department every tender has been assigned. If the
-- scoping is ever turned back on, the data is still there and correct.
--
-- The one genuinely irreversible thing 0018 did is the NOT NULL on
-- tenders.department_id and job_requirements.department_id. If the app code has
-- been reverted too and inserts no longer supply it, also run:
--
--   alter table public.tenders alter column department_id drop not null;
--   alter table public.job_requirements alter column department_id drop not null;
--
-- Self-contained and idempotent: safe to re-run.

-- The self-escalation trigger keeps guarding department_id. Reverting that part
-- would be a security regression, not a rollback, so it is left alone.

drop policy if exists "tenders_select" on public.tenders;
create policy "tenders_select" on public.tenders
  for select to authenticated using (true);
drop policy if exists "tenders_insert" on public.tenders;
create policy "tenders_insert" on public.tenders
  for insert to authenticated with check (true);
drop policy if exists "tenders_update" on public.tenders;
create policy "tenders_update" on public.tenders
  for update to authenticated using (true) with check (true);
drop policy if exists "tenders_delete" on public.tenders;
create policy "tenders_delete" on public.tenders
  for delete to authenticated using (public.is_admin());

drop policy if exists "job_requirements_select" on public.job_requirements;
create policy "job_requirements_select" on public.job_requirements
  for select to authenticated using (true);
drop policy if exists "job_requirements_insert" on public.job_requirements;
create policy "job_requirements_insert" on public.job_requirements
  for insert to authenticated with check (true);
drop policy if exists "job_requirements_update" on public.job_requirements;
create policy "job_requirements_update" on public.job_requirements
  for update to authenticated using (true) with check (true);
drop policy if exists "job_requirements_delete" on public.job_requirements;
create policy "job_requirements_delete" on public.job_requirements
  for delete to authenticated using (public.is_admin());

-- positions and assignments: all four commands open, as 0012 set them.
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

drop policy if exists "placements_select" on public.placements;
create policy "placements_select" on public.placements
  for select to authenticated using (true);
drop policy if exists "placements_insert" on public.placements;
create policy "placements_insert" on public.placements
  for insert to authenticated with check (true);
drop policy if exists "placements_update" on public.placements;
create policy "placements_update" on public.placements
  for update to authenticated using (true) with check (true);
drop policy if exists "placements_delete" on public.placements;
create policy "placements_delete" on public.placements
  for delete to authenticated using (public.is_admin());

drop policy if exists "matches_select" on public.matches;
create policy "matches_select" on public.matches
  for select to authenticated using (true);
drop policy if exists "matches_insert" on public.matches;
create policy "matches_insert" on public.matches
  for insert to authenticated with check (true);
drop policy if exists "matches_update" on public.matches;
create policy "matches_update" on public.matches
  for update to authenticated using (true) with check (true);
drop policy if exists "matches_delete" on public.matches;
create policy "matches_delete" on public.matches
  for delete to authenticated using (public.is_admin());

drop policy if exists "match_alerts_select" on public.match_alerts;
create policy "match_alerts_select" on public.match_alerts
  for select to authenticated using (true);
drop policy if exists "match_alerts_insert" on public.match_alerts;
create policy "match_alerts_insert" on public.match_alerts
  for insert to authenticated with check (true);
drop policy if exists "match_alerts_delete" on public.match_alerts;
create policy "match_alerts_delete" on public.match_alerts
  for delete to authenticated using (public.is_admin());

-- activity: still no update policy, so the trail stays immutable either way.
drop policy if exists "activity_select" on public.activity;
create policy "activity_select" on public.activity
  for select to authenticated using (true);
drop policy if exists "activity_insert" on public.activity;
create policy "activity_insert" on public.activity
  for insert to authenticated with check (true);
drop policy if exists "activity_delete" on public.activity;
create policy "activity_delete" on public.activity
  for delete to authenticated
  using (public.is_admin() or (kind = 'note' and actor_id = auth.uid()));

-- Verify. Expect every row to read 'open' except the deletes.
select tablename || ' / ' || policyname as item, cmd as type
from pg_policies
where schemaname = 'public'
  and tablename in ('tenders', 'job_requirements', 'positions', 'assignments',
                    'matches', 'match_alerts', 'placements', 'activity')
order by tablename, policyname;
