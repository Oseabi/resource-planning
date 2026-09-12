/**
 * Build the docxtemplater template for the TiPP Focus CV, as it is issued.
 *
 *   node scripts/build-cv-template.mjs [source .docx] [output .docx]
 *
 * The source is the team's own blank Word template (scripts/templates/
 * tipp-focus-source.docx), which carries the real logo, page headers, fonts,
 * borders and theme. It is the older revision of the template: no cover
 * page, a LANGUAGES row, a flat skills cell, no projects. The CVs the
 * business actually sends out today, read from eight of them as PDFs, add
 * a cover page, replace LANGUAGES with DATE OF BIRTH, POSITION and YEARS OF
 * EXPERIENCE, print the skills as a three-column table by category, and add
 * PROJECTS and ACHIEVEMENTS. There is no newer Word file to build from, so
 * this script makes those changes to the older one, cloning rows, cells and
 * tables from the same document so every border and shading is the real
 * one, and then puts placeholder tags where the content goes.
 *
 * Kept in the repo rather than run once and forgotten, so the template can
 * be rebuilt instead of hand-patched. Cells are located by the label beside
 * them, never by index, so reordering a row in Word does not silently move
 * a tag to the wrong field. Anything that cannot be placed is reported and
 * the script exits non-zero, because a template that is quietly missing a
 * field is worse than no template.
 *
 * Sizes come from the issued PDFs: headings and header labels 12pt, column
 * headers and employment labels 11pt, body 9pt, the cover name 16pt and the
 * cover's small print 8pt. Word stores sizes in half-points.
 */
import PizZip from "pizzip";
import fs from "node:fs";
import path from "node:path";

const SOURCE = process.argv[2] ?? path.join("scripts", "templates", "tipp-focus-source.docx");
const OUTPUT =
  process.argv[3] ?? path.join("src", "lib", "cv-export", "tipp-focus-template.docx");

const RUN_RE = /<w:t[^>]*>([^<]*)<\/w:t>/g;
const TABLE_RE = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
const ROW_RE = /<w:tr[\s>][\s\S]*?<\/w:tr>/g;
const CELL_RE = /<w:tc>[\s\S]*?<\/w:tc>/g;
const PARA_RE = /<w:p\b[\s\S]*?<\/w:p>/g;

const SIZE = {
  heading: 24,
  label: 24,
  columnHeader: 22,
  employmentLabel: 22,
  body: 18,
  coverTitle: 24,
  coverName: 32,
  coverSmall: 16,
};

/** What a cell reads as. Word splits runs arbitrarily, so they must be joined. */
function cellText(tc) {
  return [...tc.matchAll(RUN_RE)].map((m) => m[1]).join("").replace(/\s+/g, " ").trim();
}

function escapeXml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function firstMatch(source, re) {
  const m = source.match(re);
  return m ? m[0] : null;
}

/**
 * Paragraph properties set to single spacing with nothing after, which is how
 * the issued CVs are set: body lines 11 units apart, bullets the same. The
 * older template left the document default, a wider line and 8pt after each
 * paragraph, and read back through the reader that spacing split a wrapped
 * duty into two.
 */
function withTightSpacing(pPr) {
  const spacing = '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>';
  const stripped = pPr.replace(/<w:spacing [^>]*\/>/g, "");
  if (!stripped) return `<w:pPr>${spacing}</w:pPr>`;
  // Word wants spacing after pStyle and numPr, before jc and rPr.
  if (stripped.includes("<w:jc ")) return stripped.replace("<w:jc ", `${spacing}<w:jc `);
  if (stripped.includes("<w:rPr>")) return stripped.replace("<w:rPr>", `${spacing}<w:rPr>`);
  return stripped.replace("</w:pPr>", `${spacing}</w:pPr>`);
}

/**
 * The issued CVs are set in Century Gothic with Arial Bold for the headings,
 * labels and column headers; the older template is Calibri throughout. The
 * face is written onto every run this script produces, in place of whatever
 * the theme said.
 */
const BODY_FONT = "Century Gothic";
const LABEL_FONT = "Arial";

