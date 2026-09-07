import { describe, it, expect } from "vitest";
import { parseCsv, normalizeHeader, sniffDelimiter, delimiterName } from "@/lib/csv";

describe("normalizeHeader", () => {
  it("gives one key whatever the spreadsheet called it", () => {
    for (const raw of ["Contract Start Date", " contract-start-date ", "CONTRACT  START  DATE"]) {
      expect(normalizeHeader(raw)).toBe("contract_start_date");
    }
  });

  it("strips a byte order mark from the first header", () => {
    // Excel writes one, and without this the first column never matches, so
    // reference_number reads blank on every row and a re-run duplicates the lot.
    expect(normalizeHeader("﻿title")).toBe("title");
  });
});

describe("sniffDelimiter", () => {
  it("reads comma, semicolon and tab files", () => {
    expect(sniffDelimiter("title,client,value")).toBe(",");
    expect(sniffDelimiter("title;client;value")).toBe(";");
    expect(sniffDelimiter("title\tclient\tvalue")).toBe("\t");
  });

  it("ignores delimiters inside a quoted header", () => {
    // Otherwise a comma file whose first header happens to contain semicolons
    // is read as a semicolon file, and every column name is wrong at once.
    expect(sniffDelimiter('"client; department",title,value')).toBe(",");
  });

  it("names the delimiter for the report", () => {
    expect(delimiterName(";")).toBe("semicolon");
  });
});

describe("parseCsv", () => {
  it("keeps a quoted field that contains the delimiter", () => {
    const t = parseCsv('title,client\n"Roads, bridges and structures",SANRAL\n');
    expect(t.rows[0].cells.title).toBe("Roads, bridges and structures");
    expect(t.rows[0].cells.client).toBe("SANRAL");
  });

  it("reads a doubled quote as one literal quote", () => {
    const t = parseCsv('title\n"The ""Big Five"" programme"\n');
    expect(t.rows[0].cells.title).toBe('The "Big Five" programme');
  });

  it("keeps a newline inside a quoted field", () => {
    const t = parseCsv('title,notes\nERP,"line one\nline two"\n');
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].cells.notes).toBe("line one\nline two");
  });

  it("handles CRLF and a missing trailing newline", () => {
    const t = parseCsv("title,client\r\nERP,Eskom\r\nRoads,SANRAL");
    expect(t.rows.map((r) => r.cells.client)).toEqual(["Eskom", "SANRAL"]);
    expect(t.problems).toEqual([]);
  });

  it("skips a blank line in the middle rather than calling it ragged", () => {
    const t = parseCsv("title,client\nERP,Eskom\n\nRoads,SANRAL\n");
    expect(t.rows).toHaveLength(2);
    expect(t.problems).toEqual([]);
  });

  it("reports a ragged row instead of padding it", () => {
    // A short row usually means an unescaped quote somewhere above it. Filling
    // the gap with blanks hides which column actually went wrong.
    const t = parseCsv("title,client,value\nERP,Eskom\n");
    expect(t.rows).toHaveLength(0);
    expect(t.problems[0].message).toMatch(/2 values for 3 columns/);
    expect(t.problems[0].line).toBe(2);
  });

  it("reports the line number of the row, so the report can point at the sheet", () => {
    const t = parseCsv("title\nA\nB\nC\n");
    expect(t.rows.map((r) => r.line)).toEqual([2, 3, 4]);
  });

  it("counts a multi-line quoted field toward the next row's line number", () => {
    const t = parseCsv('title,notes\nA,"one\ntwo"\nB,three\n');
    expect(t.rows.map((r) => [r.line, r.cells.title])).toEqual([
      [2, "A"],
      [4, "B"],
    ]);
  });

  it("reads a semicolon file end to end", () => {
    const t = parseCsv("title;client\nERP;Eskom\n");
    expect(t.delimiter).toBe(";");
    expect(t.rows[0].cells.client).toBe("Eskom");
  });

  it("says so when the file is empty", () => {
    expect(parseCsv("").problems[0].message).toMatch(/empty/);
  });
});
