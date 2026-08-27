-- Designated group, for the TiPP Focus CV template.
--
-- The template has a DESIGNATED GROUP row and an ordinary CV never carries it,
-- so without somewhere to store it every generated document has a hole in the
-- row that matters most on a BEE-scored bid.
--
-- Free text rather than an enum. The phrasings in real CVs vary ("African
-- Male", "Black Male", "Coloured Male", "Black African") and a constraint would
-- reject the value someone was told to use by a client.
--
-- Self-contained and idempotent: safe to re-run.

alter table public.candidates
  add column if not exists designated_group text;

comment on column public.candidates.designated_group is
  'Employment equity designated group, as it should read on a submitted CV.';

-- ---------------------------------------------------------------------------
-- Verify. Expect one row reading: designated_group | text
-- ---------------------------------------------------------------------------
select column_name as item, data_type as type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'candidates'
  and column_name = 'designated_group';
