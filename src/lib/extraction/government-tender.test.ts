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

/**
 * A second real-world shape: a tabular front page (labelled "Bid Number" /
 * "Title of this RFB" with no colons), a dot-leader contents page, and
 * multi-level section numbering. Previously this produced a title starting
 * mid-sentence, "SANAS accredited Non-Mandatory" as the client, a value of 10,
 * and the clarification cut-off as the closing date.
 */
const TABULAR_TENDER = `.
FOR MORE INFORMATION ON TCTA, PLEASE VISIT OUR WEB SITE WWW.TCTA.CO.ZA
APPOINTMENT OF A SERVICE PROVIDER FOR THE SUPPLY, IMPLEMENTATION, AND SUPPORT
OF THE ENTERPRISE ARCHITECTURE TOOL FOR A PERIOD OF 60 MONTHS.
Bid Number 022/2026/EWSS/SUPPORT/RFB
Title of this RFB Appointment of a service provider for the supply, implementation
and support of the Enterprise Architecture Tool for a period of 60
months.
RFB Issue Date 28 July 2026
Clarification and enquiries NB: Kindly send all clarification questions to
tenders02@tcta.co.za. Deadlines for clarifications will be on 20 August 2026 @16h00.
RFB Closing Time & Date 28 August 2026 @ 10h00
Delivery Address Bids must be hand delivered at Trans Caledon Tunnel Authority
(TCTA), Building 9, Byls Bridge Office Park, Centurion, 0157
TABLE OF CONTENTS
3. BACKGROUND .................................................................................................................... 2
3.1. SCOPE OF WORK ................................................................................................................ 3
3.3. KEY PERSONNEL EXPERIENCE........................................................................................ 7
9. CONDITIONS OF BID .........................................................................................................13
Page | 1

3. BACKGROUND
TCTA requires an Enterprise Architecture tool to support its architecture practice.
The current toolset is fragmented and cannot model the full application estate.
3.1. SCOPE OF WORK
The service provider shall supply, implement and support the tool.
3.1.1. Functional Requirements
• Capability and business process modelling across the enterprise
• Application portfolio management with lifecycle tracking
• Integration and data flow modelling between systems
• Role-based access control and single sign-on
• Reporting and dashboards for architecture governance
3.1.2. Non-Functional Requirements
• The solution must be available 99.5% of the time during business hours
• All data must be hosted within South African borders
• The tool must support at least 50 concurrent named users
3.1.3. Implementation
• Installation, configuration and environment setup
• Migration of existing architecture artefacts
• Integration with the existing identity provider
3.1.4. Training and Knowledge Transfer
• Administrator and end-user training for all licensed users
• Documented handover of configuration and operating procedures
3.3. KEY PERSONNEL EXPERIENCE
The bidder must provide resources that have technical experience in implementing the solution. A
minimum of seven (7) years of technical lead experience and five (5) years for project manager experience.
3.4. CONTRACT DURATION
The contract duration is for a period of 60 months
4. STAGE 1: RETURNABLE DOCUMENTS (SUBMISSION REQUIREMENTS)
ALL RETURNABLES ARE REQUIRED FOR PURPOSES OF EVALUATION.
Page | 7
`;

describe("parseRfqText on a tabular front-page tender", () => {
  const f = parseRfqText(TABULAR_TENDER, "EA-tool-advert.pdf");

  it("joins a labelled title that wraps across table rows", () => {
    expect(f.title).toContain("Enterprise Architecture Tool");
    expect(f.title).toContain("period of 60");
  });

  it("reads a bid number that has no colon after the label", () => {
    expect(f.reference_number).toBe("022/2026/EWSS/SUPPORT/RFB");
  });

  it("prefers the bid closing date over the clarification cut-off", () => {
    expect(f.submission_deadline).toBe("2026-08-28");
  });

  it("recovers the issuing body from the 'Full Name (ACRONYM)' convention", () => {
    expect(f.client).toBe("Trans Caledon Tunnel Authority (TCTA)");
  });

  it("takes the lowest stated experience floor across roles", () => {
    // "seven (7) years ... and five (5) years for project manager experience"
    expect(f.min_experience_years).toBe(5);
  });

  it("extracts the named personnel, ignoring the client's own acronym", () => {
    expect(f.required_roles).toContain("Technical Lead");
    expect(f.required_roles).toContain("Project Manager");
    expect(f.required_roles).not.toContain("TCTA");
  });

  it("reports no value rather than inventing one", () => {
    expect(f.value).toBeNull();
  });
});

describe("tenderBody on multi-level numbering", () => {
  it("anchors on the real heading, not the dot-leader contents entry", () => {
    const body = tenderBody(TABULAR_TENDER);
    expect(body.foundCore).toBe(true);
    expect(body.core[0]).toBe("3. BACKGROUND");
    expect(body.core.join("\n")).toContain("KEY PERSONNEL EXPERIENCE");
  });

  it("stops at the returnable-documents boilerplate", () => {
    const body = tenderBody(TABULAR_TENDER);
    expect(body.core.join("\n")).not.toContain("ALL RETURNABLES ARE REQUIRED");
  });
});

describe("client screening", () => {
  it("rejects prose that merely starts with a client label", () => {
    const f = parseRfqText(
      "SCOPE OF WORK\nClient sign-off on the system and reviews to be done against loaded KPIs.\n",
    );
    expect(f.client).toBeNull();
  });

  it("strips a cover-page classification stamp from the organisation name", () => {
    const f = parseRfqText(
      "Confidential Government Employees Pension Fund (GEPF)\nRequest for Proposals for a system.\n",
    );
    expect(f.client).toBe("Government Employees Pension Fund (GEPF)");
  });

  it("does not mistake a document-type acronym for the client", () => {
    const f = parseRfqText("Request for Proposals (RFP) for the appointment of a provider.\n");
    expect(f.client).toBeNull();
  });
});

describe("value is only taken from a labelled field", () => {
  it("ignores background prose mentioning large amounts", () => {
    const f = parseRfqText(
      "SCOPE OF WORK\nAs at 31 March 2025, the fund's assets were over R2.69 trillion.\n",
    );
    expect(f.value).toBeNull();
  });

  it("still reads an explicitly labelled value", () => {
    const f = parseRfqText("Estimated Contract Value: R 12,500,000\nSCOPE OF WORK\nBuild it.\n");
    expect(f.value).toBe(12_500_000);
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
