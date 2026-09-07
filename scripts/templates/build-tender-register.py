"""Build the tender register template the team fills in."""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter
from openpyxl.comments import Comment

ARIAL = "Arial"
HEADER_FILL = PatternFill("solid", fgColor="1F3864")
EXAMPLE_FILL = PatternFill("solid", fgColor="FFF2CC")
REQUIRED_FILL = PatternFill("solid", fgColor="FCE4D6")
THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# Column name, width, whether the importer requires it, and the example value.
COLUMNS = [
    ("title", 46, True,
     "Provision of ERP support and maintenance services"),
    ("reference_number", 20, False, "SCM/2026/0148"),
    ("client", 24, False, "City of Cape Town"),
    ("location", 16, False, "Cape Town"),
    ("value", 14, False, 12500000),
    ("submission_deadline", 20, False, "2026-10-15"),
    ("contract_start_date", 20, False, "2027-01-04"),
    ("contract_end_date", 20, False, "2029-12-31"),
    ("status", 12, False, "live"),
    ("seats", 56, False,
     "3 x Business Analyst @5 | Project Manager @8 | 2 x ERP Consultant"),
    ("required_skills", 34, False, "Microsoft Dynamics 365 | SQL | Power BI"),
    ("required_certifications", 26, False, "PMP"),
    ("sectors", 26, False, "Public Sector | Technology"),
    ("min_experience_years", 20, False, 3),
    ("reference_letters_required", 26, False, 3),
]

DATE_COLUMNS = {"submission_deadline", "contract_start_date", "contract_end_date"}

wb = Workbook()

# ---------------------------------------------------------------- Tenders ---
ws = wb.active
ws.title = "Tenders"

for idx, (name, width, required, example) in enumerate(COLUMNS, start=1):
    letter = get_column_letter(idx)
    ws.column_dimensions[letter].width = width

    head = ws.cell(row=1, column=idx, value=name)
    head.font = Font(name=ARIAL, size=10, bold=True, color="FFFFFF")
    head.fill = HEADER_FILL
    head.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    head.border = BORDER

    cell = ws.cell(row=2, column=idx, value=example)
    cell.font = Font(name=ARIAL, size=10, italic=True)
    cell.fill = EXAMPLE_FILL
    cell.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
    cell.border = BORDER
    # Dates carry an explicit ISO format so Excel exports yyyy-mm-dd whatever
    # the machine's regional settings are. That single detail is the difference
    # between a clean import and a hundred rejected rows.
    if name in DATE_COLUMNS:
        cell.number_format = "@"
    if name == "value":
        cell.number_format = "#,##0"

ws.row_dimensions[1].height = 30
ws.row_dimensions[2].height = 32
ws.freeze_panes = "A2"

# The five the system accepts. Anything else is rejected rather than guessed,
# so a dropdown removes the commonest reason a row fails.
status_rule = DataValidation(
    type="list",
    formula1='"draft,live,submitted,won,lost"',
    allow_blank=True,
    showErrorMessage=True,
)
status_rule.error = "Use one of: draft, live, submitted, won, lost"
status_rule.errorTitle = "Not a recognised status"
ws.add_data_validation(status_rule)
status_rule.add("I2:I500")

# Keep the date columns as text so a regional setting cannot rewrite them.
for name in DATE_COLUMNS:
    col = get_column_letter([c[0] for c in COLUMNS].index(name) + 1)
    for row in range(3, 501):
        ws[f"{col}{row}"].number_format = "@"

# Deliberately NOT a cell below the table. Excel exports every cell in the used
# range, so a note written under the data becomes a row whose title is the note,
# and the importer would create a tender called "Row 2 is an example...".
# A comment carries the same words and never reaches the CSV.
ws["A1"].comment = Comment(
    "Row 2 is an example. Delete it before sending this back, and put one tender "
    "per row from row 2 down.\n\n"
    "Do not type anything below or beside the table: saving as CSV picks up every "
    "cell on this sheet, and a stray note becomes a tender.\n\n"
    "See the 'How to fill this in' tab for what each column means.",
    "Resource Planning",
)
ws["A1"].comment.width = 340
ws["A1"].comment.height = 160

# ------------------------------------------------------- How to fill it in ---
guide = wb.create_sheet("How to fill this in")
guide.column_dimensions["A"].width = 28
guide.column_dimensions["B"].width = 12
guide.column_dimensions["C"].width = 62
guide.column_dimensions["D"].width = 42

title = guide.cell(row=1, column=1, value="Tender register: what goes in each column")
title.font = Font(name=ARIAL, size=14, bold=True, color="1F3864")
guide.merge_cells("A1:D1")

intro = guide.cell(row=2, column=1, value=(
    "One row per tender. Only 'title' has to be filled in; everything else can be left blank "
    "and added later in the system. A blank cell never overwrites something already recorded, "
    "so this file can be sent back more than once as it gets more complete."
))
intro.font = Font(name=ARIAL, size=10)
intro.alignment = Alignment(wrap_text=True, vertical="top")
guide.merge_cells("A2:D2")
guide.row_dimensions[2].height = 42

heads = ["Column", "Required", "What it is", "Example"]
for idx, text in enumerate(heads, start=1):
    c = guide.cell(row=4, column=idx, value=text)
    c.font = Font(name=ARIAL, size=10, bold=True, color="FFFFFF")
    c.fill = HEADER_FILL
    c.border = BORDER
    c.alignment = Alignment(horizontal="left", vertical="center")

