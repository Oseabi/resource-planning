-- ============================================================================
-- Remove em dashes from stored data.
--
-- The application code no longer writes them, but rows inserted before that
-- change still hold them, including four seeded tender titles. This sweeps every
-- user-visible text column in the app's own tables.
--
-- Substitution rules, applied in order:
--   " - " between clauses  ->  ", "   (reads as prose)
--   any remaining em dash  ->  "-"    (inside a word or code)
-- Titles that used an em dash as a subtitle separator are set explicitly below,
-- because a colon reads better there than a comma.
--
-- Self-contained and idempotent: safe to re-run, and a no-op once clean.
-- Paste into the Supabase SQL Editor and Run.
-- ============================================================================

-- Helper applied inline: collapse a spaced em dash to a comma, then any stray
-- em dash to a hyphen.
-- replace(replace(col, ' — ', ', '), '—', '-')

-- ---------------------------------------------------------------------------
-- Scalar text columns
-- ---------------------------------------------------------------------------
-- "current_role" must stay quoted. It is a reserved word in Postgres, and left
-- bare in a SET clause it is a syntax error that aborts the whole script.
update public.candidates set
  full_name            = replace(replace(full_name, ' — ', ', '), '—', '-'),
  "current_role"       = replace(replace("current_role", ' — ', ', '), '—', '-'),
  professional_summary = replace(replace(professional_summary, ' — ', ', '), '—', '-'),
  location             = replace(replace(location, ' — ', ', '), '—', '-'),
  notes                = replace(replace(notes, ' — ', ', '), '—', '-')
where full_name || coalesce("current_role", '') || coalesce(professional_summary, '')
   || coalesce(location, '') || coalesce(notes, '') like '%—%';

update public.tenders set
  title            = replace(replace(title, ' — ', ', '), '—', '-'),
  client           = replace(replace(client, ' — ', ', '), '—', '-'),
  location         = replace(replace(location, ' — ', ', '), '—', '-'),
  reference_number = replace(replace(reference_number, ' — ', ', '), '—', '-')
where title || coalesce(client, '') || coalesce(location, '')
   || coalesce(reference_number, '') like '%—%';

update public.job_requirements set
  title         = replace(replace(title, ' — ', ', '), '—', '-'),
  client        = replace(replace(client, ' — ', ', '), '—', '-'),
  required_role = replace(replace(required_role, ' — ', ', '), '—', '-'),
  location      = replace(replace(location, ' — ', ', '), '—', '-')
where title || coalesce(client, '') || coalesce(required_role, '')
   || coalesce(location, '') like '%—%';

update public.positions set
  role  = replace(replace(role, ' — ', ', '), '—', '-'),
  notes = replace(replace(notes, ' — ', ', '), '—', '-')
where role || coalesce(notes, '') like '%—%';

update public.oem_letters set
  title            = replace(replace(title, ' — ', ', '), '—', '-'),
  oem_vendor       = replace(replace(oem_vendor, ' — ', ', '), '—', '-'),
  reference_number = replace(replace(reference_number, ' — ', ', '), '—', '-'),
  issued_to        = replace(replace(issued_to, ' — ', ', '), '—', '-'),
  notes            = replace(replace(notes, ' — ', ', '), '—', '-')
where title || oem_vendor || coalesce(reference_number, '') || coalesce(issued_to, '')
   || coalesce(notes, '') like '%—%';

-- ---------------------------------------------------------------------------
-- Array columns
--
-- Rebuilt element by element; array_to_string would lose the boundaries. The
-- candidate trigger rewrites search_text on update, so it stays consistent.
-- ---------------------------------------------------------------------------
update public.candidates c set
  additional_roles = sub.additional_roles,
  skills           = sub.skills,
  technical_skills = sub.technical_skills,
  certifications   = sub.certifications,
  qualifications   = sub.qualifications,
  sectors          = sub.sectors,
  resource_categories = sub.resource_categories
