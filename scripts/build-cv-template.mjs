/**
 * Build the docxtemplater template from a real TiPP Focus CV.
 *
 *   node scripts/build-cv-template.mjs "<source .docx>" [output .docx]
 *
 * Takes one of the CVs the business actually sends out, strips the candidate's
 * content, and puts placeholder tags in its place. Everything else in the file
 * is left byte-for-byte alone, so the logo, page headers, fonts, table borders
 * and theme are the real ones rather than an imitation. That matters because
 * the output goes to a client with a bid.
 *
 * Kept in the repo rather than run once and forgotten, so a new version of the
 * template can be rebuilt instead of hand-patched.
 *
 * Cells are located by the label beside them, never by index, so reordering a
 * row in Word does not silently move a tag to the wrong field. Anything that
 * cannot be placed is reported and the script exits non-zero, because a
 * template that is quietly missing a field is worse than no template.
 */
import PizZip from "pizzip";
import fs from "node:fs";
import path from "node:path";

const SOURCE = process.argv[2];
const OUTPUT =
  process.argv[3] ?? path.join("src", "lib", "cv-export", "tipp-focus-template.docx");

if (!SOURCE) {
  console.error("usage: node scripts/build-cv-template.mjs <source.docx> [output.docx]");
  process.exit(1);
}

const RUN_RE = /<w:t[^>]*>([^<]*)<\/w:t>/g;
const TABLE_RE = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
const ROW_RE = /<w:tr[\s>][\s\S]*?<\/w:tr>/g;
const CELL_RE = /<w:tc>[\s\S]*?<\/w:tc>/g;

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
 * Replace a cell's content with the given paragraphs, keeping its formatting.
 *
 * The cell's own properties, the first paragraph's properties and the first
 * run's properties are all carried over, which is what preserves borders,
 * shading, alignment, font and weight. Everything after that is discarded,
 * since it belongs to the candidate being stripped out.
 */
function setCellParagraphs(tc, paragraphs) {
  const tcPr = firstMatch(tc, /<w:tcPr>[\s\S]*?<\/w:tcPr>/) ?? "";
  const firstP = firstMatch(tc, /<w:p\b[\s\S]*?<\/w:p>/) ?? "<w:p></w:p>";
  const pPr = firstMatch(firstP, /<w:pPr>[\s\S]*?<\/w:pPr>/) ?? "";
  const rPr = firstMatch(firstP, /<w:rPr>[\s\S]*?<\/w:rPr>/) ?? "";

  const body = paragraphs
    .map(
      (text) =>
        `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`,
    )
    .join("");

  return `<w:tc>${tcPr}${body}</w:tc>`;
}

/** Rewrite one cell of a row, found by position, leaving the rest untouched. */
function setRowCell(tr, index, paragraphs) {
  let i = 0;
  return tr.replace(CELL_RE, (tc) => (i++ === index ? setCellParagraphs(tc, paragraphs) : tc));
}

const placed = new Set();
function markPlaced(name) {
  placed.add(name);
}

// ---------------------------------------------------------------------------

const zip = new PizZip(fs.readFileSync(SOURCE));
const original = zip.file("word/document.xml").asText();

/** Header rows: the label in the left cell decides the tag in the right cell. */
const HEADER_TAGS = [
  [/^FULL NAME/i, "{full_name}", "full_name"],
  [/^POSITION/i, "{position}", "position"],
  [/^DESIGNATED GROUP/i, "{designated_group}", "designated_group"],
  [/^LANGUAGES/i, "{languages}", "languages"],
  [/^AVAILABILITY/i, "{availability}", "availability"],
];

const SECTION_HEADINGS = [
  "CANDIDATE SUMMARY",
  "CAREER SUMMARY",
  "QUALIFICATION",
  "CERTIFICATES AND COURSES",
  "SKILLS",
  "EMPLOYMENT RECORD",
];

const isHeaderRun = (cells, words) =>
  cells.length >= words.length && words.every((w, i) => cells[i].toUpperCase() === w);

/**
 * Which employment block to keep as the repeating one.
 *
 * Not simply the first: the Client row is optional in the source document, and
 * the first block often omits it. A template built from that block could never
 * show a client on any job, and on a bid the client is frequently the most
 * relevant thing about a placement. So prefer the first block that has one.
 */
function preferredEmploymentIndex(xml) {
  const blocks = [];
  let seenHeading = false;

  for (const tbl of xml.match(TABLE_RE) ?? []) {
    const cells = (tbl.match(ROW_RE) ?? []).map((tr) => (tr.match(CELL_RE) ?? []).map(cellText));
    const flat = cells.flat().join(" ").toUpperCase();

    if (cells.length === 1 && cells[0].length === 1 && flat === "EMPLOYMENT RECORD") {
      seenHeading = true;
      continue;
    }
    if (!seenHeading) continue;
    if (!/^company$/i.test(cells[0]?.[0] ?? "")) continue;

    blocks.push(cells.some((row) => /^client$/i.test((row[0] ?? "").replace(/[:\s]+$/, ""))));
  }

  const withClient = blocks.indexOf(true);
  return withClient >= 0 ? withClient : 0;
}

const wantedEmployment = preferredEmploymentIndex(original);

let lastHeading = null;
let employmentIndex = -1;

