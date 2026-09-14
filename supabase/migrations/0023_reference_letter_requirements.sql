-- What kind of reference letters a tender asks for, not only how many.
--
-- A tender rarely stops at a number. It says what the referenced work must
-- have been (Azure managed services; an EA and BPM transformation of
-- similar size), how recent (within the last five years), what each letter
-- must carry (letterhead, dates, a contactable person, the contract value)
-- and how the count is scored. The number alone let the page say "3 needed,
-- 3 on file" over three letters the buyer would not accept. The AI reads
-- the rest off the document now; the recency and the value narrow which
-- letters on file count, and the note tells the team what to go and find.
--
-- Self-contained and idempotent: safe to re-run.

alter table public.tenders
  add column if not exists reference_letters_note text,
  add column if not exists reference_letters_within_years integer,
  add column if not exists reference_letters_min_value numeric;

comment on column public.tenders.reference_letters_note is
  'What the reference letters must show, in the document''s words: the kind of work, what each letter must carry, how the count is scored.';
comment on column public.tenders.reference_letters_within_years is
  'Only work completed within this many years counts, as the document puts it ("within the last five years"). Null means no limit stated.';
comment on column public.tenders.reference_letters_min_value is
  'Only referenced projects worth at least this much count, in rand. Null means no floor stated.';