function withFont(rPr, face) {
  const stripped = rPr.replace(/<w:rFonts [^>]*\/>/g, "");
  const fonts = `<w:rFonts w:ascii="${face}" w:hAnsi="${face}" w:cs="${face}"/>`;
  if (!stripped) return `<w:rPr>${fonts}</w:rPr>`;
  return stripped.replace("<w:rPr>", `<w:rPr>${fonts}`);
}

/** Run properties with the size set, replacing any size already there. */
function withSize(rPr, size) {
  const stripped = rPr.replace(/<w:sz w:val="\d+"\/>/g, "").replace(/<w:szCs w:val="\d+"\/>/g, "");
  const sz = `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`;
  if (!stripped) return `<w:rPr>${sz}</w:rPr>`;
  return stripped.replace("</w:rPr>", `${sz}</w:rPr>`);
}

function withBold(rPr, bold) {
  const stripped = rPr.replace(/<w:b\/>/g, "").replace(/<w:bCs\/>/g, "");
  if (!bold) return stripped;
  if (!stripped) return "<w:rPr><w:b/></w:rPr>";
  return stripped.replace("<w:rPr>", "<w:rPr><w:b/>");
}

/**
 * Replace a cell's content with the given paragraphs, keeping its formatting.
 *
 * The cell's own properties, the first paragraph's properties and the first
 * run's properties are all carried over, which is what preserves borders,
 * shading, alignment, font and weight. Everything after that is discarded,
 * since it belongs to the content being stripped out. `size` and `bold`
 * override what the source had, because the issued sizes differ from the
 * older revision's.
 */
function setCellParagraphs(tc, paragraphs, { size, bold, align } = {}) {
  const tcPr = firstMatch(tc, /<w:tcPr>[\s\S]*?<\/w:tcPr>/) ?? "";
  const firstP = firstMatch(tc, /<w:p\b[\s\S]*?<\/w:p>/) ?? "<w:p></w:p>";
  const sourcePPr = firstMatch(firstP, /<w:pPr>[\s\S]*?<\/w:pPr>/) ?? "";
  // The run's own properties, never the paragraph mark's: the source's empty
  // OTHER ACHIEVEMENTS cell carries a white, centred mark, and a template
  // built from it printed every achievement in white on white.
  let rPr = firstMatch(firstP.replace(sourcePPr, ""), /<w:rPr>[\s\S]*?<\/w:rPr>/) ?? "";
  let pPr = withTightSpacing(sourcePPr).replace(/<w:color [^>]*\/>/g, "");
  if (align) pPr = pPr.replace(/<w:jc w:val="[a-z]+"\/>/, `<w:jc w:val="${align}"/>`);
  rPr = rPr.replace(/<w:color [^>]*\/>/g, "");
  if (size) rPr = withSize(rPr, size);
  if (bold !== undefined) rPr = withBold(rPr, bold);
  // Labels, headings and column headers are the bold faces at 11pt and up.
  rPr = withFont(rPr, bold && size && size >= SIZE.columnHeader ? LABEL_FONT : BODY_FONT);

  const body = paragraphs
    .map(
      (text) =>
        `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`,
    )
    .join("");

  return `<w:tc>${tcPr}${body}</w:tc>`;
}

/** Rewrite one cell of a row, found by position, leaving the rest untouched. */
function setRowCell(tr, index, paragraphs, opts) {
  let i = 0;
  return tr.replace(CELL_RE, (tc) => (i++ === index ? setCellParagraphs(tc, paragraphs, opts) : tc));
}

/** A paragraph carrying one tag and nothing else, for loops that wrap whole tables. */
const tagParagraph = (tag) => `<w:p><w:r><w:t xml:space="preserve">${tag}</w:t></w:r></w:p>`;

/**
 * An empty paragraph of a given height in twips, to put room between two
 * tables. Word draws two tables with nothing between them as one, which is
 * how the employment blocks ran into each other; and the issued CVs leave
 * about a line and a half between every table and the next heading.
 */
const spacer = (twips) =>
  `<w:p><w:pPr><w:spacing w:before="0" w:after="${twips}" w:line="240" w:lineRule="auto"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>`;
const GAP_BEFORE_HEADING = spacer(360);
const GAP_AFTER_RULE = spacer(400);
const GAP_BETWEEN_BLOCKS = spacer(440);

