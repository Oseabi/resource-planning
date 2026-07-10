-- Full-text-ish search across candidate fields (name, role, location, and the
-- skills/certs/quals/sectors arrays) via a generated text column + trigram index.
-- Lets a partial term like "Tekla" match the skill "Tekla Structures".

create extension if not exists pg_trgm;

alter table public.candidates
  add column if not exists search_text text
  generated always as (
    coalesce(full_name, '') || ' ' ||
    coalesce("current_role", '') || ' ' ||
    coalesce(location, '') || ' ' ||
    array_to_string(skills, ' ') || ' ' ||
    array_to_string(certifications, ' ') || ' ' ||
    array_to_string(qualifications, ' ') || ' ' ||
    array_to_string(sectors, ' ')
  ) stored;

create index if not exists candidates_search_trgm
  on public.candidates using gin (search_text gin_trgm_ops);
