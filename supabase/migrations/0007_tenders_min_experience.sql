-- Tenders gain a minimum-years-of-experience requirement (mirrors job_requirements),
-- which feeds the tender match score. Idempotent.

alter table public.tenders
  add column if not exists min_experience_years numeric;