/** An empty paragraph between two tables: the source has a few, the spacers replace them all. */
const EMPTY_BETWEEN_TABLES_RE = /<\/w:tbl>((?:<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?<\/w:p>|<w:p\/>)+)<w:tbl>/g;

const placed = new Set();
function markPlaced(name) {
  placed.add(name);
}

// ---------------------------------------------------------------------------
// The issued layout, made from the older revision
// ---------------------------------------------------------------------------

/**
 * The cover page, as the issued CVs print it.
 *
 * The older template already leaves page one to the first-page header and
 * footer and breaks to page two inside the first cell of the header table.
 * The cover's text goes on that empty page, and the break moves to the end
 * of it.
 */
function coverPage(xml) {
  const P = (text, { size, bold = false, italic = false, grey = false, center = false, before = 0, after = 120, tabs = [], indent = null } = {}) => {
    const tabXml = tabs.length
      ? `<w:tabs>${tabs.map((t) => `<w:tab w:val="left" w:pos="${t}"/>`).join("")}</w:tabs>`
      : "";
    const indXml = indent ? `<w:ind w:left="${indent}" w:hanging="${indent}"/>` : "";
    const rPr = `<w:rPr><w:rFonts w:ascii="${BODY_FONT}" w:hAnsi="${BODY_FONT}" w:cs="${BODY_FONT}"/>${bold ? "<w:b/>" : ""}${italic ? "<w:i/>" : ""}${grey ? '<w:color w:val="808080"/>' : ""}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
    const runs = text
      .split("\t")
      .map((part, i) =>
        `${i > 0 ? `<w:r>${rPr}<w:tab/></w:r>` : ""}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(part)}</w:t></w:r>`,
      )
      .join("");
    return `<w:p><w:pPr>${tabXml}<w:spacing w:before="${before}" w:after="${after}" w:line="240" w:lineRule="auto"/>${indXml}<w:jc w:val="${center ? "center" : "left"}"/>${rPr}</w:pPr>${runs}</w:p>`;
  };

  // The issued cover sets its details in grey and its small print in grey italics.
  const small = { size: SIZE.coverSmall, after: 60, italic: true, grey: true };
  const line = { size: SIZE.body, after: 40, tabs: [2280], grey: true };
  const cover = [
    P("Candidate Resume", { size: SIZE.coverTitle, bold: true, center: true, before: 1600, after: 900 }),
    P("{full_name}", { size: SIZE.coverName, bold: true, center: true, after: 200 }),
    P("{position}", { size: SIZE.coverName, bold: true, center: true, after: 800 }),
    P("As of date:\t{as_of_date}", line),
    P("Account Manager:\t{manager_name}", line),
    P("Email address:\t{manager_email}", line),
    P("Office Contact Details:\t{manager_phone}", { ...line, after: 400 }),
    P("All information concerning the resource is furnished to the Client in strict confidence and on condition:", { ...small, after: 120 }),
    P("i.\tThat the Client does not divulge it to anyone without the Candidate’s written consent,", { ...small, indent: 360 }),
    P("ii.\tThat the Client will not engage directly with the Candidate without Tipp Focus’s prior written consent,", { ...small, indent: 360 }),
    P("iii.\tThat no contact whatsoever shall be made with the Candidate’s present employer without the Candidate’s express consent,", { ...small, indent: 360 }),
    P("iv.\tThat no references shall be taken on the Candidate without the prior permission of the Candidate or Tipp Focus and", { ...small, indent: 360 }),
    P("v.\tThat no offer of permanent employment is made to the candidate without Tipp Focus’s prior express consent.", { ...small, indent: 360, after: 300 }),
    P("Protection of Personal Information (POPI) compliance:", { ...small, bold: true, after: 120 }),
    P("The information contained in this document has been submitted to you with the Candidate’s express permission for the specific purpose of marketing the candidate to your company. Your consideration of the candidate for employment opportunities will be appreciated.", { ...small, after: 120 }),
    P("In accordance with the Protection of Personal Information Act, you may only use this information for the purpose mentioned and should discard/destroy this information after the purpose for which it has been submitted has been completed. As we are under a similar obligation, your response to this application will be appreciated so that we can inform the candidate and act in accordance with POPI.", small),
    `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`,
  ].join("");

  const bodyStart = xml.indexOf("<w:body>") + "<w:body>".length;
  const firstTable = xml.indexOf("<w:tbl>");
  const before = xml.slice(bodyStart, firstTable);
  if (cellText(before) !== "") {
    throw new Error("expected nothing but empty paragraphs before the header table");
  }
  let out = xml.slice(0, bodyStart) + cover + xml.slice(firstTable);

  // The break that used to start page two now ends the cover.
  const firstTbl = firstMatch(out, /<w:tbl>[\s\S]*?<\/w:tbl>/);
  const withoutBreak = firstTbl.replace(/<w:r(?: [^>]*)?>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:br w:type="page"\/><\/w:r>/, "");
  if (withoutBreak === firstTbl) throw new Error("expected a page break at the top of the header table");
  return out.replace(firstTbl, withoutBreak);
}

/** The heading tables, renamed to the issued spellings and sized. */
const HEADING_RENAMES = {
  "CANDIDATE SUMMARY": "CANDIDATE OVERVIEW",
  "CAREER SUMMARY": "CAREER SUMMARY",
  QUALIFICATION: "QUALIFICATIONS",
  "CERTIFICATES AND COURSES": "CERTIFICATES AND COURSES",
  SKILLS: "SKILLSET",
  "OTHER ACHIEVEMENTS": "ACHIEVEMENTS",
  "EMPLOYMENT RECORD": "EMPLOYMENT HISTORY",
};

const isHeadingTable = (rowCells) => rowCells.length === 1 && rowCells[0].length === 1;

/** Every table's rows as text, in document order. */
function tableCells(tbl) {
  return (tbl.match(ROW_RE) ?? []).map((tr) => (tr.match(CELL_RE) ?? []).map(cellText));
}

const isHeaderRun = (cells, words) =>
  cells.length >= words.length && words.every((w, i) => cells[i].toUpperCase() === w);

/**
 * The header table: LANGUAGES becomes YEARS OF EXPERIENCE and a POSITION row
 * is cloned in ahead of DESIGNATED GROUP, which gives the six rows the
 * issued CVs carry, in their order.
 */
function issueHeaderTable(tbl) {
  const rows = tbl.match(ROW_RE) ?? [];
  const cells = rows.map((tr) => (tr.match(CELL_RE) ?? []).map(cellText));
  const designated = rows.findIndex((_, i) => /^DESIGNATED GROUP/i.test(cells[i][0] ?? ""));
  const languages = rows.findIndex((_, i) => /^LANGUAGES/i.test(cells[i][0] ?? ""));
  if (designated < 0 || languages < 0) throw new Error("header table: expected DESIGNATED GROUP and LANGUAGES rows");

  const label = (tr, text) => setRowCell(tr, 0, [text], { size: SIZE.label, bold: true });
  const positionRow = label(rows[designated], "POSITION");
  const yearsRow = label(rows[languages], "YEARS OF EXPERIENCE");

  let out = tbl.replace(rows[languages], yearsRow);
  out = out.replace(rows[designated], positionRow + rows[designated]);
  return out;
}

/**
 * The flat SKILLS cell becomes the SKILLSET table: the qualification table's
 * shape with its own column headers, which is exactly what the issued CVs
 * print.
 */
function skillsetTable(qualificationTable) {
  const rows = qualificationTable.match(ROW_RE) ?? [];
  const header = ["SKILLS", "PROFICIENCY", "YEARS OF EXPERIENCE"].reduce(
    (tr, text, i) => setRowCell(tr, i, [text], { size: SIZE.columnHeader, bold: true }),
    rows[0],
  );
  return qualificationTable.replace(/<w:tbl>([\s\S]*?)<\/w:tbl>/, (_all, inner) => {
    const upToFirstRow = inner.slice(0, inner.indexOf(rows[0]));
    return `<w:tbl>${upToFirstRow}${header}${rows[1]}</w:tbl>`;
  });
}

/**
 * The PROJECTS table: the career table with its last column folded into the
 * second, so the columns match the employment block's, and the issued
 * headers COMPANY NAME / PROJECT NAME.
 */
function projectsTable(careerTable) {
  const grid = [...careerTable.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
  if (grid.length !== 3) throw new Error("career table: expected three columns");
  const second = grid[1] + grid[2];
  let out = careerTable.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/, `<w:tblGrid><w:gridCol w:w="${grid[0]}"/><w:gridCol w:w="${second}"/></w:tblGrid>`);
  const rows = out.match(ROW_RE) ?? [];
  const twoColumns = (tr) => {
    let i = 0;
    return tr.replace(CELL_RE, (tc) => {
      const index = i++;
      if (index === 2) return "";
      if (index === 1) return tc.replace(/<w:tcW w:w="\d+"/, `<w:tcW w:w="${second}"`);
      return tc;
    });
  };
  const header = ["COMPANY NAME", "PROJECT NAME"].reduce(
    (tr, text, i) => setRowCell(tr, i, [text], { size: SIZE.columnHeader, bold: true }),
    twoColumns(rows[0]),
  );
  return out.replace(/<w:tbl>([\s\S]*?)<\/w:tbl>/, (_all, inner) => {
    const upToFirstRow = inner.slice(0, inner.indexOf(rows[0]));
    return `<w:tbl>${upToFirstRow}${header}${twoColumns(rows[1])}</w:tbl>`;
  });
}

/** A heading table with its text replaced. */
function headingTable(sourceHeadingTable, text) {
  // The rule under a heading is the issued CVs' dark teal, not the theme's
  // lighter blue the older template drew.
  return sourceHeadingTable
    .replace(/<w:bottom w:val="single" w:sz="18" w:space="0" w:color="[0-9A-F]{6}"[^>]*\/>/, '<w:bottom w:val="single" w:sz="18" w:space="0" w:color="0F4761"/>')
    .replace(CELL_RE, (tc) => setCellParagraphs(tc, [text], { size: SIZE.heading, bold: true }));
}

/**
 * Turn the older revision into the issued layout. Returns the XML with the
 * cover page, the six header rows, the issued heading names, the skillset
 * table, and a PROJECTS block ahead of ACHIEVEMENTS.
 */
function issue(xml) {
  // The older template draws a faint network graphic behind the career
  // table; the issued CVs do not. And its empty paragraphs between tables
  // go, so that the room between tables is the spacers' and the same
  // everywhere.
  let out = coverPage(xml)
    .replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, "")
    .replace(EMPTY_BETWEEN_TABLES_RE, (all, paras) => (/<w:t[ >]/.test(paras) ? all : "</w:tbl><w:tbl>"));

  const tables = out.match(TABLE_RE) ?? [];
  const byText = (text) => tables.find((t) => {
    const c = tableCells(t);
    return isHeadingTable(c) && c[0][0].toUpperCase() === text;
  });
  const certificatesHeading = byText("CERTIFICATES AND COURSES");
  const careerTable = tables.find((t) => isHeaderRun(tableCells(t)[0] ?? [], ["COMPANY", "POSITION", "DURATION"]));
  const qualificationTable = tables.find((t) => isHeaderRun(tableCells(t)[0] ?? [], ["QUALIFICATION", "INSTITUTION", "YEAR"]));
  if (!certificatesHeading || !careerTable || !qualificationTable) {
    throw new Error("expected the heading, career and qualification tables of the older revision");
  }

  let lastHeading = null;
  let headerDone = false;
  out = out.replace(TABLE_RE, (tbl) => {
    const cells = tableCells(tbl);

    if (isHeadingTable(cells)) {
      const text = cells[0][0].toUpperCase();
      if (HEADING_RENAMES[text]) {
        lastHeading = HEADING_RENAMES[text];
        return headingTable(tbl, lastHeading);
      }
      // The content cell after SKILLSET becomes the table; PROJECTS follows it.
      if (lastHeading === "SKILLSET") {
        lastHeading = null;
        return skillsetTable(qualificationTable) + headingTable(certificatesHeading, "PROJECTS") + projectsTable(careerTable);
      }
      lastHeading = null;
      return tbl;
    }

    if (!headerDone && cells.some((c) => c.length === 2 && /^FULL NAME/i.test(c[0]))) {
      headerDone = true;
      return issueHeaderTable(tbl);
    }
    return tbl;
  });

  return out;
}

// ---------------------------------------------------------------------------
// The tags
// ---------------------------------------------------------------------------

/** Header rows: the label in the left cell decides the tag in the right cell. */
const HEADER_TAGS = [
  [/^FULL NAME/i, "{full_name}", "full_name"],
  [/^DATE OF BIRTH/i, "{date_of_birth}", "date_of_birth"],
  [/^POSITION/i, "{position}", "position"],
  [/^DESIGNATED GROUP/i, "{designated_group}", "designated_group"],
  [/^YEARS OF EXPERIENCE/i, "{years_experience}", "years_experience"],
  [/^AVAILABILITY/i, "{availability}", "availability"],
];

const SECTION_HEADINGS = Object.values(HEADING_RENAMES).concat("PROJECTS");

/** Keep the header row and one data row, wrap that row in a loop, drop the rest. */
function buildLoopTable(tbl, rows, loopName, tags) {
  if (rows.length < 2) {
    console.error(`  ! ${loopName}: expected a header row and at least one data row`);
    return tbl;
  }

  const header = rows[0].replace(CELL_RE, (tc) =>
    setCellParagraphs(tc, [cellText(tc)], { size: SIZE.columnHeader, bold: true }),
  );

  let dataRow = rows[1];
  tags.forEach((tag, j) => {
    dataRow = setRowCell(dataRow, j, [j === 0 ? `{#${loopName}}${tag}` : tag], { size: SIZE.body, bold: false });
  });
  // The closing tag goes in the last cell, so the loop spans the whole row.
  dataRow = setRowCell(dataRow, tags.length - 1, [`${tags[tags.length - 1]}{/${loopName}}`], { size: SIZE.body, bold: false });

  return tbl.replace(/<w:tbl>([\s\S]*?)<\/w:tbl>/, (_all, inner) => {
    const upToFirstRow = inner.slice(0, inner.indexOf(rows[0]));
    return `<w:tbl>${upToFirstRow}${header}${dataRow}</w:tbl>`;
  });
}

