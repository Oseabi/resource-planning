-- What the issued TiPP Focus CV carries that the record could not hold.
--
-- Five real CVs on the current template were read against the candidate
-- table, and each carried a date of birth, a cover-page date, a skills table
-- with categories and years per skill, a certificates table with institution
-- and year, a projects table, an achievements section, and a client per job.
-- The record had a flat list of skills, a flat list of certification names,
-- and nothing for the rest. A person's CV is the thing that changes over
-- time, and every field the template prints is a field the system has to be
-- able to give back.
--
-- The flat lists stay. skills, technical_skills and certifications are what
-- matching scores and the candidates filter searches, and both keep working
-- unchanged. The new structured columns sit beside them and the flat lists
-- are derived from them on save.
--
-- Self-contained and idempotent: safe to re-run.

alter table public.candidates
  add column if not exists date_of_birth date,
  add column if not exists cv_as_of date,
  add column if not exists skill_matrix jsonb not null default '[]',
  add column if not exists certificates jsonb not null default '[]',
  add column if not exists projects jsonb not null default '[]',
  add column if not exists achievements text;

comment on column public.candidates.date_of_birth is
  'As printed on the TiPP Focus template. Personal information; stripped before any AI call.';
comment on column public.candidates.cv_as_of is
  'The "As of date" on the cover page of the CV this record was read from. When the information was last confirmed.';
comment on column public.candidates.skill_matrix is
  'The SKILLSET table: [{category, skills: [{name, years, note}]}]. technical_skills is derived from it.';
comment on column public.candidates.certificates is
  'CERTIFICATES AND COURSES with detail: [{name, institution, year}]. certifications is derived from it.';
comment on column public.candidates.projects is
  'The PROJECTS table: [{company, projects: [name]}].';
comment on column public.candidates.achievements is
  'The ACHIEVEMENTS section, verbatim, sub-headings kept. Read by people, not scored.';

-- Achievements are prose worth finding by. The structured columns are not
-- folded in: their names already reach search through the derived flat
-- lists, and folding jsonb into a trigram column would index its keys.
-- Same replace-and-backfill pattern as 0008.
create or replace function public.candidates_set_search_text()
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
    array_to_string(coalesce(new.resource_categories, '{}'), ' ') || ' ' ||
    coalesce(new.achievements, '');
  return new;
end;
$$;

-- Re-fire the trigger on every row so search_text picks up the new column.
update public.candidates set full_name = full_name;

-- Verify 1. Expect six rows.
select column_name as item, data_type as type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'candidates'
  and column_name in ('date_of_birth', 'cv_as_of', 'skill_matrix', 'certificates', 'projects', 'achievements')
order by column_name;
