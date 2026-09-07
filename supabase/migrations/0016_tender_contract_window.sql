-- Contract window on the tender.
--
-- A tender records when a contract starts and never when it ends, so nothing
-- can tell a bid won last year and finished from one running right now. Every
-- operational screen filters on status, and status answers "did we win it",
-- which is a bidding question. Whether a contract is running is a calendar
-- question, and it needs the other end of the window to be answerable at all.
--
-- The window lives on the tender because the contract is one thing, negotiated
-- once. People who join late or leave early are the exception, and that override
-- already has a home in placements.end_date.
--
-- Self-contained and idempotent: safe to re-run.

alter table public.tenders
  add column if not exists contract_end_date date;

comment on column public.tenders.contract_end_date is
  'When the awarded contract finishes. Null means open ended or not yet known.';

-- An end before the start is always a data-entry mistake. Added NOT VALID,
-- matching placements_end_after_start in 0013: the rule binds new and updated
-- rows without a full table scan, and without one odd historic row aborting the
-- whole file, which the SQL Editor runs as a single batch.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tenders_contract_end_after_start'
  ) then
    alter table public.tenders
      add constraint tenders_contract_end_after_start
      check (
        contract_end_date is null
        or contract_start_date is null
        or contract_end_date >= contract_start_date
      ) not valid;
  end if;
end $$;

-- Range-scanned ("which contracts finish before X"), so btree is right.
create index if not exists tenders_contract_end_date_idx
  on public.tenders (contract_end_date);

-- Verify 1. Expect one row: contract_end_date | date
select column_name as item, data_type as type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'tenders'
  and column_name = 'contract_end_date';

-- Verify 2. Expect four rows, and placements_update must be among them.
-- Extending a contract is the first code in this app to UPDATE a placement. The
-- policy has existed since 0002 but has never been exercised, and a project
-- built from setup.sql rather than the migration series may not carry it. An
-- UPDATE that RLS filters out is not an error, it simply changes nothing, so a
-- missing policy here would surface as extensions that silently do nothing.
select policyname as item, cmd as type
from pg_policies
where schemaname = 'public' and tablename = 'placements'
order by policyname;