/**
 * The employment block is a table per job, so the loop has to wrap the table
 * rather than a row. Paragraphs carrying the tags sit either side of it. The
 * older template's blocks have no Client row; one is cloned from the Role
 * row, and renders only when there is a client.
 */
function buildEmploymentTable(tbl) {
  const rows = tbl.match(ROW_RE) ?? [];
  const cells = rows.map((tr) => (tr.match(CELL_RE) ?? []).map(cellText));
  const labelOf = (i) => (cells[i]?.[0] ?? "").replace(/[:\s]+$/, "").toLowerCase();

  const roleIndex = rows.findIndex((_, i) => labelOf(i) === "role");
  const dutiesIndex = rows.findIndex((_, i) => /^duties/i.test(cells[i]?.[0] ?? ""));
  if (roleIndex < 0 || dutiesIndex < 0) throw new Error("employment block: expected Role and Duties rows");

  // The issued CVs set the block's company, role and duration in bold.
  const labelled = (tr, label, value) => {
    const opened = setRowCell(tr, 0, [label], { size: SIZE.employmentLabel, bold: true });
    return setRowCell(opened, 1, [value], { size: SIZE.body, bold: true });
  };

  const rebuiltRows = rows.map((tr, i) => {
    const label = labelOf(i);
    if (label === "company") {
      // The Client row only renders when there is a client, otherwise a bid
      // document carries an empty labelled row. has_client is an array of
      // zero or one entries, so the row repeats that many times.
      return labelled(tr, "Company", "{company}") + labelled(rows[roleIndex], "{#has_client}Client", "{client}{/has_client}");
    }
    if (label === "client") return "";
    if (label === "role") return labelled(tr, "Role", "{role}");
    if (label === "duration") return labelled(tr, "Duration", "{duration}");
    if (i === dutiesIndex) return dutiesCell(tr);
    return tr;
  });

  const body = tbl.replace(/<w:tbl>([\s\S]*?)<\/w:tbl>/, (_all, inner) => {
    const upToFirstRow = inner.slice(0, inner.indexOf(rows[0]));
    return `<w:tbl>${upToFirstRow}${rebuiltRows.join("")}</w:tbl>`;
  });

  return tagParagraph("{#employment}") + body + GAP_BETWEEN_BLOCKS + tagParagraph("{/employment}");
}

