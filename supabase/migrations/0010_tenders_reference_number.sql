-- Bid / reference number for a tender, e.g. "H004L2705RFP00048".
-- This is the identifier the issuing authority uses on every submission and in
-- all correspondence, so it needs to travel with the tender record.
--
-- Self-contained and idempotent: safe to re-run.

alter table public.tenders
  add column if not exists reference_number text;

create index if not exists tenders_reference_number_idx
  on public.tenders (reference_number);
