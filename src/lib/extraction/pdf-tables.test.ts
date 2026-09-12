import { describe, it, expect } from "vitest";
import { tablesFromPdfPages, pdfItemsFrom, type PdfTextItem } from "@/lib/extraction/pdf-tables";

/**
 * The geometry below is the issued template's, measured from real PDFs:
 * labels 12pt at x 78, values 9pt at x 265 sitting 4.6 below their label,
 * headings centred at x 228 to 290, column headers 11pt at x 78 / 235 / 410,
 * body 9.1pt at a pitch of 11, wrapped lines 11 apart, rows 12 apart.
 */
const BODY = 9.1;
const LABEL = 12;
const HEADER = 11;

/** A run, in the order a real page would emit it. */
function run(str: string, x: number, y: number, opts: { h?: number; eol?: boolean; w?: number } = {}): PdfTextItem {
  return { str, x, y, width: opts.w ?? str.length * 4.5, height: opts.h ?? BODY, hasEOL: opts.eol ?? false };
}

const page = (...items: PdfTextItem[]) => ({ items });

/** Column headers for a three-column table at a given baseline. */
const careerHeader = (y: number) => [
  run("COMPANY", 78.3, y, { h: HEADER }),
  run("POSITION", 235.1, y, { h: HEADER }),
  run("DURATION", 410.3, y, { h: HEADER }),
];

