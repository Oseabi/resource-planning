/**
 * Recover a PDF's tables from the positions pdf.js gives every run of text.
 *
 * The TiPP Focus CV is entirely tables, and a PDF of it keeps a whole table
 * row on one line: "Morrison Co  Consultant Business Architect  September
 * 2024" with the columns only recoverable from where each word sits on the
 * page. The line reader in pdf-lines.ts throws those positions away, which is
 * why the template parser read the header of every issued CV and nothing
 * below it. This module keeps them, and produces the same DocumentTables that
 * mammoth produces for a .docx, so parseTippTables reads both formats and
 * there is one template parser rather than two.
 *
 * Three signals, all from the renderer, decide the structure:
 *
 *   Emission order    pdf.js emits a Word table cell by cell. A run whose
 *                     column is lower than the previous run's starts a new
 *                     row. This is what reconstructs a skills table whose
 *                     category label is vertically centred three lines below
 *                     the first skill it labels: the label is emitted first.
 *   Vertical gap      Two runs in the same column with more than a line's
 *                     pitch between them are different rows. This separates
 *                     one employment block's duties from the next block's
 *                     Company label, which sit in the same column.
 *   Font height       A label-sized run (11pt or more) in the first column
 *                     starts a row. This catches a block that begins at the
 *                     top of a page, where the gap rule has nothing to
 *                     measure against.
 *
 * Column starts are the template's own, x of 78, 235 and 410, refined from
 * any recognised column-header row so the older revision at x of 84 reads
 * too. Section headings are centred and 12pt, and become single-cell tables
 * exactly as mammoth flattens them.
 *
 * Pure. The pdf.js call lives in text.ts, which is server-only.
 */

import type { DocumentTables } from "@/lib/extraction/docx-tables";
import { normaliseLine } from "@/lib/extraction/pdf-lines";

/** The subset of a pdf.js text item this needs, already unpacked. */
export interface PdfTextItem {
  str: string;
  x: number;
  /** Baseline. PDF origin is bottom left, so a larger y is higher up. */
  y: number;
  width: number;
  /** Font height in text units, a proxy for point size. */
  height: number;
  /** pdf.js sets this when the run ends a wrapped line inside a paragraph. */
  hasEOL: boolean;
}

export interface PdfPageItems {
  items: PdfTextItem[];
}

export interface PdfTables {
  tables: DocumentTables;
  /** The "As of date:" value from the cover page, verbatim, or null. */
  coverAsOf: string | null;
  /** True when a cover page was recognised and dropped. */
  hadCover: boolean;
}

/** Where the template's columns begin. The first is the label column. */
const DEFAULT_COLUMN_STARTS = [78, 235, 410];
/** A run this far left of a column start still belongs to it. */
const COLUMN_SLACK = 15;
/** Runs whose baselines differ by no more than this share a line. */
const BASELINE_TOLERANCE = 5;
/** Body text pitch on the template, used when a page gives too few gaps to measure. */
const DEFAULT_PITCH = 11;
/** A gap this many pitches or more between same-column runs is a row boundary. */
const ROW_GAP_FACTOR = 1.25;
/** Labels and column headers are 11pt; body text is 9pt. */
const LABEL_HEIGHT = 10.5;
/** Section headings sit centred; nothing else starts this far right in the first column. */
const HEADING_MIN_X = 150;

/** The bullet glyph Word writes from the Symbol font, and its sub-bullet. */
const BULLET_RE = /^[•▪●]\s*/;

/**
 * Section headings as the issued template spells them, mapped to the names
 * parseTippTables understands. Each alias came from a real CV.
 */
