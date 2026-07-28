-- Resource categories — a high-level practice-area grouping for candidates
-- (e.g. "ERP", "Enterprise Architecture (EA)"). A candidate may hold several.
--
-- Self-contained and idempotent: safe to re-run.

alter table public.candidates
  add column if not exists resource_categories text[] not null default '{}';

create index if not exists candidates_resource_categories_gin
  on public.candidates using gin (resource_categories);

-- Fold resource_categories into the searchable search_text column so a search
-- term like "ERP" matches candidates tagged with that category.
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
    array_to_string(coalesce(new.resource_categories, '{}'), ' ');
  return new;
end;
$$;

-- Re-fire the BEFORE UPDATE trigger so existing rows pick up the new column.
update public.candidates set full_name = full_name;
