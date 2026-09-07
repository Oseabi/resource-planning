# Archived SQL

Nothing in this folder should be run against the live database.

It is kept because it records how the demo was built and how the system was set
up, which is worth being able to read. It is moved out of `supabase/` because
the database now holds real tenders and candidates, and every file here was
written on the assumption that it does not.

## Will destroy real data

**`setup.sql`** opens with `drop table ... cascade` on every application table.
It was the "start from scratch" file. It also predates the `activity` table, so
even on an empty database it now rebuilds an incomplete schema. Use the
numbered files in `supabase/migrations/` instead.

**`remove_em_dashes.sql`** rewrites free text across candidates, tenders, job
requirements, positions and OEM letters, and rewrites four tender titles matched
by `LIKE` rather than by id. It is not scoped to demo rows and has no undo. It
was written to clean up seeded copy. Run against real records it would silently
edit text transcribed from client documents, which is a data change rather than
a style fix.

## Recreates the demo

`seed_demo.sql`, `seed_candidate_details.sql`, `seed_oem_letters.sql`,
`seed_won_bids.sql` and `seed_demo_cleanup.sql` create and remove the seeded
demo data, identified by the `deadbee1` to `deadbee4` id prefixes.

`demo_prep.sql` staged a specific walkthrough. Note that it renames a candidate
matched by `LIKE 'Test Candidate%'` to a plausible real name, which is why
telling demo rows from real ones by eye does not work. `demo_prep_undo.sql`
reverses most, but not that rename.

Running any of these now would put fake candidates into real shortlists and fake
tenders into the pipeline value.

## Superseded

`run_0013_and_0014.sql` bundled two migrations for a single paste. Both are
applied, and the numbered files are the record.

## Still live, in `supabase/`

- `inventory.sql`, read-only, what is in the database
- `orphan_check.sql`, read-only, should always return zero rows
- `reset_to_empty.sql`, empties the business tables and refuses to run if any
  record carries an uploaded file
- `bootstrap_admin.sql`, `storage_setup.sql`, `repair_assignment_policies.sql`,
  one-time setup that is safe to re-run