GUIDE = [
    ("title", "Yes", "What the tender is called. Use the wording from the RFQ so it can be found again.",
     "Provision of ERP support and maintenance services"),
    ("reference_number", "No",
     "The issuing authority's bid number. Worth filling in: it is how the system recognises a "
     "tender it has already seen, so this file can be re-sent without creating duplicates.",
     "SCM/2026/0148"),
    ("client", "No", "The organisation putting the work out.", "City of Cape Town"),
    ("location", "No", "Where the work happens.", "Cape Town"),
    ("value", "No", "Rand value. Digits only, no R and no spaces. Leave blank if not published.",
     "12500000"),
    ("submission_deadline", "No", "When the bid is due. See the date note below.", "2026-10-15"),
    ("contract_start_date", "No", "When the work would start if we win it.", "2027-01-04"),
    ("contract_end_date", "No", "When it would finish. Leave blank if open ended.", "2029-12-31"),
    ("status", "No",
     "One of: draft, live, submitted, won, lost. Pick from the dropdown. Blank is read as draft.",
     "live"),
    ("seats", "No",
     "The people the tender needs. Separate each role with a pipe. Put the number first with an "
     "x, and the minimum years after an @. Both are optional: a bare role name means one person "
     "with no experience floor.",
     "3 x Business Analyst @5 | Project Manager @8 | 2 x ERP Consultant"),
    ("required_skills", "No", "Skills named in the RFQ, separated by a pipe.",
     "Microsoft Dynamics 365 | SQL | Power BI"),
    ("required_certifications", "No", "Certifications named in the RFQ, separated by a pipe.",
     "PMP | ITIL Foundation"),
    ("sectors", "No", "Sectors the work falls under, separated by a pipe.",
     "Public Sector | Technology"),
    ("min_experience_years", "No",
     "A years figure that applies to the whole tender. Any seat with its own @ number overrides it.",
     "3"),
    ("reference_letters_required", "No",
     "How many client reference letters the tender asks for. Put 0 if it genuinely asks for none, "
     "and leave blank if nobody has checked the RFQ yet. Those are different things.",
     "3"),
]

row = 5
for name, required, meaning, example in GUIDE:
    a = guide.cell(row=row, column=1, value=name)
    a.font = Font(name=ARIAL, size=10, bold=True)
    b = guide.cell(row=row, column=2, value=required)
    b.font = Font(name=ARIAL, size=10, bold=(required == "Yes"),
                  color="C00000" if required == "Yes" else "404040")
    if required == "Yes":
        b.fill = REQUIRED_FILL
    c = guide.cell(row=row, column=3, value=meaning)
    c.font = Font(name=ARIAL, size=10)
    d = guide.cell(row=row, column=4, value=example)
    d.font = Font(name=ARIAL, size=10, italic=True)
    for col in range(1, 5):
        cell = guide.cell(row=row, column=col)
        cell.alignment = Alignment(wrap_text=True, vertical="top")
        cell.border = BORDER
    guide.row_dimensions[row].height = 46 if len(meaning) > 90 else 30
    row += 1

row += 1
rules_head = guide.cell(row=row, column=1, value="Three things that will cause a row to be rejected")
rules_head.font = Font(name=ARIAL, size=12, bold=True, color="C00000")
guide.merge_cells(start_row=row, start_column=1, end_row=row, end_column=4)
row += 1

RULES = [
    ("Dates must read 2026-10-15",
     "Year, then month, then day. 15/10/2026 is rejected rather than guessed at, because whether "
     "it means 15 October or the 10th of a 15th month depends on who saved the file, and guessing "
     "wrong puts a contract in the wrong month where nobody notices until it needs extending."),
    ("Role names have to match the ones the system knows",
     "Write 'Business Analyst', not 'BA' or 'Snr BA'. The system scores a candidate against the "
     "exact role on the seat, so an abbreviation it does not recognise scores zero and the tender "
     "reports that nobody can fill the seat, even when three people obviously can. Common short "
     "forms like BA and PM are expanded automatically, and anything else is reported back to you "
     "in a list rather than quietly accepted."),
    ("Use a pipe between list items",
     "Skills, certifications, sectors and seats all separate with a pipe. Commas are fine inside "
     "an item, so 'Roads, bridges and structures' stays as one thing."),
]
for heading, detail in RULES:
    h = guide.cell(row=row, column=1, value=heading)
    h.font = Font(name=ARIAL, size=10, bold=True)
    h.alignment = Alignment(wrap_text=True, vertical="top")
    d = guide.cell(row=row, column=3, value=detail)
    d.font = Font(name=ARIAL, size=10)
    d.alignment = Alignment(wrap_text=True, vertical="top")
    guide.merge_cells(start_row=row, start_column=3, end_row=row, end_column=4)
    guide.row_dimensions[row].height = 62
    row += 1

row += 1
send = guide.cell(row=row, column=1, value=(
    "When it is filled in: save as CSV (File, Save As, CSV UTF-8) and send that. "
    "It is read with  npx tsx scripts/import-tenders.ts <file.csv>  which prints back "
    "exactly what it would do and writes nothing. Only a second run with --apply writes."
))
send.font = Font(name=ARIAL, size=10, bold=True)
send.alignment = Alignment(wrap_text=True, vertical="top")
guide.merge_cells(start_row=row, start_column=1, end_row=row, end_column=4)
guide.row_dimensions[row].height = 30

import sys
out = sys.argv[1]
wb.save(out)
print("wrote", out)
