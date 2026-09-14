-- Each department's colour, and the departments a candidate is filed under.
--
-- TiPP Focus's four business units each have a colour on the corporate
-- site, and the app wears the colour of the department the signed-in
-- person belongs to. The colour lives on the department row so an admin
-- can change it on the settings screen without a deploy; the app works
-- out the text colour and the dark-mode shade from it.
--
-- Candidates are filed under one or more departments: a project manager
-- can serve Consulting and Construction. An array on the row rather than
-- a join table, because this is a label and a default filter and never a
-- visibility rule: the pool stays shared (see 0018), the candidate
-- policies are untouched, and a row's departments come back with the row.
-- The trigger keeps the array honest, since an array column has no
-- foreign key: an id that is not a department is refused, and a
-- department listed twice is listed once.
--
-- Self-contained and idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- The colour
-- ---------------------------------------------------------------------------

alter table public.departments
  add column if not exists colour text;

alter table public.departments
  drop constraint if exists departments_colour_check;

alter table public.departments
  add constraint departments_colour_check
  check (colour is null or colour ~ '^#[0-9A-Fa-f]{6}$');

comment on column public.departments.colour is
  'The department''s accent as #RRGGBB, the light-mode colour from the corporate site. The app derives the text colour and the dark-mode shade from it.';

-- Seeded only where nothing is set, so a re-run never undoes an admin's edit.
update public.departments d
set colour = v.colour
from (
  values
    ('consulting', '#68252C'),
    ('resourcing', '#2CB673'),
    ('human-capital', '#F29101'),
    ('construction', '#DC9204')
) as v (slug, colour)
where d.slug = v.slug
  and d.colour is null;

-- ---------------------------------------------------------------------------
-- The departments a candidate is filed under
-- ---------------------------------------------------------------------------

alter table public.candidates
  add column if not exists department_ids uuid[] not null default '{}';

create index if not exists candidates_department_ids_gin
  on public.candidates using gin (department_ids);

comment on column public.candidates.department_ids is
  'The business units this person is filed under; may be several. A label and a default filter, never a visibility rule: the pool stays shared.';

-- At the top level rather than inside a do block: a function body inside
-- a do block needs nested dollar quoting, which the SQL editor mangles.
create or replace function public.candidates_check_department_ids()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from unnest(new.department_ids) as d
    where not exists (select 1 from public.departments where id = d)
  ) then
    raise exception 'A candidate can only be filed under an existing department';
  end if;

  new.department_ids := (
    select coalesce(array_agg(distinct d), '{}'::uuid[])
    from unnest(new.department_ids) as d
  );
  return new;
end;
$$;

drop trigger if exists candidates_check_department_ids on public.candidates;
create trigger candidates_check_department_ids
  before insert or update of department_ids on public.candidates
  for each row execute function public.candidates_check_department_ids();

-- Backfill from whoever created the record, empty rows only, the way 0018
-- filed the tenders. A candidate an admin created stays unfiled, which the
-- candidates list says out loud.
update public.candidates c
set department_ids = array[p.department_id]
from public.profiles p
where c.created_by = p.id
  and p.department_id is not null
  and c.department_ids = '{}';

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------

-- 1. Four departments, each with a colour.
select slug as item, colour as detail
from public.departments
order by sort_order;

-- 2. How many candidates are still filed nowhere (the admin-created ones).
select count(*)::text as item, 'candidates with no department' as detail
from public.candidates
where department_ids = '{}';

-- 3. One row: the trigger is in place.
select tgname as item, tgenabled::text as detail
from pg_trigger
where tgname = 'candidates_check_department_ids';
