import { describe, it, expect } from "vitest";
import { parseTippTemplate, looksLikeTippTemplate } from "@/lib/extraction/tipp-template";
import { parseTextToFields, isTippCv, tippParsedFully } from "@/lib/extraction/local-parser";

/**
 * The template as a PDF lays it out, which is not how a docx flattens it.
 *
 * A docx puts every table cell on its own line. A PDF keeps a row on one
 * line, so a label and its value arrive together, a three-word table header
 * arrives as one string or wrapped over two, and the career table cannot be
 * split at all. Everything below is synthetic and shaped like the real thing.
 */
const PDF_SHAPED = [
  "Candidate Resume",
  "Thandi Example",
  "Lead Enterprise Architect",
  "Account Manager: Somebody",
  "FULL NAME (S) Thandi Example",
  "DATE OF BIRTH",
  "05 February 1989",
  "POSITON",
  "Lead Enterprise Architect",
  "DESIGNATED GROUP",
  "African Female",
  "YEARS OF EXPERIENCE",
  "8+ years",
  "AVAILABILITY",
  "Immediately",
  "CANDIDATE OVERVIEW",
  "Thandi Example is a TOGAF-certified architect with eight years across mining and",
  "public-sector ICT.",
  "CAREER SUMMARY",
  "COMPANY POSITION DURATION",
  "Big Mining Co IM Enterprise Architecture & June 2024 – Current",
  "Governance: Specialist Application",
  "State ICT Agency Enterprise Architect: ICT Systems April 2022 – May 2024",
  "QUALIFICATIONS",
  "QUALIFICATION",
  "INSTITUTION YEAR",
  "B Tech Information Technology A University 2011",
  "SKILLSET",
  "SKILLS PROFICIENCY EXPERIENCE",
  "Programming Languages HTML, JavaScript, CSS 8+ years",
  "Databases SAP / Oracle ERP 5+ years",
  "EMPLOYMENT RECORD",
  "Company: Big Mining Co",
].join("\n");

describe("the template as a PDF lays it out", () => {
  it("is still recognised, with CANDIDATE OVERVIEW standing in for CANDIDATE SUMMARY", () => {
    expect(looksLikeTippTemplate(PDF_SHAPED)).toBe(true);
    expect(isTippCv(PDF_SHAPED)).toBe(true);
  });

  it("reads a label and its value from the same line", () => {
    // "FULL NAME (S) Thandi Example" is one line on a PDF. Before, that line
    // matched no heading and the name was lost entirely.
    expect(parseTippTemplate(PDF_SHAPED)?.full_name).toBe("Thandi Example");
  });

  it("reads POSITON, which is how one issued copy of the template spells it", () => {
    expect(parseTippTemplate(PDF_SHAPED)?.current_role).toBe("Lead Enterprise Architect");
  });

  it("reads the summary under its other name", () => {
    expect(parseTippTemplate(PDF_SHAPED)?.professional_summary).toMatch(/TOGAF-certified/);
  });

  it("reads the designated group and availability", () => {
    const f = parseTippTemplate(PDF_SHAPED);
    expect(f?.designated_group).toBe("African Female");
    expect(f?.availability).toBe("available");
  });

  it("does not open a skills section on a table header that starts with SKILLS", () => {
    // "SKILLS PROFICIENCY EXPERIENCE" is a header row. Read as a heading with
    // a value, it swallowed everything after it: 271 skills on the first try.
    const f = parseTippTemplate(PDF_SHAPED);
    expect(f?.skills.length ?? 0).toBeLessThan(5);
    expect(f?.skills).not.toContain("PROFICIENCY EXPERIENCE");
  });

  it("does not read a wrapped table header as a qualification", () => {
    // "QUALIFICATION" then "INSTITUTION YEAR" on the next line is one header.
    const f = parseTippTemplate(PDF_SHAPED);
    expect(f?.qualifications).not.toContain("INSTITUTION YEAR");
  });

  it("cannot read the career table, and says so through tippParsedFully", () => {
    // A row with company, position and duration on one line has no column
    // boundaries to split on. That is not a parser bug to fix here; it is the
    // case the AI exists for, and the gate has to let it through.
    const f = parseTextToFields(PDF_SHAPED);
    expect(f.full_name).toBe("Thandi Example");
    expect(f.work_experience).toEqual([]);
    expect(tippParsedFully(f)).toBe(false);
  });
});

describe("tippParsedFully", () => {
  const read = parseTextToFields(
    ["FULL NAME (S)", "", "A Person", "", "POSITION", "", "Analyst", "", "CAREER SUMMARY", "",
      "COMPANY", "POSITION", "DURATION", "Acme", "Analyst", "Jan 2020 - Current", "",
      "DESIGNATED GROUP", "", "African Male", "", "EMPLOYMENT RECORD", "", "CANDIDATE SUMMARY", ""].join("\n"),
  );

  it("is true when the name, the role and at least one job were read", () => {
    expect(read.full_name).toBe("A Person");
    expect(read.work_experience.length).toBeGreaterThan(0);
    expect(tippParsedFully(read)).toBe(true);
  });

  it("is false when any of the three is missing", () => {
    expect(tippParsedFully({ ...read, full_name: null })).toBe(false);
    expect(tippParsedFully({ ...read, current_role: null })).toBe(false);
    expect(tippParsedFully({ ...read, work_experience: [] })).toBe(false);
  });
});
