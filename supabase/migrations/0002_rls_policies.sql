alter table public.profiles enable row level security;
alter table public.candidates enable row level security;
alter table public.job_requirements enable row level security;
alter table public.tenders enable row level security;
alter table public.matches enable row level security;
alter table public.match_alerts enable row level security;
alter table public.placements enable row level security;

-- profiles: everyone authenticated can read all profiles (needed for name lookups,
-- "created_by" display, and the admin Users & Roles table). Admins can update any
-- profile; a user may update their own row (role changes are blocked by the
-- prevent_role_self_escalation trigger regardless of who issues the update).
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);

create policy "profiles_update_admin" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "profiles_update_self" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- candidates / job_requirements / tenders / matches / match_alerts / placements:
-- shared CRUD for all authenticated users, delete restricted to admins.
create policy "candidates_select" on public.candidates
  for select to authenticated using (true);
create policy "candidates_insert" on public.candidates
  for insert to authenticated with check (true);
create policy "candidates_update" on public.candidates
  for update to authenticated using (true) with check (true);
create policy "candidates_delete" on public.candidates
  for delete to authenticated using (public.is_admin());

create policy "job_requirements_select" on public.job_requirements
  for select to authenticated using (true);
create policy "job_requirements_insert" on public.job_requirements
  for insert to authenticated with check (true);
create policy "job_requirements_update" on public.job_requirements
  for update to authenticated using (true) with check (true);
create policy "job_requirements_delete" on public.job_requirements
  for delete to authenticated using (public.is_admin());

create policy "tenders_select" on public.tenders
  for select to authenticated using (true);
create policy "tenders_insert" on public.tenders
  for insert to authenticated with check (true);
create policy "tenders_update" on public.tenders
  for update to authenticated using (true) with check (true);
create policy "tenders_delete" on public.tenders
  for delete to authenticated using (public.is_admin());

create policy "matches_select" on public.matches
  for select to authenticated using (true);
create policy "matches_insert" on public.matches
  for insert to authenticated with check (true);
create policy "matches_update" on public.matches
  for update to authenticated using (true) with check (true);
create policy "matches_delete" on public.matches
  for delete to authenticated using (public.is_admin());

create policy "match_alerts_select" on public.match_alerts
  for select to authenticated using (true);
create policy "match_alerts_insert" on public.match_alerts
  for insert to authenticated with check (true);
create policy "match_alerts_delete" on public.match_alerts
  for delete to authenticated using (public.is_admin());

create policy "placements_select" on public.placements
  for select to authenticated using (true);
create policy "placements_insert" on public.placements
  for insert to authenticated with check (true);
create policy "placements_update" on public.placements
  for update to authenticated using (true) with check (true);
create policy "placements_delete" on public.placements
  for delete to authenticated using (public.is_admin());
