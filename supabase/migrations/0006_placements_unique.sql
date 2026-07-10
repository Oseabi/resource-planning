-- Prevent double-placing the same candidate on the same requirement/tender.
-- Idempotent: removes any existing duplicates (keeping the most recent), then
-- adds a unique index the app-level guard can rely on.

delete from public.placements p
using public.placements p2
where p.candidate_id = p2.candidate_id
  and p.source_type = p2.source_type
  and p.source_id = p2.source_id
  and p.created_at < p2.created_at;

create unique index if not exists placements_candidate_source_uidx
  on public.placements (candidate_id, source_type, source_id);