describe("tablesFromPdfPages", () => {
  it("reads a label and its value from the same row, the value sitting below the label", () => {
    // The value baseline is 4.6 under the label's, which a 2.5 tolerance split.
    const { tables } = tablesFromPdfPages([
      page(
        run("FULL NAME (S)", 78, 757.9, { h: LABEL }),
        run("Thandi Example", 265.1, 759.8),
        run("DATE OF BIRTH", 78, 733.9, { h: LABEL }),
        run("05 February 1989", 265.1, 729.3),
      ),
    ]);
    expect(tables).toEqual([
      [
        ["FULL NAME (S)", "Thandi Example"],
        ["DATE OF BIRTH", "05 February 1989"],
      ],
    ]);
  });

  it("reads a three-column row", () => {
    const { tables } = tablesFromPdfPages([
      page(
        ...careerHeader(344),
        run("Morrison Co", 78.3, 326.7),
        run("Consultant", 235.1, 326.7),
        run("September 2024 – Current", 410.3, 326.7),
      ),
    ]);
    expect(tables).toEqual([
      [
        ["COMPANY", "POSITION", "DURATION"],
        ["Morrison Co", "Consultant", "September 2024 – Current"],
      ],
    ]);
  });

  it("rejoins a row whose cells wrap, from the order the cells are emitted", () => {
    // Emitted cell by cell: the whole position, then the whole duration. The
    // second line of each has nothing in column one, and the position's second
    // line arrives after the first line of the duration in reading order,
    // which is why sorting into lines first loses this.
    const { tables } = tablesFromPdfPages([
      page(
        ...careerHeader(344),
        run("Morrison Co", 78.3, 326.7),
        run("Consultant Business Architect &", 235.1, 326.7, { eol: true }),
        run("Analyst", 235.1, 315.7),
        run("September 2024 –", 410.3, 326.7, { eol: true }),
        run("Current", 410.3, 315.7),
        run("ESR", 78.3, 303.7),
        run("Senior Business Analyst", 235.1, 303.7),
        run("April 2009 – June 2012", 410.3, 303.7),
      ),
    ]);
    expect(tables[0]).toEqual([
      ["COMPANY", "POSITION", "DURATION"],
      ["Morrison Co", "Consultant Business Architect & Analyst", "September 2024 – Current"],
      ["ESR", "Senior Business Analyst", "April 2009 – June 2012"],
    ]);
  });

  it("rejoins a compound word broken at its hyphen, and leaves a date range alone", () => {
    const { tables } = tablesFromPdfPages([
      page(
        run("SKILLS", 78.3, 400, { h: HEADER }),
        run("PROFICIENCY", 235.1, 400, { h: HEADER }),
        run("YEARS OF EXPERIENCE", 410.3, 400, { h: HEADER }),
        run("Programming Languages", 78.3, 380),
        run("SQL; basic scripting and system-", 235.1, 380, { eol: true }),
        run("integration concepts", 235.1, 369),
        run("2014 -", 410.3, 380, { eol: true }),
        run("Current", 410.3, 369),
      ),
    ]);
    expect(tables[0][1]).toEqual([
      "Programming Languages",
      "SQL; basic scripting and system-integration concepts",
      "2014 - Current",
    ]);
  });

  it("continues a cell that wrapped at the foot of a page, even without a wrap mark", () => {
    // pdf.js sets hasEOL on a wrapped line, but not on the last line of a
    // page. The years column was emitted before the page turned, so by
    // column order the continuation would start a row with no category.
    const { tables } = tablesFromPdfPages([
      page(
        run("SKILLS", 78.3, 400, { h: HEADER }),
        run("PROFICIENCY", 235.1, 400, { h: HEADER }),
        run("YEARS OF EXPERIENCE", 410.3, 400, { h: HEADER }),
        run("Frameworks", 78.3, 92),
        run("BPM frameworks; Software", 233, 103, { eol: true }),
        run("Development Life Cycle; operating-", 233, 92),
        run("13+ years", 411, 92),
      ),
      page(
        run("model frameworks; governance and", 233, 761, { eol: true }),
        run("control frameworks", 233, 750),
        run("Software Platforms", 78.3, 705),
        run("SAP; core-banking platforms", 233, 738),
        run("10+ years", 411, 738),
      ),
    ]);
    expect(tables[0]).toEqual([
      ["SKILLS", "PROFICIENCY", "YEARS OF EXPERIENCE"],
      ["Frameworks", "BPM frameworks; Software Development Life Cycle; operating-model frameworks; governance and control frameworks", "13+ years"],
      ["Software Platforms", "SAP; core-banking platforms", "10+ years"],
    ]);
  });

  it("does not take a word of justified prose for a heading", () => {
    // "skills." at x of 469 spells the SKILLS heading; it is a word of the
    // summary, on a line that started at the margin.
    const { tables } = tablesFromPdfPages([
      page(
        run("CANDIDATE OVERVIEW", 229, 584, { h: LABEL }),
        run("Mduduzi brings strong analytical and interpersonal", 78, 379),
        run("skills.", 469, 379),
        run("He", 505, 379),
        run("is", 520, 379, { eol: true }),
        run("effective at prioritising tasks.", 78, 368),
      ),
    ]);
    expect(tables).toEqual([
      [["CANDIDATE SUMMARY"]],
      [["Mduduzi brings strong analytical and interpersonal skills. He is effective at prioritising tasks."]],
    ]);
  });

  it("rejoins a row whose first column wraps too", () => {
    // "Accident Compensation" then "Corporation" on the next line at x 78:
    // a rule that reads an empty first column as the only continuation
    // signal breaks here. The emission order does not.
    const { tables } = tablesFromPdfPages([
      page(
        ...careerHeader(344),
        run("Accident", 78.3, 303.7),
        run("Compensation", 158.4, 303.7, { eol: true }),
        run("Corporation", 78.3, 292.6),
        run("Enterprise Business Architect", 235.1, 303.7),
        run("April 2018 – September", 410.3, 303.7, { eol: true }),
        run("2024", 410.3, 292.6),
      ),
    ]);
    expect(tables[0][1]).toEqual([
      "Accident Compensation Corporation",
      "Enterprise Business Architect",
      "April 2018 – September 2024",
    ]);
  });

  it("puts a category first in its row however far down the page it sits", () => {
    // The skills table's category cell is vertically centred, so it can sit
    // three lines below the first skill it labels. It is still emitted first.
    const { tables } = tablesFromPdfPages([
      page(
        run("SKILLS", 78, 554.1, { h: HEADER }),
        run("PROFICIENCY", 233.4, 554.1, { h: HEADER }),
        run("YEARS OF", 410.8, 566.8, { h: HEADER, eol: true }),
        run("EXPERIENCE", 410.8, 554.1, { h: HEADER }),
        run("Technologies", 78, 503.9),
        run("Business Architecture", 233.4, 525.7),
        run("Business Analysis", 233.4, 514.7),
        run("Business Process Modelling", 233.4, 503.9),
        run("10+ years", 410.8, 525.7),
        run("15+ years", 410.8, 514.7),
        run("10+ years", 410.8, 503.9),
        run("Databases", 78, 488.3),
        run("Microsoft SQL", 233.4, 488.3),
        run("10+ years", 410.8, 488.3),
      ),
    ]);
    expect(tables[0]).toEqual([
      ["SKILLS", "PROFICIENCY", "YEARS OF EXPERIENCE"],
      ["Technologies", "Business Architecture\nBusiness Analysis\nBusiness Process Modelling", "10+ years\n15+ years\n10+ years"],
      ["Databases", "Microsoft SQL", "10+ years"],
    ]);
  });

  it("makes a centred heading a single-cell table and closes the one before it", () => {
    const { tables } = tablesFromPdfPages([
      page(
        run("FULL NAME (S)", 78, 757.9, { h: LABEL }),
        run("Thandi Example", 265.1, 759.8),
        run("CAREER SUMMARY", 239.6, 700, { h: LABEL }),
        ...careerHeader(680),
        run("ESR", 78.3, 668),
        run("Analyst", 235.1, 668),
        run("2009 – 2012", 410.3, 668),
      ),
    ]);
    expect(tables).toEqual([
      [["FULL NAME (S)", "Thandi Example"]],
      [["CAREER SUMMARY"]],
      [
        ["COMPANY", "POSITION", "DURATION"],
        ["ESR", "Analyst", "2009 – 2012"],
      ],
    ]);
  });

  it("maps the issued template's heading spellings onto the parser's", () => {
    const { tables } = tablesFromPdfPages([
      page(
        run("CANDIDATE OVERVIEW", 228.6, 700, { h: LABEL }),
        run("Some prose.", 78.3, 680),
        run("SKILLSET", 268.4, 650, { h: LABEL }),
        run("EMPLOYMENT HISTORY", 240, 620, { h: LABEL }),
        run("QUALIFICATIONS", 246.8, 590, { h: LABEL }),
      ),
    ]);
    expect(tables).toEqual([
      [["CANDIDATE SUMMARY"]],
      [["Some prose."]],
      [["SKILLS"]],
      [["EMPLOYMENT RECORD"]],
      [["QUALIFICATION"]],
    ]);
  });

  it("does not take a column header at the left margin for a section heading", () => {
    // QUALIFICATION at x 78 heads a column. At x 267 it heads a section.
    const { tables } = tablesFromPdfPages([
      page(
        run("QUALIFICATION", 267.2, 700, { h: LABEL }),
        run("QUALIFICATION", 78.3, 680, { h: HEADER }),
        run("INSTITUTION", 235.1, 680, { h: HEADER }),
        run("YEAR", 410.3, 680, { h: HEADER }),
        run("BSc", 78.3, 668),
        run("UCT", 235.1, 668),
        run("2001", 410.3, 668),
      ),
    ]);
    expect(tables).toEqual([
      [["QUALIFICATION"]],
      [
        ["QUALIFICATION", "INSTITUTION", "YEAR"],
        ["BSc", "UCT", "2001"],
      ],
    ]);
  });

  it("recognises a heading printed at body size, since the text is the test", () => {
    // One issued copy prints CERTIFICATES AND COURSES at 9pt.
    const { tables } = tablesFromPdfPages([page(run("CERTIFICATES AND COURSES", 242.7, 700, { h: BODY }))]);
    expect(tables).toEqual([[["CERTIFICATES AND COURSES"]]]);
  });

  it("reads the cover page's date and drops the rest of it", () => {
    const { tables, coverAsOf, hadCover } = tablesFromPdfPages([
      page(
        run("Candidate Resume", 200, 780, { h: 16 }),
        run("Thandi Example", 200, 760, { h: 14 }),
        run("As of date: 07 September 2026", 78, 720),
        run("Account Manager: Somebody", 78, 708),
        run("Email address: agency@example.com", 78, 696),
        run("Office Contact Details: 011 000 0000", 78, 684),
      ),
      page(run("FULL NAME (S)", 78, 757.9, { h: LABEL }), run("Thandi Example", 265.1, 759.8)),
    ]);
    expect(hadCover).toBe(true);
    expect(coverAsOf).toBe("07 September 2026");
    expect(JSON.stringify(tables)).not.toContain("agency@example.com");
    expect(JSON.stringify(tables)).not.toContain("Account Manager");
    expect(tables).toEqual([[["FULL NAME (S)", "Thandi Example"]]]);
  });

  it("does not mistake a document without one for having a cover", () => {
    const { hadCover, coverAsOf, tables } = tablesFromPdfPages([
      page(run("FULL NAME (S)", 78, 757.9, { h: LABEL }), run("Thandi Example", 265.1, 759.8)),
    ]);
    expect(hadCover).toBe(false);
    expect(coverAsOf).toBeNull();
    expect(tables).toHaveLength(1);
  });

  describe("the employment record", () => {
    const block = (y: number, company: string) => [
      run("Company", 78.3, y, { h: HEADER }),
      run(company, 236.7, y + 1.4),
      run("Role", 78.3, y - 16.8, { h: HEADER }),
      run("Consultant", 236.7, y - 15.4),
      run("Duration", 78.3, y - 33.6, { h: HEADER }),
      run("Aug 2007 – Apr 2008", 236.7, y - 32.2),
      run("Duties:", 78.3, y - 48),
      run("", 96.3, y - 59, { w: 4.2 }),
      run("Providing technical support to clients", 114.3, y - 59),
      run("", 96.3, y - 70, { w: 4.2 }),
      run("Processing and developing reports for management at an", 114.3, y - 70, { eol: true }),
      run("operational level", 114.3, y - 81),
    ];

    it("reads one block as label and value rows with the duties in one cell", () => {
      const { tables } = tablesFromPdfPages([
        page(run("EMPLOYMENT HISTORY", 240, 720, { h: LABEL }), ...block(656.4, "Tower Group")),
      ]);
      expect(tables[1]).toEqual([
        ["Company", "Tower Group"],
        ["Role", "Consultant"],
        ["Duration", "Aug 2007 – Apr 2008"],
        [
          "Duties:\nProviding technical support to clients\nProcessing and developing reports for management at an operational level",
        ],
      ]);
    });

    it("starts a new table at every Company label, so each block is one table", () => {
      const { tables } = tablesFromPdfPages([
        page(run("EMPLOYMENT HISTORY", 240, 780, { h: LABEL }), ...block(720, "Tower Group"), ...block(600, "Standard Bank")),
      ]);
      expect(tables).toHaveLength(3);
      expect(tables[1][0]).toEqual(["Company", "Tower Group"]);
      expect(tables[2][0]).toEqual(["Company", "Standard Bank"]);
    });

    it("starts a new block at the top of a page, where there is no gap to measure", () => {
      // The label's size is the only signal left, and it is enough.
      const { tables } = tablesFromPdfPages([
        page(run("EMPLOYMENT HISTORY", 240, 780, { h: LABEL }), ...block(720, "Tower Group")),
        page(...block(760, "Standard Bank")),
      ]);
      expect(tables).toHaveLength(3);
      expect(tables[2][0]).toEqual(["Company", "Standard Bank"]);
    });

    it("keeps a duties list that continues on the next page in one cell", () => {
      const { tables } = tablesFromPdfPages([
        page(
          run("EMPLOYMENT HISTORY", 240, 780, { h: LABEL }),
          run("Company", 78.3, 720, { h: HEADER }),
          run("Tower Group", 236.7, 721.4),
          run("Duties:", 78.3, 700),
          run("", 96.3, 689, { w: 4.2 }),
          run("First duty", 114.3, 689),
        ),
        page(run("", 96.3, 760, { w: 4.2 }), run("Second duty", 114.3, 760)),
      ]);
      expect(tables[1]).toEqual([
        ["Company", "Tower Group"],
        ["Duties:\nFirst duty\nSecond duty"],
      ]);
    });

    it("lets a bullet printed at label size start a paragraph, never a row", () => {
      // One CV prints some bullets at 11pt. Label-sized runs at the left
      // edge start rows, which put the last duty of a block in a row of its
      // own.
      const { tables } = tablesFromPdfPages([
        page(
          run("EMPLOYMENT HISTORY", 240, 780, { h: LABEL }),
          run("Company", 78.3, 720, { h: HEADER }),
          run("Tower Group", 236.7, 721.4),
          run("Duties:", 78.3, 700),
          run("", 96.3, 689, { w: 4.2 }),
          run("First duty", 114.3, 689),
          run("", 96.3, 678, { w: 4.2, h: HEADER }),
          run("Second duty", 114.3, 678),
        ),
        page(run("Company", 78.3, 760, { h: HEADER }), run("Standard Bank", 236.7, 761.4)),
      ]);
      expect(tables[1]).toEqual([
        ["Company", "Tower Group"],
        ["Duties:\nFirst duty\nSecond duty"],
      ]);
      // The block that follows on the next page still opens on its label.
      expect(tables[2][0]).toEqual(["Company", "Standard Bank"]);
    });

    it("does not read justified duty text as columns", () => {
      // A justified line splits into word runs at arbitrary x. In a table
      // section those would bucket into columns; in duties they must not.
      const { tables } = tablesFromPdfPages([
        page(
          run("EMPLOYMENT HISTORY", 240, 780, { h: LABEL }),
          run("Company", 78.3, 720, { h: HEADER }),
          run("Tower Group", 236.7, 721.4),
          run("Duties:", 78.3, 700),
          run("Introduced", 78.3, 689),
          run("capability-based", 140, 689),
          run("planning into", 260, 689),
          run("engagement with", 420, 689, { eol: true }),
          run("teams", 78.3, 678),
        ),
      ]);
      expect(tables[1][1]).toEqual(["Duties:\nIntroduced capability-based planning into engagement with teams"]);
    });
  });

  it("ignores whitespace-only filler runs", () => {
    const { tables } = tablesFromPdfPages([
      page(
        run("FULL NAME (S)", 78, 757.9, { h: LABEL }),
        run("   ", 170, 758, { w: 90 }),
        run("Thandi Example", 265.1, 759.8),
      ),
    ]);
    expect(tables).toEqual([[["FULL NAME (S)", "Thandi Example"]]]);
  });

  it("returns nothing for an empty document rather than throwing", () => {
    expect(tablesFromPdfPages([])).toEqual({ tables: [], coverAsOf: null, hadCover: false });
    expect(tablesFromPdfPages([page()])).toEqual({ tables: [], coverAsOf: null, hadCover: false });
  });
});

describe("pdfItemsFrom", () => {
  it("unpacks a pdf.js text item", () => {
    const items = pdfItemsFrom([
      { str: "Hello", transform: [9.1, 0, 0, 9.1, 78.3, 700], width: 20, height: 9.1, hasEOL: true },
    ]);
    expect(items).toEqual([{ str: "Hello", x: 78.3, y: 700, width: 20, height: 9.1, hasEOL: true }]);
  });

  it("drops anything that is not a text item", () => {
    expect(pdfItemsFrom([null, 42, { type: "beginMarkedContent" }, { str: "x" }])).toEqual([]);
  });
});
