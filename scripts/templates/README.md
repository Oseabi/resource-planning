# The spreadsheet templates

The two files in `docs/` are built by these scripts. They are binaries, so
without the scripts nobody can amend a column, a dropdown or a line of guidance
without rebuilding the whole thing by hand.

```bash
pip install openpyxl
python scripts/templates/build-tender-register.py docs/tender-register-template.xlsx
python scripts/templates/build-candidate-roster.py docs/candidate-roster-template.xlsx
```

Edit the script, rebuild, and commit both. A template edited directly in Excel
and committed will be silently overwritten the next time somebody runs these.

## Two rules these scripts follow, and why

**Nothing is written below or beside the table.** Excel's CSV export writes
every cell in the used range, so a note under the data becomes a data row: an
earlier version of the tender template carried a red "delete the example row"
note in A4, and saving it as CSV produced a tender titled *"Row 2 is an example.
Delete it before sending this back..."*. Instructions live in the guidance tab
and in a comment on A1, neither of which reaches a CSV.

**The example row is refused by the importers.** `TEMPLATE_EXAMPLE_REFERENCE`
in `src/lib/tender-import.ts` and `TEMPLATE_EXAMPLE_EMAIL` in
`src/lib/candidate-import.ts` hold the example row's identifiers. Forgetting to
delete the example is the likeliest mistake anybody makes with a filled-in
template, so it is named rather than quietly created. **If you change the
example row here, change those constants too**, or the guard stops working.

## Checking a change

Both importers read what these produce, so the round trip is the test:

```bash
python scripts/templates/build-candidate-roster.py docs/candidate-roster-template.xlsx
npx tsx scripts/import-candidates.ts <the template saved as csv>
```

It should reject exactly one row, the example, and nothing else.