const rebuilt = original.replace(TABLE_RE, (tbl) => {
  const rows = tbl.match(ROW_RE) ?? [];
  const rowCells = rows.map((tr) => (tr.match(CELL_RE) ?? []).map(cellText));

  // A single-cell table whose text is a known heading is a section divider.
  if (rows.length === 1 && rowCells[0].length === 1) {
    const text = rowCells[0][0].toUpperCase();
    const heading = SECTION_HEADINGS.find((h) => text === h);
    if (heading) {
      lastHeading = heading;
      return tbl;
    }

    // The cell immediately after a heading holds that section's free content.
    if (lastHeading === "CANDIDATE SUMMARY") {
      lastHeading = null;
      markPlaced("summary");
      return tbl.replace(CELL_RE, (tc) => setCellParagraphs(tc, ["{summary}"]));
    }
    if (lastHeading === "SKILLS") {
      lastHeading = null;
      markPlaced("skills");
      // Three paragraphs, so docxtemplater repeats the middle one per skill.
      return tbl.replace(CELL_RE, (tc) =>
        setCellParagraphs(tc, ["{#skills}", "{.}", "{/skills}"]),
      );
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
      return setRowCell(tr, 1, [hit[1]]);
    });
  }

  // --- Career summary ------------------------------------------------------
  if (isHeaderRun(rowCells[0] ?? [], ["COMPANY", "POSITION", "DURATION"])) {
    markPlaced("career");
    return buildLoopTable(tbl, rows, "career", ["{company}", "{role}", "{duration}"]);
  }

  // --- Qualifications and certificates share a shape, so the heading decides -
  if (isHeaderRun(rowCells[0] ?? [], ["QUALIFICATION", "INSTITUTION", "YEAR"])) {
    const name = lastHeading === "CERTIFICATES AND COURSES" ? "certificates" : "education";
    markPlaced(name);
    return buildLoopTable(tbl, rows, name, ["{qualification}", "{institution}", "{year}"]);
  }

  // --- Employment record: one table per job, so the whole table repeats -----
  if (lastHeading === "EMPLOYMENT RECORD" && /^company$/i.test(rowCells[0]?.[0] ?? "")) {
    employmentIndex++;
    // Every other job in the source is discarded: the loop reproduces them.
    if (employmentIndex !== wantedEmployment) return "";
    markPlaced("employment");
    return buildEmploymentTable(tbl, rows, rowCells);
  }

  return tbl;
});

/** Keep the header row and one data row, wrap that row in a loop, drop the rest. */
function buildLoopTable(tbl, rows, loopName, tags) {
  if (rows.length < 2) {
    console.error(`  ! ${loopName}: expected a header row and at least one data row`);
    return tbl;
  }

  let dataRow = rows[1];
  tags.forEach((tag, i) => {
    dataRow = setRowCell(dataRow, i, [i === 0 ? `{#${loopName}}${tag}` : tag]);
  });
  // The closing tag goes in the last cell, so the loop spans the whole row.
  dataRow = setRowCell(dataRow, tags.length - 1, [`${tags[tags.length - 1]}{/${loopName}}`]);

  return tbl.replace(/<w:tbl>([\s\S]*?)<\/w:tbl>/, (_all, inner) => {
    const upToFirstRow = inner.slice(0, inner.indexOf(rows[0]));
    return `<w:tbl>${upToFirstRow}${rows[0]}${dataRow}</w:tbl>`;
  });
}

/**
 * The employment block is a table per job, so the loop has to wrap the table
 * rather than a row. Paragraphs carrying the tags sit either side of it.
 */
function buildEmploymentTable(tbl, rows, rowCells) {
  const LABEL_TAGS = {
    company: "{company}",
    client: "{client}",
    role: "{role}",
    duration: "{duration}",
  };

  let i = 0;
  const body = tbl.replace(ROW_RE, (tr) => {
    const cells = rowCells[i++];
    const label = (cells[0] ?? "").replace(/[:\s]+$/, "").toLowerCase();

    if (LABEL_TAGS[label] && cells.length >= 2) {
      // The Client row only renders when there is a client, otherwise a bid
      // document carries an empty labelled row. has_client is an array of zero
      // or one entries, so the row repeats that many times.
      if (label === "client") {
        const opened = setRowCell(tr, 0, ["{#has_client}Client"]);
        return setRowCell(opened, 1, ["{client}{/has_client}"]);
      }
      return setRowCell(tr, 1, [LABEL_TAGS[label]]);
    }

    // The duties cell keeps its "Duties:" label and repeats a line per duty.
    if (/^duties/i.test(cells[0] ?? "")) {
      return tr.replace(CELL_RE, (tc) =>
        setCellParagraphs(tc, ["Duties:", "{#duties}", "{.}", "{/duties}"]),
      );
    }
    return tr;
  });

  const open = `<w:p><w:r><w:t xml:space="preserve">{#employment}</w:t></w:r></w:p>`;
  const close = `<w:p><w:r><w:t xml:space="preserve">{/employment}</w:t></w:r></w:p>`;
  return `${open}${body}${close}`;
}

// ---------------------------------------------------------------------------

const REQUIRED = [
  "full_name",
  "position",
  "designated_group",
  "languages",
  "availability",
  "summary",
  "career",
  "education",
  "certificates",
  "skills",
  "employment",
];

const missing = REQUIRED.filter((r) => !placed.has(r));
if (missing.length > 0) {
  console.error("Could not place tags for:", missing.join(", "));
  console.error("The source document is not the expected template. Nothing written.");
  process.exit(1);
}

zip.file("word/document.xml", rebuilt);
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));

console.log("Placed tags:", [...placed].sort().join(", "));
console.log("Wrote", OUTPUT);
