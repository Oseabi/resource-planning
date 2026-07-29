import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseRfqText,
  parseMoney,
  parseMinExperience,
  extractRequiredRoles,
  parseReferenceNumber,
} from "@/lib/extraction/rfq-parser";
import { tenderBody, stripRepeatedLines } from "@/lib/extraction/tender-sections";

/**
 * Regression fixture mirroring a real ZA government RFP: ~45 pages of standard
 * bidding documents wrapped around a few pages of actual requirements. Before
 * boilerplate scoping, this shape produced junk (client "THE COMPANY", a R50m
 * preference-points threshold as the contract value, and no team roles at all).
 */
const TENDER = readFileSync(
  join(__dirname, "__fixtures__", "government-tender.txt"),
  "utf8",
);

describe("stripRepeatedLines", () => {
  it("drops running page headers and page numbers", () => {
    const cleaned = stripRepeatedLines(
      TENDER.split("\n").map((l) => l.trim()).filter(Boolean),
    );
    expect(cleaned.some((l) => /^page \d+ of \d+$/i.test(l))).toBe(false);
    // The running title survives exactly once, so it can still seed the title.
    const runningTitle = cleaned.filter((l) => l.startsWith("DEVELOPMENT, IMPLEMENTATION, SUPPORT"));
    expect(runningTitle).toHaveLength(1);
  });
});

describe("tenderBody", () => {
  const body = tenderBody(TENDER);

  it("finds the requirements section, not the contents-page entry", () => {
    expect(body.foundCore).toBe(true);
    expect(body.core.join("\n")).toContain("SCOPE OF WORK");
    expect(body.core.join("\n")).toContain("Lead Implementation Specialist");
  });

  it("excludes the standard bidding boilerplate", () => {
    const core = body.core.join("\n");
    expect(core).not.toContain("PREFERENCE POINTS CLAIM FORM");
    expect(core).not.toContain("Tax Compliance Status PIN");
    expect(core).not.toContain("GENERAL CONDITIONS OF CONTRACT");
  });

  it("falls back to the whole document when there is no requirements heading", () => {
    const plain = tenderBody("We would like a quote for some work.\nPlease respond by Friday.");
    expect(plain.foundCore).toBe(false);
    expect(plain.core.length).toBeGreaterThan(0);
  });
});

describe("parseMoney — word-boundary guards", () => {
  it("does not read 'FURTHER 24 MONTHS' as R24 million", () => {
    expect(parseMoney("RENEW FOR A FURTHER 24 MONTHS BASED ON PERFORMANCE")).toBeNull();
  });
  it("still parses genuine amounts", () => {
    expect(parseMoney("R 12,500,000")).toBe(12_500_000);
    expect(parseMoney("R2.5 million")).toBe(2_500_000);
    expect(parseMoney("$950k")).toBe(950_000);
  });
});

describe("parseMinExperience — legal phrasing", () => {
  it("reads 'a minimum of three (3) years' experience'", () => {
    expect(parseMinExperience("must have a minimum of three (3) years' experience")).toBe(3);
  });
  it("reads a spelled-out figure with no numeral", () => {
    expect(parseMinExperience("at least five years experience")).toBe(5);
  });
  it("still reads plain numerals", () => {
    expect(parseMinExperience("minimum of 8 years experience")).toBe(8);
    expect(parseMinExperience("10+ years experience required")).toBe(10);
  });
  it("takes the floor across several stated requirements", () => {
    expect(parseMinExperience(TENDER)).toBe(3);
  });
});

describe("extractRequiredRoles", () => {
  it("picks up tender-specific personnel the vocabulary does not contain", () => {
    const roles = extractRequiredRoles(tenderBody(TENDER).core);
    expect(roles).toContain("Lead Implementation Specialist");
    expect(roles).toContain("Change Management Specialist");
  });

  it("strips bracketed abbreviations from role titles", () => {
    const roles = extractRequiredRoles([
      "The bidder must provide a Quality Assurance (QA) Specialist with a minimum of three years.",
    ]);
    expect(roles).toContain("Quality Assurance Specialist");
  });

  it("ignores boilerplate 'must provide' sentences about documents", () => {
    const roles = extractRequiredRoles([
      "The bidder must provide a certified copy of the qualification.",
      "The supplier shall provide such packing of the goods as is required.",
    ]);
    expect(roles).toEqual([]);
  });
});

describe("parseReferenceNumber", () => {
  it("reads a bid number sharing a line with other labels", () => {
    expect(
      parseReferenceNumber(["BID NUMBER: H004L2705RFP00048 CLOSING DATE: 17 AUGUST 2026"]),
    ).toBe("H004L2705RFP00048");
  });

  it("handles the common label variants", () => {
    expect(parseReferenceNumber(["Tender No. RFP-2026/014"])).toBe("RFP-2026/014");
    expect(parseReferenceNumber(["Reference Number - ABC12345"])).toBe("ABC12345");
  });

  it("ignores a label followed by a word rather than a code", () => {
    expect(parseReferenceNumber(["BID NUMBER: CLOSING DATE"])).toBeNull();
  });

  it("returns null when absent", () => {
    expect(parseReferenceNumber(["No identifiers here."])).toBeNull();
  });
});

describe("parseRfqText on a full government tender", () => {
  const f = parseRfqText(TENDER, "TENDER DOCUMENT H004L2705RFP00048.pdf");

  it("keeps the whole wrapped title rather than the first line", () => {
    expect(f.title).toContain("APPOINTMENT OF A SERVICE PROVIDER");
    expect(f.title).toContain("ADMINISTRATIVE FINES MANAGEMENT SYSTEM");
  });

  it("takes the issuing authority, not the SBD signature block", () => {
    expect(f.client).toBe("BORDER MANAGEMENT AUTHORITY (BMA)");
  });

  it("reads the closing date", () => {
    expect(f.submission_deadline).toBe("2026-08-17");
  });

  it("lifts the bid number out of the SBD1 page", () => {
    expect(f.reference_number).toBe("H004L2705RFP00048");
  });

  it("does not mistake the preference-points threshold for the contract value", () => {
    expect(f.value).toBeNull();
  });

  it("extracts the full required team", () => {
    expect(f.required_roles).toEqual(
      expect.arrayContaining([
        "Project Manager",
        "Lead Implementation Specialist",
        "Business Analyst",
        "Quality Assurance Specialist",
        "Change Management Specialist",
      ]),
    );
  });

  it("sets the minimum experience floor", () => {
    expect(f.min_experience_years).toBe(3);
  });

  it("keeps skills to the requirements section", () => {
    expect(f.required_skills).toContain("Sage");
    // "Tax Compliance" lives only in the SBD boilerplate.
    expect(f.required_skills).not.toContain("Tax Compliance");
    // "Go-Live" is not the Go programming language.
    expect(f.required_skills).not.toContain("Go");
  });
});