from (
  select
    id,
    array(select replace(replace(x, ' — ', ', '), '—', '-') from unnest(additional_roles) x)    as additional_roles,
    array(select replace(replace(x, ' — ', ', '), '—', '-') from unnest(skills) x)              as skills,
    array(select replace(replace(x, ' — ', ', '), '—', '-') from unnest(technical_skills) x)    as technical_skills,
    array(select replace(replace(x, ' — ', ', '), '—', '-') from unnest(certifications) x)      as certifications,
    array(select replace(replace(x, ' — ', ', '), '—', '-') from unnest(qualifications) x)      as qualifications,
    array(select replace(replace(x, ' — ', ', '), '—', '-') from unnest(sectors) x)             as sectors,
    array(select replace(replace(x, ' — ', ', '), '—', '-') from unnest(resource_categories) x) as resource_categories
  from public.candidates
  where array_to_string(additional_roles || skills || technical_skills || certifications
                     || qualifications || sectors || resource_categories, ' ') like '%—%'
) sub
where c.id = sub.id;

update public.positions p set
  required_skills         = sub.required_skills,
  required_certifications = sub.required_certifications
from (
  select
    id,
    array(select replace(replace(x, ' — ', ', '), '—', '-') from unnest(required_skills) x)         as required_skills,
    array(select replace(replace(x, ' — ', ', '), '—', '-') from unnest(required_certifications) x) as required_certifications
  from public.positions
  where array_to_string(required_skills || required_certifications, ' ') like '%—%'
) sub
where p.id = sub.id;

update public.tenders t set
  required_roles          = sub.required_roles,
  required_skills         = sub.required_skills,
  required_certifications = sub.required_certifications,
  sectors                 = sub.sectors
from (
  select
    id,
    array(select replace(replace(x, ' — ', ', '), '—', '-') from unnest(required_roles) x)          as required_roles,
    array(select replace(replace(x, ' — ', ', '), '—', '-') from unnest(required_skills) x)         as required_skills,
    array(select replace(replace(x, ' — ', ', '), '—', '-') from unnest(required_certifications) x) as required_certifications,
    array(select replace(replace(x, ' — ', ', '), '—', '-') from unnest(sectors) x)                 as sectors
  from public.tenders
  where array_to_string(required_roles || required_skills || required_certifications || sectors, ' ') like '%—%'
) sub
where t.id = sub.id;

-- ---------------------------------------------------------------------------
-- Titles where the em dash separated a subtitle: a colon reads better than the
-- comma the sweep above would leave.
-- ---------------------------------------------------------------------------
update public.tenders
set title = 'N3 corridor bridge rehabilitation: professional services'
where title like 'N3 corridor bridge rehabilitation%professional services';

update public.tenders
set title = 'Commercial office fit-out: construction management'
where title like 'Commercial office fit-out%construction management';

update public.tenders
set title = 'Hospital information system rollout: clinical workstream'
where title like 'Hospital information system rollout%clinical workstream';

update public.tenders
set title = 'Programme management office: multi-year transformation'
where title like 'Programme management office%multi-year transformation';

-- ---------------------------------------------------------------------------
-- Verify, part 1: the four titles above. Each should now read with a colon.
--
-- Worth checking separately, because these rows lost their em dash to an
-- earlier edit that left a bare space behind. The em dash counts below are
-- therefore already 0 for them and would look clean either way.
-- ---------------------------------------------------------------------------
select title from public.tenders
where title like 'N3 corridor bridge rehabilitation%'
   or title like 'Commercial office fit-out%'
   or title like 'Hospital information system rollout%'
   or title like 'Programme management office%'
order by title;

-- ---------------------------------------------------------------------------
-- Verify, part 2: every count below should be 0.
-- ---------------------------------------------------------------------------
select 'candidates' as table_name, count(*) as rows_with_em_dash from public.candidates
  where full_name || coalesce("current_role", '') || coalesce(professional_summary, '')
     || coalesce(location, '') || coalesce(notes, '')
     || array_to_string(additional_roles || skills || technical_skills || certifications
                     || qualifications || sectors || resource_categories, ' ') like '%—%'
union all
select 'tenders', count(*) from public.tenders
  where title || coalesce(client, '') || coalesce(location, '') || coalesce(reference_number, '')
     || array_to_string(required_roles || required_skills || required_certifications || sectors, ' ') like '%—%'
union all
select 'job_requirements', count(*) from public.job_requirements
  where title || coalesce(client, '') || coalesce(required_role, '') || coalesce(location, '') like '%—%'
union all
select 'positions', count(*) from public.positions
  where role || coalesce(notes, '')
     || array_to_string(required_skills || required_certifications, ' ') like '%—%'
union all
select 'oem_letters', count(*) from public.oem_letters
  where title || oem_vendor || coalesce(reference_number, '') || coalesce(issued_to, '')
     || coalesce(notes, '') like '%—%';