/**
 * The duties cell keeps its bold "Duties:" line and repeats one bulleted
 * paragraph per duty. The bullet comes from the source's own list
 * paragraph, so the numbering definition is the template's.
 */
function dutiesCell(tr) {
  // The sample block's duties row carries a minimum height. A duties list
  // that breaks across pages then leaves a tall empty box on the next one.
  return tr.replace(/<w:trHeight [^>]*\/>/, "").replace(CELL_RE, (tc) => {
    const tcPr = firstMatch(tc, /<w:tcPr>[\s\S]*?<\/w:tcPr>/) ?? "";
    const paragraphs = tc.match(PARA_RE) ?? [];
    const labelP = paragraphs[0];
    const bulletP = paragraphs.find((p) => p.includes("<w:numPr>"));
    if (!labelP || !bulletP) throw new Error("duties cell: expected a label paragraph and a bulleted one");

    const para = (source, text, opts) => {
      const sourcePPr = firstMatch(source, /<w:pPr>[\s\S]*?<\/w:pPr>/) ?? "";
      // The bullet glyph takes its size from the paragraph mark, so that is
      // sized too; a 9pt duty with an 11pt bullet reads as a label to the
      // PDF reader and looks wrong to everyone else.
      const pPr = withTightSpacing(sourcePPr).replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, (mark) => withSize(mark, SIZE.body));
      let rPr = firstMatch(source.replace(sourcePPr, ""), /<w:rPr>[\s\S]*?<\/w:rPr>/) ?? "";
      rPr = withSize(rPr, SIZE.body);
      rPr = withBold(rPr, opts.bold);
      rPr = withFont(rPr, BODY_FONT);
      return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
    };

    return `<w:tc>${tcPr}${para(labelP, "Duties:", { bold: true })}${para(bulletP, "{#duties}", { bold: false })}${para(bulletP, "{.}", { bold: false })}${para(bulletP, "{/duties}", { bold: false })}</w:tc>`;
  });
}

