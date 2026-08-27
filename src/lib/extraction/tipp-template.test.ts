import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  parseTippTemplate,
  looksLikeTippTemplate,
  parseCareerSummary,
  parseQualificationTable,
  parseEmploymentRecord,
  mapAvailability,
  splitList,
  splitDuration,
  expandSkillLine,
  yearsFromRows,
} from "@/lib/extraction/tipp-template";
import { parseTextToFields } from "@/lib/extraction/local-parser";

/**
 * Fixtures are three real CVs, chosen for their differences rather than their
 * similarity: Godfrey carries DATE OF BIRTH where the template expects
 * POSITION, Thamsanqa leaves POSITION and LANGUAGES empty and writes his
 * summary under the wrong heading, and Bongani has no AVAILABILITY, no summary
 * and no certificates table.
 */
function fixture(name: string): string {
  return fs.readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");
}

const GODFREY = fixture("tipp-cv-godfrey.txt");
const THAMSANQA = fixture("tipp-cv-thamsanqa.txt");
const BONGANI = fixture("tipp-cv-bongani.txt");

// Fixed so the experience totals do not drift as the calendar moves.
const NOW = new Date("2026-08-26T00:00:00Z");

describe("looksLikeTippTemplate", () => {
  it("recognises the template", () => {
    expect(looksLikeTippTemplate(GODFREY)).toBe(true);
    expect(looksLikeTippTemplate(THAMSANQA)).toBe(true);
    expect(looksLikeTippTemplate(BONGANI)).toBe(true);
  });

  it("leaves an ordinary CV to the generic heuristics", () => {
    const plain = "Jane Smith\nSenior Developer\n\nEXPERIENCE\nAcme, 2020 to 2024\n";
    expect(looksLikeTippTemplate(plain)).toBe(false);
  });
});

describe("parseTippTemplate: the header block", () => {
  it("reads the name, role, languages and availability", () => {
    const r = parseTippTemplate(GODFREY, NOW)!;
    expect(r.full_name).toBe("Godfrey Marange");
    expect(r.languages).toEqual(["English"]);
    expect(r.availability).toBe("available");
  });

  it("falls back to the latest job title when POSITION is absent", () => {
    // This CV uses the POSITION slot for DATE OF BIRTH and states no role.
    expect(GODFREY).toContain("DATE OF BIRTH");
    expect(parseTippTemplate(GODFREY, NOW)!.current_role).toBe("Business Analyst");
  });

  it("does not invent a role or languages when the cells are blank", () => {
    const r = parseTippTemplate(THAMSANQA, NOW)!;
    expect(r.full_name).toBe("Thamsanqa Tyatya");
    expect(r.languages).toEqual([]);
    // POSITION is empty, so the most recent employment record stands in.
    expect(r.current_role).toBe("Founder");
  });

  it("leaves availability undefined when the CV does not state it", () => {
    // Undefined is not the same as available, so it must not default.
    expect(parseTippTemplate(BONGANI, NOW)!.availability).toBeUndefined();
  });
});

describe("parseTippTemplate: the tables", () => {
  it("reads qualifications with their institution and year", () => {
    const r = parseTippTemplate(GODFREY, NOW)!;
    expect(r.education).toContainEqual({
      qualification: "BSc. Hons in Digital Innovation and Design",
      field: null,
      institution: "Technological University Dublin",
      year: "2018",
    });
  });

  it("keeps certificates separate from qualifications", () => {
    const r = parseTippTemplate(GODFREY, NOW)!;
    expect(r.certifications).toContain("Microsoft Certified Systems Engineer");
    expect(r.qualifications).not.toContain("Microsoft Certified Systems Engineer");
  });

  it("does not merge rows whose year cell is a range", () => {
    // "2017 - 2021" and "2012 -2016" both appear in this table.
    const r = parseTippTemplate(BONGANI, NOW)!;
    expect(r.education.map((e) => e.qualification)).toEqual([
      "Higher Certificate in Information Technology",
      "B.Com in Business Management",
      "Matric",
    ]);
    expect(r.education[1].institution).toBe("University of Johannesburg");
  });

  it("builds work experience with the client and duties", () => {
    const r = parseTippTemplate(GODFREY, NOW)!;
    const first = r.work_experience[0];
    expect(first.company).toBe("Tipp Focus Holdings");
    expect(first.title).toBe("Business Analyst");
    expect(first.is_current).toBe(true);
    expect(first.description).toContain("Client: CoJ");
  });
});

describe("parseTippTemplate: the summary", () => {
  it("reads CANDIDATE SUMMARY when it is filled in", () => {
    expect(parseTippTemplate(GODFREY, NOW)!.professional_summary).toContain(
      "experienced IT Business Analysis Consultant",
    );
  });

  it("recovers a summary written under CAREER SUMMARY by mistake", () => {
    // This CV has prose where the career table belongs, so the table parse
    // finds no duration rows and the prose is treated as the summary.
    const r = parseTippTemplate(THAMSANQA, NOW)!;
    expect(r.professional_summary).toContain("Thamsanqa is an ideal candidate");
  });
});

