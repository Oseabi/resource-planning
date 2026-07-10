-- Phase 3: make match results upsertable and support alert dedupe.
-- Idempotent and self-contained.

-- Remove any duplicate (candidate, target) rows before adding the unique index
-- (keeps the most recent row per pair).
delete from public.matches m
using public.matches m2
where m.candidate_id = m2.candidate_id
  and m.match_target_type = m2.match_target_type
  and m.match_target_id = m2.match_target_id
  and m.created_at < m2.created_at;

create unique index if not exists matches_target_candidate_uidx
  on public.matches (candidate_id, match_target_type, match_target_id);

-- Score at which the last alert was sent, so we only re-alert on a material rise.
alter table public.matches
  add column if not exists alerted_score numeric;