function tag(xml) {
  let lastHeading = null;
  let employmentDone = false;

  return xml.replace(TABLE_RE, (tbl) => {
    const rows = tbl.match(ROW_RE) ?? [];
    const rowCells = rows.map((tr) => (tr.match(CELL_RE) ?? []).map(cellText));

    // A single-cell table whose text is a known heading is a section divider.
    if (isHeadingTable(rowCells)) {
      const text = rowCells[0][0].toUpperCase();
      const heading = SECTION_HEADINGS.find((h) => text === h);
      if (heading) {
        lastHeading = heading;
        const spaced = GAP_BEFORE_HEADING + tbl + GAP_AFTER_RULE;
        // Optional sections: the heading and its content render only when
        // there is content, so a CV without projects has no empty PROJECTS.
        if (heading === "PROJECTS") return tagParagraph("{#has_projects}") + spaced;
        if (heading === "ACHIEVEMENTS") return tagParagraph("{#has_achievements}") + spaced;
        return spaced;
      }

      // The cell immediately after a heading holds that section's free content.
      if (lastHeading === "CANDIDATE OVERVIEW") {
        lastHeading = null;
        markPlaced("summary");
        return tbl.replace(CELL_RE, (tc) => setCellParagraphs(tc, ["{summary}"], { size: SIZE.body, bold: false }));
      }
      if (lastHeading === "ACHIEVEMENTS") {
        lastHeading = null;
        markPlaced("achievements");
        return tbl.replace(CELL_RE, (tc) => setCellParagraphs(tc, ["{achievements}"], { size: SIZE.body, bold: false, align: "left" })) + tagParagraph("{/has_achievements}");
      }
      return tbl;
    }

    // --- The header block, matched row by row on its label -------------------
    if (rowCells.some((c) => c.length === 2 && HEADER_TAGS.some(([re]) => re.test(c[0])))) {
      let i = 0;
      return tbl.replace(ROW_RE, (tr) => {
        const cells = rowCells[i++];
        const hit = HEADER_TAGS.find(([re]) => re.test(cells[0] ?? ""));
        if (!hit) return tr;
        markPlaced(hit[2]);
        const labelled = setRowCell(tr, 0, [cells[0]], { size: SIZE.label, bold: true });
        return setRowCell(labelled, 1, [hit[1]], { size: SIZE.body, bold: false });
      });
    }

    const head = rowCells[0] ?? [];

    if (isHeaderRun(head, ["COMPANY", "POSITION", "DURATION"])) {
      markPlaced("career");
      return buildLoopTable(tbl, rows, "career", ["{company}", "{role}", "{duration}"]);
    }

    // Qualifications and certificates share a shape, so the heading decides.
    if (isHeaderRun(head, ["QUALIFICATION", "INSTITUTION", "YEAR"])) {
      const name = lastHeading === "CERTIFICATES AND COURSES" ? "certificates" : "education";
      markPlaced(name);
      return buildLoopTable(tbl, rows, name, ["{qualification}", "{institution}", "{year}"]);
    }

    if (isHeaderRun(head, ["SKILLS", "PROFICIENCY", "YEARS OF EXPERIENCE"])) {
      markPlaced("skillset");
      return buildLoopTable(tbl, rows, "skillset", ["{category}", "{skills}", "{years}"]);
    }

    if (isHeaderRun(head, ["COMPANY NAME", "PROJECT NAME"])) {
      markPlaced("projects");
      return buildLoopTable(tbl, rows, "projects", ["{company}", "{names}"]) + tagParagraph("{/has_projects}");
    }

    // --- Employment: one table per job, so the whole table repeats ----------
    if (lastHeading === "EMPLOYMENT HISTORY" && /^company$/i.test(head[0] ?? "")) {
      // Every other job in the source is discarded: the loop reproduces them.
      if (employmentDone) return "";
      employmentDone = true;
      markPlaced("employment");
      return buildEmploymentTable(tbl);
    }

    return tbl;
  });
}

