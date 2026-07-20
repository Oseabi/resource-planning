import { describe, it, expect } from "vitest";
import { parseRfqText, parseDateToIso, parseMoney, parseMinExperience } from "@/lib/extraction/rfq-parser";

const SAMPLE_RFQ = `Request for Quotation: D365 Finance Implementation Partner
Issued by: Gauteng Provincial Treasury
Project Location: Johannesburg, Gauteng

Overview
The Gauteng Provincial Treasury invites proposals for the implementation of
Microsoft Dynamics 365 F&O across provincial finance departments.

Estimated Contract Value: R 12,500,000
Submission Deadline: 15 August 2026
Contract Start Date: 01/10/2026

Required Team
- ERP Consultant with D365 configuration experience
- Project Manager (PRINCE2 certified)
- Business Analyst for Business Process Analysis

Required certifications: PRINCE2, Microsoft Certified: Dynamics 365 F&O Apps Developer Associate

Sector: Public Sector, Finance
`;

describe("parseDateToIso", () => {
  it("parses '15 August 2026'", () => {
    expect(parseDateToIso("15 August 2026")).toBe("2026-08-15");
  });
  it("parses 'August 15, 2026'", () => {
    expect(parseDateToIso("August 15, 2026")).toBe("2026-08-15");
  });
  it("parses ISO and slash (day-first) formats", () => {
    expect(parseDateToIso("2026-08-15")).toBe("2026-08-15");
    expect(parseDateToIso("01/10/2026")).toBe("2026-10-01");
  });
  it("returns null for non-dates", () => {
    expect(parseDateToIso("as soon as possible")).toBeNull();
  });
});

describe("parseMoney", () => {
  it("parses grouped amounts", () => {
    expect(parseMoney("R 12,500,000")).toBe(12_500_000);
  });
  it("parses suffixed amounts", () => {
    expect(parseMoney("£4.2m")).toBe(4_200_000);
    expect(parseMoney("$950k")).toBe(950_000);
    expect(parseMoney("R2.5 million")).toBe(2_500_000);
  });
  it("returns null when no amount", () => {
    expect(parseMoney("no budget stated")).toBeNull();
  });
});

describe("parseMinExperience", () => {
  it("reads 'minimum N years' phrasings", () => {
    expect(parseMinExperience("Candidates require a minimum of 5 years experience")).toBe(5);
    expect(parseMinExperience("at least 8 years in the field")).toBe(8);
    expect(parseMinExperience("10+ years experience required")).toBe(10);
  });
  it("takes the smallest requirement when several appear", () => {
    expect(parseMinExperience("minimum 5 years for engineers, 10 years for leads")).toBe(5);
  });
  it("returns null when none stated", () => {
    expect(parseMinExperience("No specific experience requirement.")).toBeNull();
  });
});

describe("parseRfqText", () => {
  const f = parseRfqText(SAMPLE_RFQ, "d365-rfq.docx");

  it("extracts title, client and location from labels", () => {
    expect(f.title).toContain("D365 Finance Implementation Partner");
    expect(f.client).toBe("Gauteng Provincial Treasury");
    expect(f.location).toContain("Johannesburg");
  });

  it("extracts value and dates", () => {
    expect(f.value).toBe(12_500_000);
    expect(f.submission_deadline).toBe("2026-08-15");
    expect(f.contract_start_date).toBe("2026-10-01");
  });

  it("dictionary-matches roles, skills, certs, sectors", () => {
    expect(f.required_roles).toContain("ERP Consultant");
    expect(f.required_roles).toContain("Project Manager");
    expect(f.required_skills).toContain("Business Process Analysis");
    expect(f.required_certifications).toContain("PRINCE2");
    expect(f.sectors).toContain("Public Sector");
  });

  it("degrades gracefully on unstructured text", () => {
    const empty = parseRfqText("We would like to talk about maybe working together.");
    expect(empty.value).toBeNull();
    expect(empty.submission_deadline).toBeNull();
    expect(empty.required_roles).toEqual([]);
  });
});
