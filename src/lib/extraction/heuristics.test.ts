import { describe, it, expect } from "vitest";
import {
  extractEmail,
  extractPhone,
  matchDictionary,
  guessName,
  guessRole,
  guessExperienceYears,
  parseExperience,
  parseEducation,
} from "@/lib/extraction/heuristics";
import { parseTextToFields } from "@/lib/extraction/local-parser";
import { ALL_ROLES } from "@/lib/vocabulary";

const SAMPLE_CV = `ALEXANDER CHEN, P.E., S.E.
Senior Structural Engineer
123 Oak Street, London, UK | alexander.chen@example.com | +44 7911 123456

Professional Summary
Experienced Senior Structural Engineer with 12 years specialising in complex,
high-rise, and seismic retrofit projects. Expertise in Revit, Tekla Structures,
ETABS, and AutoCAD Civil 3D.

Skills
Structural Analysis, Seismic Design, BIM Coordination, Revit, AutoCAD Civil 3D

Certifications
CSCS Gold, SMSTS, NEBOSH

Education
BEng Civil Engineering (First Class Honours) - University of Manchester (2015)

Sectors
Construction, Commercial Infrastructure
`;

describe("extractEmail", () => {
  it("finds the email address", () => {
    expect(extractEmail(SAMPLE_CV)).toBe("alexander.chen@example.com");
  });
  it("returns null when absent", () => {
    expect(extractEmail("no contact details here")).toBeNull();
  });
});

describe("extractPhone", () => {
  it("finds an international phone number", () => {
    expect(extractPhone(SAMPLE_CV)).toContain("44 7911 123456");
  });
  it("finds a South African style number", () => {
    expect(extractPhone("Call me on 082 123 4567")).toContain("082 123 4567");
  });
  it("does not treat a lone year as a phone number", () => {
    expect(extractPhone("Graduated in 2015")).toBeNull();
  });
});

describe("matchDictionary", () => {
  it("tags known skills present in the text", () => {
    const skills = matchDictionary(SAMPLE_CV, ["Revit", "Tekla Structures", "AutoCAD", "SolidWorks"]);
    expect(skills).toContain("Revit");
    expect(skills).toContain("Tekla Structures");
    expect(skills).not.toContain("SolidWorks");
  });

  it("subsumes shorter matches inside longer ones", () => {
    // Both "CSCS" and "CSCS Gold" are dictionary terms; only the specific one survives.
    const certs = matchDictionary("Holds CSCS Gold card", ["CSCS", "CSCS Gold"]);
    expect(certs).toEqual(["CSCS Gold"]);
  });

  it("respects word boundaries", () => {
    expect(matchDictionary("Revitalise the process", ["Revit"])).toEqual([]);
  });
});

describe("guessName", () => {
  it("reads the name from the top line, dropping suffixes", () => {
    expect(guessName(SAMPLE_CV)).toBe("Alexander Chen");
  });

  it("falls back to the filename when no name line is found", () => {
    expect(guessName("2015 - 2019 project work", "james_carter_cv.pdf")).toBe("James Carter");
  });

  it("returns null when neither text nor filename yields a name", () => {
    expect(guessName("2015 2019", "document_final_v2.pdf")).toBeNull();
  });
});

describe("guessRole", () => {
  it("returns the most specific matching role", () => {
    expect(guessRole(SAMPLE_CV, ALL_ROLES)).toBe("Senior Structural Engineer");
  });
  it("returns null when no known role appears", () => {
    expect(guessRole("A pastry baker", ALL_ROLES)).toBeNull();
  });
});

describe("guessExperienceYears", () => {
  it("extracts the largest years figure", () => {
    expect(guessExperienceYears(SAMPLE_CV)).toBe(12);
  });
  it("handles the N+ years pattern", () => {
    expect(guessExperienceYears("Over 8+ years of experience")).toBe(8);
  });
  it("returns null when no figure present", () => {
    expect(guessExperienceYears("recent graduate")).toBeNull();
  });
});

describe("parseTextToFields (integration)", () => {
  it("assembles a full candidate record from a sample CV", () => {
    const fields = parseTextToFields(SAMPLE_CV, "alexander_chen_cv.pdf");
    expect(fields.full_name).toBe("Alexander Chen");
    expect(fields.email).toBe("alexander.chen@example.com");
    expect(fields.phone).toContain("44 7911 123456");
    expect(fields.current_role).toBe("Senior Structural Engineer");
    expect(fields.years_experience).toBe(12);
    // Revit / Tekla are technical skills; Structural Analysis is professional.
    expect(fields.technical_skills).toContain("Revit");
    expect(fields.technical_skills).toContain("Tekla Structures");
    expect(fields.skills).toContain("Structural Analysis");
    expect(fields.certifications).toContain("CSCS Gold");
    expect(fields.certifications).toContain("SMSTS");
    expect(fields.qualifications).toContain("BEng Civil Engineering");
    expect(fields.sectors).toContain("Construction");
  });

  it("degrades gracefully on text with no recognisable fields", () => {
    const fields = parseTextToFields("Lorem ipsum dolor sit amet.", undefined);
    expect(fields.email).toBeNull();
    expect(fields.phone).toBeNull();
    expect(fields.skills).toEqual([]);
    expect(fields.technical_skills).toEqual([]);
    expect(fields.certifications).toEqual([]);
  });
});

