-- Rich, multi-industry candidate fields (Phase 2.5).
-- Adds multiple roles, professional summary, split technical skills, languages,
-- links, and structured work-experience / education, then maintains the
-- searchable `search_text` column via a trigger.
--
-- Self-contained and idempotent: safe to run whether or not 0003 was applied,
-- and safe to re-run after a partial/failed attempt.
--
-- NOTE: search_text is maintained by a BEFORE trigger (not a GENERATED column),
-- because some Postgres versions reject array_to_string() in a generated
-- expression as "not immutable".

create extension if not exists pg_trgm;

-- New columns ---------------------------------------------------------------
alter table public.candidates
  add column if not exists additional_roles text[] not null default '{}',
  add column if not exists professional_summary text,
  add column if not exists technical_skills text[] not null default '{}',
  add column if not exists languages text[] not null default '{}',
  add column if not exists linkedin_url text,
  add column if not exists portfolio_url text,
  add column if not exists work_experience jsonb not null default '[]',
  add column if not exists education jsonb not null default '[]';

create index if not exists candidates_additional_roles_gin on public.candidates using gin (additional_roles);
create index if not exists candidates_technical_skills_gin on public.candidates using gin (technical_skills);
create index if not exists candidates_languages_gin on public.candidates using gin (languages);

-- search_text via trigger (replaces any 0003 generated column) ----------------
drop index if exists candidates_search_trgm;
alter table public.candidates drop column if exists search_text;
alter table public.candidates add column search_text text;

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
    array_to_string(coalesce(new.languages, '{}'), ' ');
  return new;
end;
$$;

drop trigger if exists candidates_search_text_trg on public.candidates;
create trigger candidates_search_text_trg
  before insert or update on public.candidates
  for each row execute function public.candidates_set_search_text();

-- Backfill existing rows (fires the BEFORE UPDATE trigger).
update public.candidates set full_name = full_name;

create index candidates_search_trgm on public.candidates using gin (search_text gin_trgm_ops);
