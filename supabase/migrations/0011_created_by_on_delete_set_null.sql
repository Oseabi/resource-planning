-- Allow an admin to delete a user account.
--
-- profiles.id cascades from auth.users, but every created_by column referenced
-- profiles(id) with no delete rule (NO ACTION). Deleting anyone who had ever
-- created a candidate, requirement, tender, OEM letter or placement would fail
-- on a foreign-key violation.
--
-- The records themselves must survive, they are the business history. Only the
-- attribution is cleared, and the app already renders a null created_by as
-- "Unattributed" (see the analytics recruiter leaderboard).
--
-- Self-contained and idempotent: safe to re-run.

alter table public.candidates
  drop constraint if exists candidates_created_by_fkey,
  add constraint candidates_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.job_requirements
  drop constraint if exists job_requirements_created_by_fkey,
  add constraint job_requirements_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.tenders
  drop constraint if exists tenders_created_by_fkey,
  add constraint tenders_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.oem_letters
  drop constraint if exists oem_letters_created_by_fkey,
  add constraint oem_letters_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.placements
  drop constraint if exists placements_created_by_fkey,
  add constraint placements_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;