describe("parseCareerSummary", () => {
  it("uses the duration as the row terminator, so a blank cell cannot shift rows", () => {
    const rows = parseCareerSummary([
      "COMPANY",
      "POSITION",
      "DURATION",
      "Acme",
      "Analyst",
      "January 2020 - March 2022",
      "Globex",
      "Senior Analyst",
      "April 2022 - Current",
    ]);
    expect(rows).toEqual([
      { company: "Acme", position: "Analyst", duration: "January 2020 - March 2022" },
      { company: "Globex", position: "Senior Analyst", duration: "April 2022 - Current" },
    ]);
  });

  it("keeps a wrapped job title in one piece", () => {
    const rows = parseCareerSummary(["Acme", "Business Analyst", "and Project Lead", "2020 - 2022"]);
    expect(rows[0].position).toBe("Business Analyst and Project Lead");
  });
});

describe("parseQualificationTable", () => {
  it("accepts a bare year and a year range as the terminator", () => {
    const rows = parseQualificationTable([
      "BCom",
      "UJ",
      "2021",
      "Matric",
      "St Johns",
      "2012 -2016",
    ]);
    expect(rows).toEqual([
      { qualification: "BCom", institution: "UJ", year: "2021" },
      { qualification: "Matric", institution: "St Johns", year: "2012 -2016" },
    ]);
  });

  it("keeps a trailing row that has no year", () => {
    const rows = parseQualificationTable(["Diploma", "Damelin"]);
    expect(rows).toEqual([{ qualification: "Diploma", institution: "Damelin", year: null }]);
  });
});

describe("parseEmploymentRecord", () => {
  it("starts a new block at each Company and keeps the duties together", () => {
    const blocks = parseEmploymentRecord([
      "Company",
      "Acme",
      "Client",
      "CoJ",
      "Role",
      "Analyst",
      "Duration",
      "January 2025 - Current",
      "Duties",
      "Did a thing",
      "Did another thing",
      "Company",
      "Globex",
      "Role",
      "Lead",
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      company: "Acme",
      client: "CoJ",
      role: "Analyst",
      duration: "January 2025 - Current",
      duties: ["Did a thing", "Did another thing"],
    });
    expect(blocks[1].company).toBe("Globex");
  });
});

describe("splitDuration", () => {
  it("treats Current as open ended rather than an end date", () => {
    expect(splitDuration("Jan 2025 - Current")).toEqual({
      start: "Jan 2025",
      end: null,
      current: true,
    });
  });

  it("reads an en dash, which is what Word produces", () => {
    expect(splitDuration("September 2023 – August 2024")).toEqual({
      start: "September 2023",
      end: "August 2024",
      current: false,
    });
  });
});

describe("yearsFromRows", () => {
  it("measures the span once instead of summing overlapping contracts", () => {
    // Three concurrent rows across the same two years. Summing gives 6.
    const durations = ["2020 - 2022", "2020 - 2021", "2021 - 2022"];
    expect(yearsFromRows(durations, 2026)).toBe(2);
  });

  it("runs an open-ended row up to the current year", () => {
    expect(yearsFromRows(["January 2016 - Current"], 2026)).toBe(10);
  });

  it("returns null when no year can be read", () => {
    expect(yearsFromRows(["sometime last year"], 2026)).toBe(null);
  });
});

describe("mapAvailability", () => {
  it("maps the phrasings these CVs actually use", () => {
    expect(mapAvailability("Immediately Available")).toBe("available");
    expect(mapAvailability(" Available")).toBe("available");
    expect(mapAvailability("A month's notice")).toBe("notice_period");
  });

  it("reads 'available from a date' as notice, not as available now", () => {
    expect(mapAvailability("Available from 1 March")).toBe("notice_period");
  });

  it("returns undefined rather than guessing", () => {
    expect(mapAvailability(null)).toBeUndefined();
    expect(mapAvailability("Ask the manager")).toBeUndefined();
  });
});

describe("splitList", () => {
  it("splits on commas and on the word and", () => {
    expect(splitList("English, IsiXhosa and SeSotho")).toEqual([
      "English",
      "IsiXhosa",
      "SeSotho",
    ]);
  });
});

describe("expandSkillLine", () => {
  it("leaves a single skill alone", () => {
    expect(expandSkillLine("Stakeholder Management")).toEqual(["Stakeholder Management"]);
  });

  it("splits a prose sentence into individual skills", () => {
    const skills = expandSkillLine(
      "He has skills in the following areas Project Management, Visual Basic, as well as corporate communications.",
    );
    expect(skills).toEqual(["Project Management", "Visual Basic", "corporate communications"]);
  });

  it("does not split inside brackets", () => {
    expect(expandSkillLine("Microsoft Server Support, Cloud Services (Azure, Office 365)")).toEqual([
      "Microsoft Server Support",
      "Cloud Services (Azure, Office 365)",
    ]);
  });

  it("drops the conjunction on the last item of a list", () => {
    expect(expandSkillLine("BPMN, EPC, or DMN")).toEqual(["BPMN", "EPC", "DMN"]);
  });
});

describe("the parser is reached through the normal entry point", () => {
  it("uses the template parser rather than the generic heuristics", () => {
    // The heuristics read the flattened table header and reported every
    // candidate's role as "Duration", which is the bug this whole module exists
    // to fix. Guarding it here so a future change to the wiring cannot bring it
    // back silently.
    const fields = parseTextToFields(GODFREY, "godfrey.docx");
    expect(fields.current_role).toBe("Business Analyst");
    expect(fields.current_role).not.toBe("Duration");
    expect(fields.education.length).toBeGreaterThan(0);
  });
});
