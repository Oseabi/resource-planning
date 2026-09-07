/**
 * A small RFC 4180 CSV reader, for loading the tender register.
 *
 * Hand-rolled rather than adding a dependency. The export side of this app
 * already hand-rolls CSV quoting in the two matching-results components, this
 * is a one-off migration tool, and the failure modes that actually bite here
 * (a BOM, a semicolon file from a European Excel, a quoted cell containing the
 * delimiter) are exactly the ones a unit test pins down well.
 *
 * If a real register turns out to fight this, swapping in a library behind the
 * same parseCsv signature is a small change.
 *
 * Pure, no I/O.
 */

export type Delimiter = "," | ";" | "\t";

export interface CsvRow {
  /** 1-based line number in the file, so a report can point at the spreadsheet. */
  line: number;
  cells: Record<string, string>;
}

export interface CsvProblem {
  line: number;
  message: string;
}

export interface CsvTable {
  delimiter: Delimiter;
  /** Normalized, in file order. */
  headers: string[];
  rows: CsvRow[];
  problems: CsvProblem[];
}

/**
 * Header text to a stable key: strips a BOM, trims, lowercases, and turns runs
 * of space or hyphen into single underscores. So "Contract Start Date",
 * "contract-start-date" and " CONTRACT START DATE " all arrive as one column.
 */
export function normalizeHeader(raw: string): string {
  return raw
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * Which delimiter this file uses, decided on the header line.
 *
 * Counts only characters outside quotes, because a comma file whose first
 * header is quoted and contains semicolons would otherwise be read as a
 * semicolon file, and then every column name is wrong at once.
 */
export function sniffDelimiter(firstLine: string): Delimiter {
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i += 1) {
    const ch = firstLine[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === "," || ch === ";" || ch === "\t") counts[ch] += 1;
  }
  // Comma wins a tie, since it is the default everywhere.
  if (counts[";"] > counts[","] && counts[";"] >= counts["\t"]) return ";";
  if (counts["\t"] > counts[","] && counts["\t"] > counts[";"]) return "\t";
  return ",";
}

/** Split one CSV file into records, honouring quotes across line breaks. */
function splitRecords(text: string, delimiter: Delimiter): { line: number; fields: string[] }[] {
  const records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let started = false;

  const endField = () => {
    fields.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    // A trailing newline produces one empty field, which is not a record.
    if (!(fields.length === 1 && fields[0] === "")) {
      records.push({ line: recordLine, fields });
    }
    fields = [];
    started = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (!started) {
      recordLine = line;
      started = true;
    }

    if (inQuotes) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line += 1;
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\r") {
      // CRLF: the newline does the work.
    } else if (ch === "\n") {
      endRecord();
      line += 1;
    } else {
      field += ch;
    }
  }

  if (started || field !== "" || fields.length > 0) endRecord();
  return records;
}

export function parseCsv(text: string): CsvTable {
  const clean = text.replace(/^﻿/, "");
  const firstBreak = clean.indexOf("\n");
  const headerLine = firstBreak === -1 ? clean : clean.slice(0, firstBreak);
  const delimiter = sniffDelimiter(headerLine);

  const records = splitRecords(clean, delimiter);
  const problems: CsvProblem[] = [];

  if (records.length === 0) {
    return { delimiter, headers: [], rows: [], problems: [{ line: 1, message: "The file is empty." }] };
  }

  const headers = records[0].fields.map(normalizeHeader);
  const rows: CsvRow[] = [];

  for (const record of records.slice(1)) {
    // A blank line in the middle of a register is a formatting artefact, not a
    // row, and reporting it as ragged would be noise.
    if (record.fields.every((f) => f.trim() === "")) continue;

    if (record.fields.length !== headers.length) {
      // Reported rather than padded. A short row usually means an unescaped
      // quote or delimiter somewhere above it, and silently filling the gap
      // with blanks hides which column actually went wrong.
      problems.push({
        line: record.line,
        message: `${record.fields.length} value${record.fields.length === 1 ? "" : "s"} for ${headers.length} columns.`,
      });
      continue;
    }

    const cells: Record<string, string> = {};
    headers.forEach((header, i) => {
      cells[header] = record.fields[i].trim();
    });
    rows.push({ line: record.line, cells });
  }

  return { delimiter, headers, rows, problems };
}

/** How the delimiter should read in a report. */
export function delimiterName(delimiter: Delimiter): string {
  return delimiter === "," ? "comma" : delimiter === ";" ? "semicolon" : "tab";
}