const HEADING_ALIASES: Record<string, string> = {
  "CANDIDATE SUMMARY": "CANDIDATE SUMMARY",
  "CANDIDATE OVERVIEW": "CANDIDATE SUMMARY",
  "CANDIDATE PROFILE": "CANDIDATE SUMMARY",
  "CAREER SUMMARY": "CAREER SUMMARY",
  QUALIFICATION: "QUALIFICATION",
  QUALIFICATIONS: "QUALIFICATION",
  "CERTIFICATES AND COURSES": "CERTIFICATES AND COURSES",
  CERTIFICATIONS: "CERTIFICATIONS",
  SKILLS: "SKILLS",
  SKILLSET: "SKILLS",
  "SKILLS MATRIX": "SKILLS",
  "SKILLS AND TRAINING": "SKILLS AND TRAINING",
  PROJECTS: "PROJECTS",
  ACHIEVEMENTS: "ACHIEVEMENTS",
  "OTHER ACHIEVEMENTS": "OTHER ACHIEVEMENTS",
  "EMPLOYMENT RECORD": "EMPLOYMENT RECORD",
  "EMPLOYMENT HISTORY": "EMPLOYMENT RECORD",
  REFERENCE: "REFERENCE",
  REFERENCES: "REFERENCE",
};

/** Column header rows, which fix a table's column starts when recognised. */
const COLUMN_HEADERS: string[][] = [
  ["COMPANY", "POSITION", "DURATION"],
  ["QUALIFICATION", "INSTITUTION", "YEAR"],
  ["SKILLS", "PROFICIENCY", "YEARS OF EXPERIENCE"],
  ["SKILL SELF RATING", "EXPERIENCE", "LAST USED"],
  ["COMPANY NAME", "PROJECT NAME"],
];