/**
 * Employment written with no dates, which is common on early-career CVs and
 * previously produced an empty work history: every entry required a date range,
 * so a CV listing four jobs on four lines yielded nothing at all.
 */
describe("parseExperience: entries with no dates", () => {
  it("reads one job per line and splits employer from role", () => {
    const section = [
      "Timula gemer & water- bookkeeper",
      "RC Belle- beautician",
      "Matseke's VIP catering events- sales administrator",
      "Cyprus direct marketing (Credico)-Independent sales agent",
    ].join("\n");

    const entries = parseExperience(section);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ title: "bookkeeper", company: "Timula gemer & water" });
    // The dash has no space before it here, and none after it on the last line.
    expect(entries[3]).toMatchObject({
      title: "Independent sales agent",
      company: "Cyprus direct marketing (Credico)",
    });
  });

  it("records the dates as unknown rather than inventing them", () => {
    const [entry] = parseExperience("RC Belle- beautician");
    expect(entry.start_date).toBeNull();
    expect(entry.end_date).toBeNull();
    expect(entry.is_current).toBe(false);
  });

  it("ignores prose and bullets in the same section", () => {
    const section = [
      "Acme Corp- developer",
      "I was responsible for maintaining the payment service.",
      "• Fixed the nightly batch",
      "References available on request",
    ].join("\n");

    const entries = parseExperience(section);
    expect(entries).toHaveLength(1);
    expect(entries[0].company).toBe("Acme Corp");
  });

  it("never displaces a dated entry", () => {
    // The fallback only runs when nothing else matched, so a CV that already
    // parses cannot be affected by it.
    const section = "Senior Developer | Acme Corp\nJanuary 2020 - March 2023\nBuilt the platform";
    const entries = parseExperience(section);
    expect(entries).toHaveLength(1);
    expect(entries[0].start_date).toBe("January 2020");
  });
});

describe("parseEducation", () => {
  it("does not list a school as something the candidate studied", () => {
    // A two-column CV exports the institution onto its own line. Read as a
    // qualification it put "University of Johannesburg" in a candidate's list
    // of degrees, beside the degree they actually hold.
    const rows = parseEducation(`BCom Business Management
University of Johannesburg
2019 - 2022`);
    expect(rows.map((r) => r.qualification)).toEqual(["BCom Business Management"]);
    expect(rows[0].institution).toBe("University of Johannesburg");
  });

  it("attaches an institution written above the qualification", () => {
    const rows = parseEducation(`University of Pretoria
BEng Computer Engineering`);
    expect(rows).toHaveLength(1);
    expect(rows[0].institution).toBe("University of Pretoria");
  });

  it("splits a degree from its institution on a pipe", () => {
    const rows = parseEducation("BCom Information Systems | University of North-West");
    expect(rows[0].qualification).toBe("BCom Information Systems");
    expect(rows[0].institution).toBe("University of North-West");
  });

  it("leaves the degree classification out of the award name", () => {
    // Stripping the parens glued the class on, and the result no longer matched
    // the award a tender asks for.
    const rows = parseEducation(
      "BEng Civil Engineering (First Class Honours) - University of Manchester (2015)",
    );
    expect(rows[0].qualification).toBe("BEng Civil Engineering");
    expect(rows[0].year).toBe("2015");
  });

  it("keeps Honours, which is part of the award rather than a grade", () => {
    const rows = parseEducation("BCom Honours in Information Systems");
    expect(rows[0].qualification).toBe("BCom Honours in Information Systems");
  });

  it("reads (present) as still studying rather than as part of the award", () => {
    // A real CV wrote "BCom business management extended (present)". Losing the
    // marker had the system state the candidate holds a degree they are still
    // reading for, which on a bid is a misrepresentation.
    const rows = parseEducation("BCom business management extended (present)");
    expect(rows[0].qualification).toBe("BCom business management extended (in progress)");
    expect(rows[0].year).toBeNull();
  });

  it("recognises a high school as the institution, not a qualification", () => {
    const rows = parseEducation(`Matriculation
Maragon Mooikloof High School`);
    expect(rows.map((r) => r.qualification)).toEqual(["Matriculation"]);
    expect(rows[0].institution).toBe("Maragon Mooikloof High School");
  });
});

describe("qualification duplication", () => {
  it("does not report the abbreviation and the full award as two qualifications", () => {
    // The dictionary pass yields the bare "BCom" and the education parse yields
    // the full award. Merged with only exact-duplicate removal both survived,
    // so the candidate appeared to hold two degrees.
    const fields = parseTextToFields(
      `Jane Dube
jane@example.com

Education
BCom Information Systems | University of North-West
2019
`,
      "jane_dube_cv.pdf",
    );
    expect(fields.qualifications).toEqual(["BCom Information Systems"]);
  });

  it("does not credit a Business Analyst with a Bachelor of Arts", () => {
    // "BA" is a qualification in the vocabulary and a job title everywhere else.
    // Matched across the whole CV it invented a degree the candidate never
    // claimed, which on a bid is a misrepresentation.
    const fields = parseTextToFields(
      `Thabo Nkosi
Senior BA

Work Experience
BA on the payments programme, 2021 - present

Education
National Diploma in IT
`,
      "thabo_nkosi_cv.pdf",
    );
    expect(fields.qualifications).not.toContain("BA");
    expect(fields.qualifications).toContain("National Diploma in IT");
  });
});