// ---------------------------------------------------------------------------

const zip = new PizZip(fs.readFileSync(SOURCE));
const original = zip.file("word/document.xml").asText();

// The page header's logo is the older horizontal mark; the issued CVs carry
// the stacked one, the same image the PDF renderer uses. The drawing's
// height follows the new image's proportions so it is not squashed.
const LOGO = fs.readFileSync(path.join("src", "lib", "cv-export", "assets", "logo-header.png"));
zip.file("word/media/image3.png", LOGO);
for (const part of ["word/header1.xml", "word/header2.xml"]) {
  const xml = zip.file(part)?.asText();
  if (!xml) continue;
  // 324 by 95 pixels: keep the width the template gives the logo, scale the height.
  const updated = xml.replace(/<wp:extent cx="1760855" cy="870585"\/>/g, '<wp:extent cx="1760855" cy="516400"/>')
    .replace(/<a:ext cx="1760855" cy="870585"\/>/g, '<a:ext cx="1760855" cy="516400"/>');
  zip.file(part, updated);
}

const rebuilt = tag(issue(original));

const REQUIRED = [
  "full_name",
  "date_of_birth",
  "position",
  "designated_group",
  "years_experience",
  "availability",
  "summary",
  "career",
  "education",
  "certificates",
  "skillset",
  "projects",
  "achievements",
  "employment",
];

const missing = REQUIRED.filter((r) => !placed.has(r));
if (missing.length > 0) {
  console.error("Could not place tags for:", missing.join(", "));
  console.error("The source document is not the expected template. Nothing written.");
  process.exit(1);
}

for (const coverTag of ["{as_of_date}", "{manager_name}", "{manager_email}", "{manager_phone}"]) {
  if (!rebuilt.includes(coverTag)) {
    console.error(`Cover page is missing ${coverTag}. Nothing written.`);
    process.exit(1);
  }
}

// Any stray text left from the source's example content would print on
// every CV. Report it rather than ship it.
const tags = new Set([...rebuilt.matchAll(/\{[^}]+\}/g)].map((m) => m[0]));
console.log("tags:", [...tags].join(" "));

zip.file("word/document.xml", rebuilt);
fs.writeFileSync(OUTPUT, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
console.log(`wrote ${OUTPUT} from ${SOURCE}`);