const normalise = (value: string): string =>
  value
    .replace(/\(s\)/gi, "")
    .replace(/[^A-Za-z& ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

// -------------------------------------------------------------------------
// Lines
// -------------------------------------------------------------------------

interface Line {
  y: number;
  items: PdfTextItem[];
}

/** Group a page's runs by baseline, top to bottom, left to right within a line. */
function linesOf(items: PdfTextItem[]): Line[] {
  const lines: Line[] = [];
  for (const item of items) {
    if (!item.str || /^\s*$/.test(item.str)) continue;
    let line = lines.find((l) => Math.abs(l.y - item.y) <= BASELINE_TOLERANCE);
    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  lines.sort((a, b) => b.y - a.y);
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

/** The text of a line, words joined by single spaces. */
function lineText(line: Line): string {
  return normaliseLine(line.items.map((i) => i.str).join(" "));
}

/** The typical distance between consecutive lines on a page. */
function pitchOf(lines: Line[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 4 && gap < 20) gaps.push(gap);
  }
  if (gaps.length < 3) return DEFAULT_PITCH;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

// -------------------------------------------------------------------------
// The cover page
// -------------------------------------------------------------------------

const AS_OF_RE = /^as of date\s*:?\s*(.+)$/i;

/** Page 1 of an issued CV is boilerplate that opens with this. */
function isCoverPage(lines: Line[]): boolean {
  const first = lines[0] ? lineText(lines[0]) : "";
  return /^candidate resume$/i.test(first);
}

function asOfDate(lines: Line[]): string | null {
  for (const line of lines.slice(0, 12)) {
    const m = lineText(line).match(AS_OF_RE);
    if (m) return m[1].trim();
  }
  return null;
}

// -------------------------------------------------------------------------
// Headings and column headers
// -------------------------------------------------------------------------

/** The column header a row's cells spell, if any. */
function columnHeaderOf(text: string): string[] | null {
  const norm = normalise(text);
  return COLUMN_HEADERS.find((h) => norm === h.join(" ")) ?? null;
}

// -------------------------------------------------------------------------
// Reconstruction
// -------------------------------------------------------------------------

/**
 * Sections whose body is prose rather than a table. Under these, nothing is
 * bucketed into columns: justified text splits into word runs at arbitrary
 * positions across the page, and read as columns it becomes three cells of
 * fragments. Everything else on the template is a table.
 */
const PROSE_SECTIONS = new Set([
  "CANDIDATE SUMMARY",
  "ACHIEVEMENTS",
  "OTHER ACHIEVEMENTS",
  "CERTIFICATIONS",
  "REFERENCE",
]);

/** Under this heading, every row whose label is Company begins a new block. */
const EMPLOYMENT = "EMPLOYMENT RECORD";

interface Cell {
  text: string;
  /** The last run ended a wrapped line, so the next run continues its paragraph. */
  openParagraph: boolean;
  lastY: number;
  /** A bare bullet glyph was just seen: whatever comes next starts a paragraph. */
  pendingBullet: boolean;
}

class RowBuilder {
  cells: Cell[] = [];

  append(col: number, item: PdfTextItem): void {
    while (this.cells.length <= col) {
      this.cells.push({ text: "", openParagraph: false, lastY: Number.NaN, pendingBullet: false });
    }
    const cell = this.cells[col];
    const hadBullet = BULLET_RE.test(item.str);
    const str = item.str.replace(BULLET_RE, "").trim();
    if (!str) {
      // A bare bullet glyph. Its text is the next run, and it starts a
      // paragraph whatever line it sits on.
      if (hadBullet) cell.pendingBullet = true;
      return;
    }
    if (!cell.text) {
      cell.text = str;
    } else if (cell.pendingBullet || hadBullet) {
      cell.text += "\n" + str;
    } else if (Math.abs(cell.lastY - item.y) <= BASELINE_TOLERANCE || cell.openParagraph) {
      // Same line, or the previous run wrapped: one paragraph.
      cell.text += " " + str;
    } else {
      cell.text += "\n" + str;
    }
    cell.pendingBullet = false;
    cell.openParagraph = item.hasEOL;
    cell.lastY = item.y;
  }

  toRow(): string[] {
    return this.cells.map((c) => c.text.trim());
  }

  get isEmpty(): boolean {
    return this.cells.every((c) => !c.text.trim());
  }
}

/** The column a run belongs to: the last start at or left of it, with slack. */
function columnOf(x: number, starts: number[]): number {
  let col = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= x + COLUMN_SLACK) col = i;
  }
  return col;
}

/**
 * A centred run naming a section.
 *
 * Centred is the discriminator: QUALIFICATION at x of 84 is a column header
 * and at x of 267 is the section. Font size is not required, because one
 * issued copy prints CERTIFICATES AND COURSES at body size, and the exact
 * match against a short list of known names is the stronger test anyway.
 */
function headingOf(item: PdfTextItem): string | null {
  if (item.x < HEADING_MIN_X) return null;
  return HEADING_ALIASES[normalise(item.str)] ?? null;
}

/**
 * Turn a document's pages of positioned runs into tables.
 *
 * The runs are walked in the order pdf.js emits them and never sorted: that
 * order is cell by cell, which is the structure being recovered. Sorting into
 * lines first, as the plain-text reader does, is exactly what loses it.
 *
 * The cover page, when present, is read for its date and then dropped, so
 * nothing on it, least of all the agency's contact details, reaches any
 * field. Everything after it is one stream: a table that spans a page break
 * continues, because the employment record does on every long CV.
 */
export function tablesFromPdfPages(pages: PdfPageItems[]): PdfTables {
  const tables: DocumentTables = [];
  let coverAsOf: string | null = null;
  let hadCover = false;

  let current: string[][] = [];
  let row: RowBuilder | null = null;
  let section: string | null = null;
  let starts = [...DEFAULT_COLUMN_STARTS];
  let prevCol = -1;
  let prevY = Number.NaN;
  let prevHeight = 0;
  let pitch = DEFAULT_PITCH;
  /** The x of every run in the row being built, to fix column starts if it is a header. */
  let rowXs: number[] = [];
  /** Inside an employment block's duties, which are prose however they are aligned. */
  let inDuties = false;
  /** The baseline of the heading just consumed, so a second run of it on the same line is too. */
  let headingY = Number.NaN;

  const closeRow = () => {
    if (row && !row.isEmpty) {
      const cells = row.toRow();
      const header = columnHeaderOf(cells.join(" "));
      if (header) {
        // A recognised header row fixes the columns for the rows that follow,
        // from where its own words sit, so the older revision at x of 84 reads.
        const distinct = [...new Set(rowXs.map((x) => Math.round(x)))].sort((a, b) => a - b);
        if (distinct.length >= header.length) starts = distinct.slice(0, header.length);
        current.push(header);
      } else {
        current.push(cells);
      }
    }
    row = null;
    rowXs = [];
  };
  const closeTable = () => {
    closeRow();
    if (current.length > 0) tables.push(current);
    current = [];
  };
  const startRow = () => {
    closeRow();
    row = new RowBuilder();
  };

  for (const [pageIndex, page] of pages.entries()) {
    const items = page.items.filter((i) => i.str && !/^\s*$/.test(i.str));
    if (items.length === 0) continue;

    const lines = linesOf(items);
    if (pageIndex === 0 && isCoverPage(lines)) {
      coverAsOf = asOfDate(lines);
      hadCover = true;
      continue;
    }

    pitch = pitchOf(lines);
    // A page break has no gap to measure. The column and font rules still apply.
    prevY = Number.NaN;

    for (const item of items) {
      // "SKILLS MATRIX" arrives as two runs. The first is the heading; the
      // second, on the same line, is the rest of it and not a row.
      if (!Number.isNaN(headingY) && Math.abs(item.y - headingY) <= BASELINE_TOLERANCE) continue;
      headingY = Number.NaN;

      const heading = headingOf(item);
      if (heading) {
        closeTable();
        tables.push([[heading]]);
        headingY = item.y;
        section = heading;
        inDuties = false;
        starts = [...DEFAULT_COLUMN_STARTS];
        prevCol = -1;
        prevY = Number.NaN;
        prevHeight = 0;
        continue;
      }

      // Across a page break there is no previous line to be on.
      const gap = Number.isNaN(prevY) ? Number.POSITIVE_INFINITY : prevY - item.y;
      const sameLine = Number.isFinite(gap) && Math.abs(gap) <= BASELINE_TOLERANCE;
      const isLabelSize = item.height >= LABEL_HEIGHT;

      // A label-sized run at the left edge ends the duties. Duties: itself is
      // body-sized, so it is recognised by its text below.
      if (inDuties && isLabelSize && columnOf(item.x, starts) === 0) inDuties = false;
      // Justified text splits into word runs across the page. Read as columns
      // it becomes three cells of fragments, so prose is never bucketed.
      const prose = (section !== null && PROSE_SECTIONS.has(section)) || inDuties;
      const col = prose ? 0 : columnOf(item.x, starts);

      const beginsRow =
        row === null ||
        col < prevCol ||
        (Number.isFinite(gap) && !sameLine && col === 0 && prevCol === 0 && gap > pitch * ROW_GAP_FACTOR) ||
        (!sameLine && col === 0 && isLabelSize && prevHeight < LABEL_HEIGHT);

      if (beginsRow) {
        // One table per employment block, as mammoth gives them: a Company
        // label opens a block, and the parser reads each table as one job.
        if (section === EMPLOYMENT && col === 0 && /^company$/i.test(item.str.trim())) closeTable();
        startRow();
      }
      row!.append(col, item);
      rowXs.push(item.x);
      if (section === EMPLOYMENT && col === 0 && /^duties\s*:?$/i.test(item.str.trim())) inDuties = true;
      prevCol = col;
      prevY = item.y;
      prevHeight = item.height;
    }
  }

  closeTable();
  return { tables, coverAsOf, hadCover };
}

/**
 * Unpack pdf.js text items into the shape above. Exported so text.ts can
 * hand over raw page content without this module knowing pdf.js.
 */
export function pdfItemsFrom(raw: unknown[]): PdfTextItem[] {
  const out: PdfTextItem[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown; hasEOL?: unknown };
    if (typeof r.str !== "string" || !Array.isArray(r.transform) || r.transform.length < 6) continue;
    const x = Number(r.transform[4]);
    const y = Number(r.transform[5]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({
      str: r.str,
      x,
      y,
      width: Number.isFinite(r.width) ? (r.width as number) : 0,
      height: Number.isFinite(r.height) ? (r.height as number) : 0,
      hasEOL: r.hasEOL === true,
    });
  }
  return out;
}
